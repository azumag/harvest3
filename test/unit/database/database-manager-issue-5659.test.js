/**
 * Issue #5659: strategy-runnerサービスで例外が発生の修正テスト
 * Redis接続状態チェックでの回復可能状態に対するリトライ機能のテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #5659: Redis接続状態チェック回復可能状態リトライ対応', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;
  let mockRedisModule;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックロガーの初期化
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };

    // 正常なRedisクライアントモック
    mockRedisClient = {
      multi: jest.fn(),
      isReady: undefined, // Issue #5659: プロパティがundefinedの状態をシミュレート
      isOpen: undefined,
      status: 'connecting', // 初期状態は回復可能状態
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG'),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('test_value'),
      del: jest.fn().mockResolvedValue(1)
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient)
    };

    // Redis モジュールのモック
    mockRedisModule = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
      getCircuitBreakerState: jest.fn().mockReturnValue({ state: 'CLOSED' }),
      isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
      updateCircuitBreakerOnSuccess: jest.fn(),
      updateCircuitBreakerOnFailure: jest.fn()
    };

    // require のモック設定
    jest.doMock('../../../src/database/redisClient', () => mockRedisModule);
    
    // データベースマネージャーを動的にrequire
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateRedisClientConnection関数の改善', () => {
    let validateRedisClientConnection;

    beforeEach(() => {
      // プライベート関数をテスト用に公開
      validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
    });

    test('connectingステータスが有効な状態として認識される', () => {
      const clientConnecting = {
        status: 'connecting',
        constructor: { name: 'RedisClient' }
      };

      const result = validateRedisClientConnection(clientConnecting, 'テスト接続チェック', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      // 回復可能状態として警告が出力される
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Redis Transaction] テスト接続チェック: 回復可能な接続状態を検出 (status=connecting)'
      );
    });

    test('reconnectingステータスが有効な状態として認識される', () => {
      const clientReconnecting = {
        status: 'reconnecting',
        constructor: { name: 'RedisClient' }
      };

      const result = validateRedisClientConnection(clientReconnecting, 'テスト接続チェック', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      // 回復可能状態として警告が出力される
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Redis Transaction] テスト接続チェック: 回復可能な接続状態を検出 (status=reconnecting)'
      );
    });

    test('disconnectedステータスは依然として無効状態として処理される', () => {
      const clientDisconnected = {
        status: 'disconnected',
        constructor: { name: 'RedisClient' }
      };

      expect(() => {
        validateRedisClientConnection(clientDisconnected, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続状態が不正です (status=disconnected)');

      // エラーログが適切に出力される
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック失敗: ready=(undefined property), open=(undefined property), status=disconnected')
      );
    });

    test('改善されたエラーメッセージにstatusが含まれる', () => {
      const clientBadStatus = {
        status: 'end',
        constructor: { name: 'RedisClient' }
      };

      expect(() => {
        validateRedisClientConnection(clientBadStatus, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続状態が不正です (status=end)');
    });
  });

  describe('executeRedisTransactionWithTimeoutのリトライ機能', () => {
    let mockRedisTransaction;
    let mockTrade;

    beforeEach(() => {
      mockRedisTransaction = {
        client: mockRedisClient,
        exec: jest.fn().mockResolvedValue([
          [null, 'OK'],
          [null, 'test_result']
        ])
      };

      mockTrade = {
        tradeId: 'test_trade_12345',
        exchange: 'testexchange',
        symbol: 'BTC/USD'
      };

      // タイマーをモック化してテストの高速化
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('connecting状態から回復してトランザクションが成功する', async () => {
      // 最初の2回はconnecting状態、3回目で成功
      let callCount = 0;
      mockRedisClient.status = 'connecting';
      
      const originalValidate = databaseManager.__getValidateRedisClientConnectionForTesting();
      const mockValidate = jest.fn().mockImplementation((client, context, logger) => {
        callCount++;
        if (callCount <= 2) {
          // 最初の2回は回復可能エラーを投げる
          const error = new Error('Redis Commit失敗: 実行前接続チェック時に接続状態が不正です (status=connecting)');
          throw error;
        } else {
          // 3回目で成功
          client.status = 'ready'; // 状態を変更
          return originalValidate(client, context, logger);
        }
      });

      // validateRedisClientConnection をモック化
      jest.spyOn(databaseManager, '__getValidateRedisClientConnectionForTesting').mockReturnValue(mockValidate);

      const commandNames = ['set', 'get'];
      
      // 非同期処理の実行
      const executePromise = databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction, 
        commandNames, 
        mockTrade, 
        mockLogger
      );

      // タイマーを進める（リトライ待機時間）
      jest.advanceTimersByTime(1500); // 0.5秒 + 1秒のリトライ待機
      
      const result = await executePromise;

      // 成功結果の確認
      expect(result).toEqual([
        [null, 'OK'],
        [null, 'test_result']
      ]);

      // リトライログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック リトライ 1/3')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック リトライ 2/3')
      );

      // 最終的には成功
      expect(mockRedisTransaction.exec).toHaveBeenCalled();
    });

    test('回復不可能な状態ではリトライしない', async () => {
      const mockValidate = jest.fn().mockImplementation(() => {
        const error = new Error('Redis Commit失敗: 実行前接続チェック時に接続状態が不正です (status=disconnected)');
        throw error;
      });

      jest.spyOn(databaseManager, '__getValidateRedisClientConnectionForTesting').mockReturnValue(mockValidate);

      const commandNames = ['set', 'get'];

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction, 
          commandNames, 
          mockTrade, 
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      // リトライは実行されない（1回のみの呼び出し）
      expect(mockValidate).toHaveBeenCalledTimes(1);
      
      // 最終失敗ログが出力される
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック最終失敗')
      );
    });

    test('最大リトライ回数後も回復しない場合は失敗する', async () => {
      const mockValidate = jest.fn().mockImplementation(() => {
        const error = new Error('Redis Commit失敗: 実行前接続チェック時に接続状態が不正です (status=connecting)');
        throw error;
      });

      jest.spyOn(databaseManager, '__getValidateRedisClientConnectionForTesting').mockReturnValue(mockValidate);

      const commandNames = ['set', 'get'];

      const executePromise = databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction, 
        commandNames, 
        mockTrade, 
        mockLogger
      );

      // 全てのリトライ待機時間を進める
      jest.advanceTimersByTime(5000); // 十分な時間

      await expect(executePromise).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      // 最大リトライ回数（4回：初回+3回リトライ）実行される
      expect(mockValidate).toHaveBeenCalledTimes(4);

      // リトライログが3回出力される
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック リトライ 1/3')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック リトライ 2/3')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック リトライ 3/3')
      );
    });
  });

  describe('統合テスト: 2PC操作での回復', () => {
    test('2PC Commit フェーズでの接続回復シナリオ', async () => {
      // この部分は既存の2PC機能との統合をテストする
      // 実際のシナリオでは、MongoDB準備→Redis準備→Redis Commitの順序で実行される

      // MongoDB操作は成功と仮定
      const mockMongoResult = { acknowledged: true };
      
      // Redisクライアントが最初はconnecting状態から開始
      let connectionAttempts = 0;
      mockRedisClient.status = 'connecting';
      
      const originalValidate = databaseManager.__getValidateRedisClientConnectionForTesting();  
      const mockValidate = jest.fn().mockImplementation((client, context, logger) => {
        connectionAttempts++;
        if (connectionAttempts <= 1) {
          const error = new Error('Redis Commit失敗: 実行前接続チェック時に接続状態が不正です (status=connecting)');
          throw error;
        } else {
          // 2回目で回復
          client.status = 'ready';
          return originalValidate(client, context, logger);
        }
      });

      jest.spyOn(databaseManager, '__getValidateRedisClientConnectionForTesting').mockReturnValue(mockValidate);

      // この統合テストは概念実証のため、詳細な2PC実装は省略
      // 実際の環境では、executeDistributedTransactionWithRetry 関数が呼び出される

      const mockTransaction = {
        client: mockRedisClient,
        exec: jest.fn().mockResolvedValue([[null, 'OK']])
      };

      jest.useFakeTimers();
      
      const executePromise = databaseManager.executeRedisTransactionWithTimeout(
        mockTransaction, 
        ['hset'], 
        { tradeId: 'integration_test_123' }, 
        mockLogger
      );

      jest.advanceTimersByTime(1000);
      
      const result = await executePromise;

      expect(result).toEqual([[null, 'OK']]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック リトライ 1/3')
      );

      jest.useRealTimers();
    });
  });
});