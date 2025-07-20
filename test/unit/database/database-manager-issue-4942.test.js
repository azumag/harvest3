/**
 * Issue #4942: Redis分散トランザクション例外修正のテスト
 * orderIDのnull/undefined値エラー対策、timestampのnull/undefined値エラー対策、Luaスクリプト引数型エラー対策
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #4942: Redis分散トランザクション例外修正', () => {
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

  describe('orderID null/undefined値エラー対策テスト', () => {
    test('null orderIdでhDel処理がスキップされる', async () => {
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
        orderId: null,  // null値 - truthy checkでスキップされる
        tradeId: '1416611725'
      };

      const commandNames = await databaseManager.prepareRedisOperations(mockTransaction, trade);

      // null orderIdの場合、hDel処理はスキップされる
      expect(mockTransaction.hDel).not.toHaveBeenCalled();
      expect(commandNames).not.toContain('hDel(pendingOrder)');
      expect(commandNames).toEqual([
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(sellAmount)',
        'hIncrByFloat(totalSellRevenue)',
        'hSet(updatedAt)'
      ]);
    });

    test('undefined orderIdでhDel処理がスキップされる', async () => {
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
        orderId: undefined,  // undefined値 - truthy checkでスキップされる
        tradeId: '1416611725'
      };

      const commandNames = await databaseManager.prepareRedisOperations(mockTransaction, trade);

      // undefined orderIdの場合、hDel処理はスキップされる
      expect(mockTransaction.hDel).not.toHaveBeenCalled();
      expect(commandNames).not.toContain('hDel(pendingOrder)');
    });

    test('文字列化された無効値でエラーが発生する', async () => {
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
        orderId: 'undefined',  // 文字列化された'undefined'
        tradeId: '1416611725'
      };

      await expect(databaseManager.prepareRedisOperations(mockTransaction, trade))
        .rejects.toThrow('無効なorderId値: undefined - orderId converts to invalid string');
    });

    test('空文字列orderIdでエラーが発生する', async () => {
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
        orderId: '   ',  // 空白のみ（trim後に空文字列）
        tradeId: '1416611725'
      };

      await expect(databaseManager.prepareRedisOperations(mockTransaction, trade))
        .rejects.toThrow('Redis操作準備エラー: 無効なorderId値:     - orderId converts to invalid string');
    });

    test('無効な文字を含むorderIdでエラーが発生する', async () => {
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
        orderId: 'order$123!',  // 無効な文字（$, !）を含む
        tradeId: '1416611725'
      };

      await expect(databaseManager.prepareRedisOperations(mockTransaction, trade))
        .rejects.toThrow('無効なorderId値: order$123! - orderId contains invalid characters');
    });

    test('有効なorderIdで正常処理される', async () => {
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
        orderId: 'order_123-456',  // 有効な文字（英数字、アンダースコア、ハイフン）
        tradeId: '1416611725'
      };

      const commandNames = await databaseManager.prepareRedisOperations(mockTransaction, trade);

      expect(mockTransaction.hDel).toHaveBeenCalledWith(
        'pending:bitbank:XRP/JPY:MULTI_INDICATOR',
        'order_123-456'  // 正常に文字列として渡される
      );

      expect(commandNames).toContain('hDel(pendingOrder)');
    });
  });

  describe('timestamp null/undefined値エラー対策テスト', () => {
    test('Date.nowのフォールバック機能テスト', async () => {
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
        orderId: 'order123',
        tradeId: '1416611725'
      };

      // Date.nowをモックして異常値を返すようにする
      const originalDateNow = Date.now;
      const originalGetTime = Date.prototype.getTime;
      
      Date.now = jest.fn().mockReturnValue(NaN);  // 異常値
      Date.prototype.getTime = jest.fn().mockReturnValue(1640995200000);  // フォールバック値

      try {
        const commandNames = await databaseManager.prepareRedisOperations(mockTransaction, trade);

        expect(mockTransaction.hSet).toHaveBeenCalledWith(
          'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
          'updatedAt',
          '1640995200000'  // フォールバック値が使用される
        );

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('タイムスタンプ生成エラー、フォールバック使用')
        );

        expect(commandNames).toContain('hSet(updatedAt)');
      } finally {
        // モックを元に戻す
        Date.now = originalDateNow;
        Date.prototype.getTime = originalGetTime;
      }
    });

    test('タイムスタンプ生成完全失敗でエラーが発生する', async () => {
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
        orderId: 'order123',
        tradeId: '1416611725'
      };

      // Date.nowとgetTimeの両方をモックして異常値を返すようにする
      const originalDateNow = Date.now;
      const originalGetTime = Date.prototype.getTime;
      
      Date.now = jest.fn().mockReturnValue(null);  // 異常値
      Date.prototype.getTime = jest.fn().mockReturnValue(NaN);  // フォールバックも失敗

      try {
        await expect(databaseManager.prepareRedisOperations(mockTransaction, trade))
          .rejects.toThrow('Redis操作準備エラー: タイムスタンプ生成完全失敗');
      } finally {
        // モックを元に戻す
        Date.now = originalDateNow;
        Date.prototype.getTime = originalGetTime;
      }
    });
  });

  describe('Luaスクリプト引数型エラー対策テスト', () => {
    test('null lockKeyで警告ログが出力される', async () => {
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

    test('undefined lockValueで警告ログが出力される', async () => {
      const lockInfo = {
        lockKey: 'test:lock:key',
        lockValue: undefined  // undefined値
      };

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('パラメータが無効です')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('空文字列で警告ログが出力される', async () => {
      const lockInfo = {
        lockKey: '',  // 空文字列
        lockValue: 'test-lock-value-123'
      };

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('パラメータが無効です')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('正常なLua引数で成功する', async () => {
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
  });

  describe('総合テスト - Issue #4942の統合修正', () => {
    test('全ての修正が統合されて正常動作する', async () => {
      const mockTransaction = {
        hIncrByFloat: jest.fn(),
        hDel: jest.fn(),
        hSet: jest.fn()
      };

      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'buy',
        amount: 50.25,
        value: 2500.75,
        orderId: 'order_ABC-123',  // 有効なorderID
        tradeId: '1416611725'
      };

      const commandNames = await databaseManager.prepareRedisOperations(mockTransaction, trade);

      // orderIDの処理確認
      expect(mockTransaction.hDel).toHaveBeenCalledWith(
        'pending:bitbank:XRP/JPY:MULTI_INDICATOR',
        'order_ABC-123'
      );

      // timestampの処理確認
      expect(mockTransaction.hSet).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'updatedAt',
        expect.stringMatching(/^\d+$/)
      );

      // 他のRedis操作も正常
      expect(mockTransaction.hIncrByFloat).toHaveBeenCalledWith(
        'summary:trade:bitbank:XRP/JPY:MULTI_INDICATOR',
        'netPosition',
        '50.25'
      );

      expect(commandNames).toEqual([
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(buyAmount)',
        'hIncrByFloat(totalBuyCost)',
        'hDel(pendingOrder)',
        'hSet(updatedAt)'
      ]);
    });
  });
});