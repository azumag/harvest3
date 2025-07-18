/**
 * Issue #4126: Redis分散トランザクション例外の修正テスト
 * Redis引数の型安全性とLua scriptパラメータ型エラーの修正テスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #4126: Redis分散トランザクション例外の修正', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックの初期化
    mockRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG'),
      eval: jest.fn()
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

    // Logger クラスをモック
    jest.doMock('../../../src/hft/utils/Logger', () => {
      return jest.fn(() => mockLogger);
    });

    // redisDatabase をモック
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);

    // MongoDB client をモック
    const mockMongoClient = {
      startSession: jest.fn().mockReturnValue({
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn()
      })
    };

    jest.doMock('../../../src/database/mongoDatabase', () => ({
      connectDB: jest.fn().mockResolvedValue(mockMongoClient),
      getClient: jest.fn().mockReturnValue(mockMongoClient)
    }));

    // Utils モジュールをモック
    jest.doMock('../../../src/common/utils', () => ({
      sleep: jest.fn(),
      timeframeToMs: jest.fn(),
      isBacktestMode: jest.fn().mockReturnValue(false),
      validateLockParameters: jest.fn().mockReturnValue({ valid: true })
    }));

    // 他の依存関係をモック
    jest.doMock('../../../src/database/exchangeAPI', () => ({
      fetchOHLCVDataAPI: jest.fn()
    }));

    jest.doMock('../../../src/database/ohlcvQueue', () => ({
      getOHLCVQueue: jest.fn()
    }));

    jest.doMock('../../../src/database/ohlcvCache', () => ({
      getOHLCVCacheManager: jest.fn()
    }));

    jest.doMock('../../../src/common/bitbankErrorHandler', () => ({
      withBitbankErrorHandling: jest.fn()
    }));

    // databaseManager をインポート
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('prepareRedisOperations 型安全性テスト', () => {
    test('数値引数の文字列変換が正しく行われる', async () => {
      // モックトランザクションの設定
      const mockTransaction = {
        hIncrByFloat: jest.fn(),
        hDel: jest.fn(),
        hSet: jest.fn()
      };

      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 100.5,  // 数値
        value: 5000.25, // 数値
        orderId: 12345,
        tradeId: '1416611725'
      };

      // prepareRedisOperations を実行
      const commandNames = await databaseManager.prepareRedisOperations(mockTransaction, trade);

      // 引数が文字列として渡されることを確認
      expect(mockTransaction.hIncrByFloat).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'netPosition',
        '-100.5'  // 文字列として渡されることを確認
      );

      expect(mockTransaction.hIncrByFloat).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'sellAmount',
        '100.5'  // 文字列として渡されることを確認
      );

      expect(mockTransaction.hIncrByFloat).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'totalSellRevenue',
        '5000.25'  // 文字列として渡されることを確認
      );

      expect(mockTransaction.hDel).toHaveBeenCalledWith(
        'pending:bitbank:XRP/JPY:MULTI_INDICATOR',
        '12345'  // 文字列として渡されることを確認
      );

      expect(mockTransaction.hSet).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'updatedAt',
        expect.stringMatching(/^\d+$/)  // タイムスタンプが文字列として渡されることを確認
      );

      expect(commandNames).toEqual([
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(sellAmount)',
        'hIncrByFloat(totalSellRevenue)',
        'hDel(pendingOrder)',
        'hSet(updatedAt)'
      ]);
    });

    test('無効な数値でエラーが発生する', async () => {
      const mockTransaction = {
        hIncrByFloat: jest.fn(),
        hDel: jest.fn(),
        hSet: jest.fn()
      };

      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 'invalid',  // 無効な数値
        value: 5000.25,
        orderId: 12345,
        tradeId: '1416611725'
      };

      await expect(databaseManager.prepareRedisOperations(mockTransaction, trade))
        .rejects.toThrow('Redis操作準備時のバリデーションエラー: Redis操作のためのamount値が無効: invalid');
    });

    test('無効なorderIdでエラーが発生する', async () => {
      const mockTransaction = {
        hIncrByFloat: jest.fn(),
        hDel: jest.fn(),
        hSet: jest.fn()
      };

      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 100.5,
        value: 5000.25,
        orderId: 'undefined',  // 無効なorderId (String化された'undefined')
        tradeId: '1416611725'
      };

      await expect(databaseManager.prepareRedisOperations(mockTransaction, trade))
        .rejects.toThrow('Redis操作準備エラー: 無効なorderId値: undefined');
    });
  });

  describe('executeRedisCompensation 型安全性テスト', () => {
    test('補償トランザクションでの数値引数の文字列変換', async () => {
      // モックトランザクションの設定
      const mockCompensation = {
        hIncrByFloat: jest.fn(),
        exec: jest.fn().mockResolvedValue([])
      };

      mockRedisClient.multi.mockReturnValue(mockCompensation);

      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'buy',
        amount: 50.25,   // 数値
        value: 2500.75   // 数値
      };

      // executeRedisCompensation を実行
      await databaseManager.executeRedisCompensation(trade);

      // 引数が文字列として渡されることを確認
      expect(mockCompensation.hIncrByFloat).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'netPosition',
        '-50.25'  // 逆操作で文字列として渡されることを確認
      );

      expect(mockCompensation.hIncrByFloat).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'buyAmount',
        '-50.25'  // 逆操作で文字列として渡されることを確認
      );

      expect(mockCompensation.hIncrByFloat).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'totalBuyCost',
        '-2500.75'  // 逆操作で文字列として渡されることを確認
      );

      expect(mockCompensation.exec).toHaveBeenCalled();
    });

    test('補償トランザクションで無効な数値でエラーが発生する', async () => {
      const mockCompensation = {
        hIncrByFloat: jest.fn(),
        exec: jest.fn().mockResolvedValue([])
      };

      mockRedisClient.multi.mockReturnValue(mockCompensation);

      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'buy',
        amount: 'invalid',  // 無効な数値
        value: 2500.75
      };

      await expect(databaseManager.executeRedisCompensation(trade))
        .rejects.toThrow('補償トランザクション: 無効なamount値: invalid');
    });
  });

  describe('releaseDistributedLock Lua script引数テスト', () => {
    test('正常なLua script引数の処理', async () => {
      mockRedisClient.eval.mockResolvedValue(1);

      const lockInfo = {
        lockKey: 'test:lock:key',
        lockValue: 'test-lock-value-123'
      };

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get", KEYS[1])'),
        1,
        'test:lock:key',
        'test-lock-value-123'
      );
    });

    test('不正な文字が含まれる場合のLua script引数処理', async () => {
      // サニタイズで削除されるので、正常処理されるケース
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 'test:lock:key\x01invalid',  // 制御文字を含む（サニタイズで削除される）
        lockValue: 'test-lock-value-123'
      };

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      // サニタイズ後は有効な文字列になるので、正常処理される
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get", KEYS[1])'),
        1,
        'test:lock:keyinvalid',  // 制御文字が削除された状態
        'test-lock-value-123'
      );
    });

    test('空文字列の場合のLua script引数処理', async () => {
      const lockInfo = {
        lockKey: '   ',  // 空白のみ（サニタイズ後に空文字列になる）
        lockValue: 'test-lock-value-123'
      };

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('サニタイズ後に空文字列')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('null/undefined値の場合のLua script引数処理', async () => {
      const lockInfo = {
        lockKey: null,  // null値
        lockValue: 'test-lock-value-123'
      };

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('パラメータが無効です')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });
});