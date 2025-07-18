/**
 * Issue #3873: strategy-runnerサービスでのRedis 2PC例外処理テスト
 * Redis操作の失敗時により詳細なエラー情報を提供する修正のテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #3873: Redis 2PC例外処理の改善', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // モックの初期化
    mockRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' }
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient)
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // database manager をロード
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRedisErrorMessage 関数の改善', () => {
    let getRedisErrorMessage;

    beforeEach(() => {
      // getRedisErrorMessage をエクスポートから取得
      getRedisErrorMessage = databaseManager.getRedisErrorMessage;
    });

    it('undefined/null エラーの場合、詳細なコンテキスト情報を含むメッセージを返す', () => {
      const commandName = 'hDel(pendingOrder)';
      const operationContext = {
        tradeId: '1416439209',
        exchange: 'bitbank',
        symbol: 'btc_jpy',
        strategy: 'test_strategy',
        commandIndex: 3,
        totalCommands: 5
      };

      const result = getRedisErrorMessage(null, 3, commandName, operationContext);
      
      expect(result).toContain('Redis operation failed with null/undefined error');
      expect(result).toContain('hDel(pendingOrder)');
      expect(result).toContain('1416439209');
      expect(result).toContain('connection issue or timeout');
    });

    it('undefined エラーの場合、適切なメッセージを返す', () => {
      const result = getRedisErrorMessage(undefined, 4, 'hSet(updatedAt)');
      
      expect(result).toContain('Redis operation failed with null/undefined error');
      expect(result).toContain('hSet(updatedAt)');
      expect(result).toContain('connection issue or timeout');
    });

    it('通常のエラーオブジェクトの場合、メッセージを返す', () => {
      const error = new Error('Connection refused');
      const result = getRedisErrorMessage(error, 0);
      
      expect(result).toBe('Connection refused');
    });

    it('文字列エラーの場合、そのまま返す', () => {
      const result = getRedisErrorMessage('WRONGTYPE Operation against a key holding the wrong kind of value', 1);
      
      expect(result).toBe('WRONGTYPE Operation against a key holding the wrong kind of value');
    });
  });

  describe('Redis 2PC 処理の改善', () => {
    let mockTransaction;
    let mockMongoSession;

    beforeEach(() => {
      mockTransaction = {
        exec: jest.fn(),
        hIncrByFloat: jest.fn(),
        hDel: jest.fn(),
        hSet: jest.fn()
      };

      mockMongoSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn()
      };

      mockRedisClient.multi.mockReturnValue(mockTransaction);
    });

    it('hDel と hSet が null エラーで失敗した場合、詳細なエラー情報をログに記録する', async () => {
      const testTrade = {
        tradeId: '1416439209',
        exchange: 'bitbank',
        symbol: 'btc_jpy',
        strategy: 'test_strategy',
        side: 'buy',
        amount: 0.01,
        value: 1000,
        orderId: 'test_order_123'
      };

      // Redis transaction の結果をモック（hDel と hSet が失敗）
      mockTransaction.exec.mockResolvedValue([
        [null, 'OK'],  // hIncrByFloat(netPosition) - 成功
        [null, 'OK'],  // hIncrByFloat(buyAmount) - 成功
        [null, 'OK'],  // hIncrByFloat(totalBuyCost) - 成功
        [null, 1],     // hDel(pendingOrder) - null エラー（実際には失敗）
        [null, 'OK']   // hSet(updatedAt) - null エラー（実際には失敗）
      ]);

      // 実際には結果を null エラーとして設定
      mockTransaction.exec.mockResolvedValue([
        [null, 'OK'],
        [null, 'OK'],
        [2, 'OK'],     // 数値エラー
        [undefined, 1], // undefined エラー
        [null, 'OK']   // null エラー
      ]);

      try {
        await databaseManager.executeDistributedTransaction(testTrade);
        throw new Error('例外が発生するはずでした');
      } catch (error) {
        // エラーログの内容を確認
        const errorCalls = mockLogger.error.mock.calls;
        
        // Redis接続状態の詳細情報がログに記録されているか確認
        const connectionLogCall = errorCalls.find(call => 
          call[0] && call[0].includes('Redis接続状態')
        );
        expect(connectionLogCall).toBeTruthy();
        
        // 失敗したコマンドの詳細情報がログに記録されているか確認
        const commandDetailCalls = errorCalls.filter(call => 
          call[0] && call[0].includes('失敗コマンド詳細')
        );
        expect(commandDetailCalls.length).toBeGreaterThan(0);
        
        // より詳細なエラーメッセージが記録されているか確認
        const detailedErrorCall = errorCalls.find(call => 
          call[0] && call[0].includes('connection issue or timeout')
        );
        expect(detailedErrorCall).toBeTruthy();
      }
    });

    it('Redis接続が利用不可の場合、適切なエラーメッセージを返す', async () => {
      const testTrade = {
        tradeId: '1416439209',
        exchange: 'bitbank',
        symbol: 'btc_jpy',
        strategy: 'test_strategy',
        side: 'buy',
        amount: 0.01,
        value: 1000
      };

      // Redis接続を利用不可に設定
      mockRedisClient.isReady = false;
      mockRedisClient.status = 'connecting';

      try {
        await databaseManager.executeDistributedTransaction(testTrade);
        throw new Error('例外が発生するはずでした');
      } catch (error) {
        expect(error.message).toContain('Redis接続が利用不可');
        expect(error.message).toContain('ready=false');
      }
    });

    it('Redis transaction 結果が null の場合、適切なエラーメッセージを返す', async () => {
      const testTrade = {
        tradeId: '1416439209',
        exchange: 'bitbank',
        symbol: 'btc_jpy',
        strategy: 'test_strategy',
        side: 'buy',
        amount: 0.01,
        value: 1000
      };

      // Redis transaction の結果を null に設定
      mockTransaction.exec.mockResolvedValue(null);

      try {
        await databaseManager.executeDistributedTransaction(testTrade);
        throw new Error('例外が発生するはずでした');
      } catch (error) {
        expect(error.message).toContain('Redis Commit失敗: トランザクション結果がnull');
      }
    });
  });

  describe('エラーハンドリングの完全性', () => {
    it('様々なエラータイプに対して適切なメッセージを生成する', () => {
      const getRedisErrorMessage = databaseManager.getRedisErrorMessage;
      
      // オブジェクト型エラー
      const objectError = { code: 'ECONNREFUSED', message: 'Connection refused' };
      expect(getRedisErrorMessage(objectError, 0)).toBe('Connection refused');
      
      // 数値エラー
      expect(getRedisErrorMessage(5, 0)).toContain('Redis error code: 5');
      
      // 空文字列
      expect(getRedisErrorMessage('', 0)).toContain('Invalid response');
      
      // ダッシュ文字
      expect(getRedisErrorMessage('-', 0)).toContain('Invalid response');
    });
  });
});