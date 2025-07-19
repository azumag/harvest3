/**
 * Database Manager Redis Transaction Functions テスト
 * Issue #4826: Redis接続安定性向上の新機能テスト
 * 
 * テスト対象:
 * 1. executeRedisTransactionWithTimeout() - タイムアウト制御付きトランザクション実行
 * 2. validateRedisTransactionBeforeExecution() - トランザクション事前検証
 */

// Disable automatic mocking for this test
jest.unmock('../../../src/database/manager');

const {
  executeRedisTransactionWithTimeout,
  validateRedisTransactionBeforeExecution
} = require('../../../src/database/manager');

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};

describe('Redis Transaction Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('validateRedisTransactionBeforeExecution', () => {
    const validTrade = {
      tradeId: 'test-trade-123',
      exchange: 'bitbank',
      symbol: 'btc_jpy',
      strategy: 'test-strategy'
    };

    const validCommandNames = ['set', 'hset', 'lpush'];

    test('有効なトランザクションとトレードでtrueを返す', () => {
      const mockTransaction = { exec: jest.fn() };
      
      const result = validateRedisTransactionBeforeExecution(
        mockTransaction,
        validCommandNames,
        validTrade,
        mockLogger
      );

      expect(result).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `[Redis Validation] トランザクション事前検証完了: ${validTrade.tradeId} (${validCommandNames.length} commands)`
      );
    });

    test('トランザクションオブジェクトがnullの場合falseを返す', () => {
      const result = validateRedisTransactionBeforeExecution(
        null,
        validCommandNames,
        validTrade,
        mockLogger
      );

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        `[Redis Validation] トランザクションオブジェクトが存在しません: ${validTrade.tradeId}`
      );
    });

    test('コマンド名配列が無効な場合falseを返す', () => {
      const mockTransaction = { exec: jest.fn() };
      
      const result = validateRedisTransactionBeforeExecution(
        mockTransaction,
        [],
        validTrade,
        mockLogger
      );

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        `[Redis Validation] コマンド名配列が無効です: ${validTrade.tradeId}`
      );
    });

    test('必須フィールドが不足している場合falseを返す', () => {
      const mockTransaction = { exec: jest.fn() };
      const invalidTrade = { tradeId: 'test-trade-123' }; // exchange, symbol, strategy が不足
      
      const result = validateRedisTransactionBeforeExecution(
        mockTransaction,
        validCommandNames,
        invalidTrade,
        mockLogger
      );

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        `[Redis Validation] 必須フィールド exchange が存在しません: ${invalidTrade.tradeId}`
      );
    });

    test('検証中にエラーが発生した場合falseを返す', () => {
      const mockTransaction = { exec: jest.fn() };
      const invalidTrade = null; // これによりエラーが発生する
      
      const result = validateRedisTransactionBeforeExecution(
        mockTransaction,
        validCommandNames,
        invalidTrade,
        mockLogger
      );

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Validation] 検証中にエラー:')
      );
    });
  });

  describe('executeRedisTransactionWithTimeout', () => {
    const validTrade = {
      tradeId: 'test-trade-123',
      exchange: 'bitbank',
      symbol: 'btc_jpy',
      strategy: 'test-strategy'
    };

    const validCommandNames = ['set', 'hset', 'lpush'];

    test('成功したトランザクション実行結果を返す', async () => {
      const mockResults = [
        [null, 'OK'],
        [null, 1],
        [null, 3]
      ];
      const mockTransaction = {
        exec: jest.fn().mockResolvedValue(mockResults)
      };

      const promise = executeRedisTransactionWithTimeout(
        mockTransaction,
        validCommandNames,
        validTrade,
        mockLogger
      );

      // Advance timers to ensure timeout doesn't trigger
      jest.advanceTimersByTime(1000);

      const result = await promise;

      expect(result).toEqual(mockResults);
      expect(mockTransaction.exec).toHaveBeenCalled();
    });

    test('タイムアウトエラーを投げる', async () => {
      const mockTransaction = {
        exec: jest.fn().mockImplementation(() => new Promise(resolve => {
          // Never resolve to simulate hanging
        }))
      };

      const promise = executeRedisTransactionWithTimeout(
        mockTransaction,
        validCommandNames,
        validTrade,
        mockLogger
      );

      // Advance timers beyond timeout (45000ms)
      jest.advanceTimersByTime(46000);

      await expect(promise).rejects.toThrow('Redis transaction timeout after 45000ms');
    });

    test('null結果の場合エラーを投げる', async () => {
      const mockTransaction = {
        exec: jest.fn().mockResolvedValue(null)
      };

      const promise = executeRedisTransactionWithTimeout(
        mockTransaction,
        validCommandNames,
        validTrade,
        mockLogger
      );

      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('Redis Commit失敗: トランザクション結果がnull');
    });

    test('無効な結果配列の場合エラーを投げる', async () => {
      const mockTransaction = {
        exec: jest.fn().mockResolvedValue([])
      };

      const promise = executeRedisTransactionWithTimeout(
        mockTransaction,
        validCommandNames,
        validTrade,
        mockLogger
      );

      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('Redis Commit失敗: 無効なトランザクション結果');
    });

    test('コマンド数不一致の場合警告ログを出力', async () => {
      const mockResults = [
        [null, 'OK'],
        [null, 1]
        // 3つ期待されるが2つしかない
      ];
      const mockTransaction = {
        exec: jest.fn().mockResolvedValue(mockResults)
      };

      const promise = executeRedisTransactionWithTimeout(
        mockTransaction,
        validCommandNames,
        validTrade,
        mockLogger
      );

      jest.advanceTimersByTime(1000);

      const result = await promise;

      expect(result).toEqual(mockResults);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `[Redis Transaction] コマンド数不一致: 期待値=${validCommandNames.length}, 実際=${mockResults.length}`
      );
    });
  });
});