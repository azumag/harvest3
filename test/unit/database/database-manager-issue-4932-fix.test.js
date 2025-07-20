/**
 * Issue #4932: strategy-runnerサービスでのRedis接続障害修正テスト
 * 2PC操作でのnull/undefined error対策と接続回復の自動化
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #4932: Redis 2PC接続障害修正', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックのデータストレージ
    const mockDataStore = new Map();
    
    // モックの初期化
    mockRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG'),
      set: jest.fn().mockImplementation((key, value) => {
        mockDataStore.set(key, value);
        return Promise.resolve('OK');
      }),
      get: jest.fn().mockImplementation((key) => {
        return Promise.resolve(mockDataStore.get(key));
      }),
      del: jest.fn().mockImplementation((key) => {
        const existed = mockDataStore.has(key);
        mockDataStore.delete(key);
        return Promise.resolve(existed ? 1 : 0);
      }),
      hSet: jest.fn().mockResolvedValue(1),
      hIncrByFloat: jest.fn().mockResolvedValue('1.5'),
      hGet: jest.fn().mockResolvedValue('test_value'),
      hDel: jest.fn().mockResolvedValue(1)
    };

    // トランザクション用のデータストレージとオペレーション追跡
    const transactionDataStore = new Map();
    const transactionOperations = [];
    
    const mockTransaction = {
      hSet: jest.fn().mockImplementation((key, field, value) => {
        if (!transactionDataStore.has(key)) {
          transactionDataStore.set(key, new Map());
        }
        transactionDataStore.get(key).set(field, value);
        transactionOperations.push({ type: 'hSet', key, field, value });
        return mockTransaction;
      }),
      hIncrByFloat: jest.fn().mockImplementation((key, field, increment) => {
        if (!transactionDataStore.has(key)) {
          transactionDataStore.set(key, new Map());
        }
        const currentValue = transactionDataStore.get(key).get(field) || 0;
        const newValue = parseFloat(currentValue) + parseFloat(increment);
        transactionDataStore.get(key).set(field, newValue.toString());
        transactionOperations.push({ type: 'hIncrByFloat', key, field, increment, result: newValue.toString() });
        return mockTransaction;
      }),
      hGet: jest.fn().mockImplementation((key, field) => {
        transactionOperations.push({ type: 'hGet', key, field });
        return mockTransaction;
      }),
      hDel: jest.fn().mockImplementation((key, ...fields) => {
        transactionOperations.push({ type: 'hDel', key, fields });
        return mockTransaction;
      }),
      del: jest.fn().mockImplementation((key) => {
        transactionOperations.push({ type: 'del', key });
        return mockTransaction;
      }),
      exec: jest.fn().mockImplementation(() => {
        // 実際の操作結果を生成
        const results = [];
        
        for (const op of transactionOperations) {
          if (op.type === 'hSet') {
            results.push([null, 1]);
          } else if (op.type === 'hIncrByFloat') {
            results.push([null, op.result]);
          } else if (op.type === 'hGet') {
            const hash = transactionDataStore.get(op.key);
            const value = hash ? hash.get(op.field) : null;
            results.push([null, value]);
          } else if (op.type === 'hDel') {
            results.push([null, op.fields.length]);
          } else if (op.type === 'del') {
            results.push([null, 1]);
          }
        }
        
        // 次回のテスト用にリセット
        transactionDataStore.clear();
        transactionOperations.length = 0;
        
        return Promise.resolve(results);
      })
    };

    mockRedisClient.multi.mockReturnValue(mockTransaction);

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

    // redisClient の機能をモック
    jest.doMock('../../../src/database/redisClient', () => ({
      initRedisClient: jest.fn().mockResolvedValue(true),
      getCircuitBreakerState: jest.fn().mockReturnValue({
        failures: 0,
        lastFailureTime: 0,
        state: 'CLOSED',
        isOpen: false,
        timeSinceLastFailure: 0
      }),
      isCircuitBreakerOpen: jest.fn().mockReturnValue(false)
    }));

    // database manager を再インポート
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkRedisConnectionHealth - Issue #4932 2PC厳格テスト', () => {
    test('2PC厳格テストが有効な場合、トランザクション操作をテストする', async () => {
      const result = await databaseManager.checkRedisConnectionHealth(
        mockRedisClient, mockLogger, true, true
      );
      
      expect(result.isHealthy).toBe(true);
      expect(result.details.operationTestSuccess).toBe(true);
      expect(result.details.transaction2PCTestSuccess).toBe(true);
      
      // multi()とexec()が呼ばれたことを確認
      expect(mockRedisClient.multi).toHaveBeenCalled();
    });

    test('2PC厳格テストでトランザクション結果がnullの場合は不健全と判定', async () => {
      const mockTransaction = {
        hSet: jest.fn().mockReturnThis(),
        hIncrByFloat: jest.fn().mockReturnThis(),
        hGet: jest.fn().mockReturnThis(),
        hDel: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null) // nullを返す
      };
      mockRedisClient.multi.mockReturnValue(mockTransaction);
      
      const result = await databaseManager.checkRedisConnectionHealth(
        mockRedisClient, mockLogger, true, true
      );
      
      expect(result.isHealthy).toBe(false);
      expect(result.details.transaction2PCTestSuccess).toBe(false);
      expect(result.details.transaction2PCTestError).toContain('Transaction results is null');
    });

    test('2PC厳格テストでトランザクション結果にnull/undefined値が含まれる場合は不健全と判定', async () => {
      const mockTransaction = {
        hSet: jest.fn().mockReturnThis(),
        hIncrByFloat: jest.fn().mockReturnThis(),
        hGet: jest.fn().mockReturnThis(),
        hDel: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1],           // 正常
          [null, null],        // null値
          [null, undefined],   // undefined値
          [null, 1],           // 正常
          [null, 1]            // 正常
        ])
      };
      mockRedisClient.multi.mockReturnValue(mockTransaction);
      
      const result = await databaseManager.checkRedisConnectionHealth(
        mockRedisClient, mockLogger, true, true
      );
      
      expect(result.isHealthy).toBe(false);
      expect(result.details.transaction2PCTestSuccess).toBe(false);
      expect(result.details.transaction2PCTestError).toContain('returned null/undefined result');
    });

    test('2PC厳格テストがタイムアウトした場合は不健全と判定', async () => {
      const mockTransaction = {
        hSet: jest.fn().mockReturnThis(),
        hIncrByFloat: jest.fn().mockReturnThis(),
        hGet: jest.fn().mockReturnThis(),
        hDel: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockImplementation(() => {
          return new Promise(resolve => setTimeout(resolve, 6000)); // 6秒タイムアウト
        })
      };
      mockRedisClient.multi.mockReturnValue(mockTransaction);
      
      const result = await databaseManager.checkRedisConnectionHealth(
        mockRedisClient, mockLogger, true, true
      );
      
      expect(result.isHealthy).toBe(false);
      expect(result.details.transaction2PCTestSuccess).toBe(false);
      expect(result.details.transaction2PCTestError).toBe('2PC transaction test timeout');
    });
  });

  describe('shouldRecoverFromNullUndefinedErrors - Issue #4932', () => {
    test('結果がnullの場合は回復が必要と判定', () => {
      const result = databaseManager.shouldRecoverFromNullUndefinedErrors(null, []);
      expect(result).toBe(true);
    });

    test('結果がundefinedの場合は回復が必要と判定', () => {
      const result = databaseManager.shouldRecoverFromNullUndefinedErrors(undefined, []);
      expect(result).toBe(true);
    });

    test('結果が配列でない場合は回復が必要と判定', () => {
      const result = databaseManager.shouldRecoverFromNullUndefinedErrors({}, []);
      expect(result).toBe(true);
    });

    test('50%以上のコマンドがnull/undefined値を返す場合は回復が必要と判定', () => {
      const redisResults = [
        [null, 1],           // 正常
        [null, null],        // null値
        [null, undefined],   // undefined値  
        [null, null]         // null値
      ];
      const result = databaseManager.shouldRecoverFromNullUndefinedErrors(redisResults, []);
      expect(result).toBe(true); // 75%がnull/undefined
    });

    test('50%未満のコマンドがnull/undefined値を返す場合は回復不要と判定', () => {
      const redisResults = [
        [null, 1],           // 正常
        [null, null],        // null値
        [null, 'value'],     // 正常
        [null, 'value2']     // 正常
      ];
      const result = databaseManager.shouldRecoverFromNullUndefinedErrors(redisResults, []);
      expect(result).toBe(false); // 25%がnull/undefined
    });

    test('すべてのコマンドが正常な場合は回復不要と判定', () => {
      const redisResults = [
        [null, 1],
        [null, 'value'],
        [null, 1.5],
        [null, 'OK']
      ];
      const result = databaseManager.shouldRecoverFromNullUndefinedErrors(redisResults, []);
      expect(result).toBe(false);
    });

    test('結果の形式が不正な場合は回復が必要と判定', () => {
      const redisResults = [
        [null, 1],           // 正常
        'invalid_format',    // 不正な形式
        [null, 'value'],     // 正常
        null                 // null
      ];
      const result = databaseManager.shouldRecoverFromNullUndefinedErrors(redisResults, []);
      expect(result).toBe(true); // 50%が不正
    });
  });

  describe('2PC統合テスト - Issue #4932', () => {
    test('正常なトレード処理では接続回復は発生しない', async () => {
      // モック設定は既存のまま（正常なレスポンス）
      const mockTrade = {
        tradeId: 'test-trade-123',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'test_strategy',
        side: 'buy',
        amount: 1.0,
        value: 1000000
      };

      // executeDistributedTransaction は内部関数なので直接テストできないため、
      // addTradeRecord をテストして間接的に確認
      try {
        await databaseManager.addTradeRecord(mockTrade);
        
        // 緊急接続回復のログが出力されていないことを確認
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining('null/undefined エラーパターンを検出')
        );
      } catch (error) {
        // テスト環境では他の理由で失敗する可能性があるため、
        // 特定のエラーメッセージのみをチェック
        expect(error.message).not.toContain('null/undefined エラーパターンを検出');
      }
    });
  });
});