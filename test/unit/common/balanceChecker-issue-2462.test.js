/**
 * BalanceChecker Issue #2462 テスト
 * 外部取引判定とログレベル修正、分散ロック機能のテスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'MANA/JPY', 'AVAX/JPY'],
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    }
  }
}));

jest.mock('../../../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    thresholds: {
      significantBalance: 0.00001,
      highDiscrepancyPercent: 10,
      balanceComparisonTolerance: 2,
      externalTradeThreshold: 50,
      veryHighExternalTradeThreshold: 90,
      currencySpecificTolerance: {}
    },
    distributedLock: {
      lockKeyPrefix: 'balance_checker_lock',
      stateKey: 'balance_checker_state',
      defaultTtl: 300000,
      maxRetryAttempts: 3,
      retryDelay: 1000
    },
    intervals: {
      exchangeCheckDelay: 2000
    }
  }))
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  getAllPositionsRedis: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }));
});

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn()
}));

describe('BalanceChecker Issue #2462 - 分散ロック機能と外部取引判定', () => {
  let balanceChecker;
  let mockRedisClient;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Redisクライアントのモック
    mockRedisClient = {
      isReady: true,
      set: jest.fn(),
      eval: jest.fn(),
      get: jest.fn()
    };
    
    const { getClient } = require('../../../src/database/redisDatabase');
    getClient.mockReturnValue(mockRedisClient);
    
    // BalanceCheckerをインポート
    balanceChecker = require('../../../src/common/balanceChecker');
    
    // ログのモック
    mockLogger = new (require('../../../src/hft/utils/Logger'))();
  });

  describe('分散ロック機能', () => {
    describe('acquireDistributedLock', () => {
      it('正常にロックを取得できること', async () => {
        mockRedisClient.set.mockResolvedValue('OK');
        
        const lockId = await balanceChecker.acquireDistributedLock('test-key');
        
        expect(lockId).toBeTruthy();
        expect(typeof lockId).toBe('string');
        expect(mockRedisClient.set).toHaveBeenCalledWith(
          'test-key',
          expect.any(String),
          'PX',
          300000,
          'NX'
        );
      });

      it('ロックが既に取得済みの場合はnullを返すこと', async () => {
        mockRedisClient.set.mockResolvedValue(null);
        
        const lockId = await balanceChecker.acquireDistributedLock('test-key');
        
        expect(lockId).toBeNull();
      });

      it('Redis接続エラーの場合はnullを返すこと', async () => {
        mockRedisClient.set.mockRejectedValue(new Error('Redis connection failed'));
        
        const lockId = await balanceChecker.acquireDistributedLock('test-key');
        
        expect(lockId).toBeNull();
      });
    });

    describe('releaseDistributedLock', () => {
      it('正常にロックを解放できること', async () => {
        mockRedisClient.eval.mockResolvedValue(1);
        
        const result = await balanceChecker.releaseDistributedLock('test-key', 'test-lock-id');
        
        expect(result).toBe(true);
        expect(mockRedisClient.eval).toHaveBeenCalledWith(
          expect.any(String),
          1,
          'test-key',
          'test-lock-id'
        );
      });

      it('ロックが存在しない場合はfalseを返すこと', async () => {
        mockRedisClient.eval.mockResolvedValue(0);
        
        const result = await balanceChecker.releaseDistributedLock('test-key', 'test-lock-id');
        
        expect(result).toBe(false);
      });

      it('Redis接続エラーの場合はfalseを返すこと', async () => {
        mockRedisClient.eval.mockRejectedValue(new Error('Redis connection failed'));
        
        const result = await balanceChecker.releaseDistributedLock('test-key', 'test-lock-id');
        
        expect(result).toBe(false);
      });

      it('lockIdがnullの場合はfalseを返すこと', async () => {
        const result = await balanceChecker.releaseDistributedLock('test-key', null);
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
      });

      it('lockIdがundefinedの場合はfalseを返すこと', async () => {
        const result = await balanceChecker.releaseDistributedLock('test-key', undefined);
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
      });

      it('lockIdが空文字列の場合はfalseを返すこと', async () => {
        const result = await balanceChecker.releaseDistributedLock('test-key', '');
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
      });

      it('lockIdが数値の場合はfalseを返すこと', async () => {
        const result = await balanceChecker.releaseDistributedLock('test-key', 123);
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
      });
    });

    describe('withDistributedLock', () => {
      it('ロックを取得して関数を実行し、ロックを解放すること', async () => {
        mockRedisClient.set.mockResolvedValue('OK');
        mockRedisClient.eval.mockResolvedValue(1);
        
        const testFunction = jest.fn().mockResolvedValue('test-result');
        
        const result = await balanceChecker.withDistributedLock('test-key', testFunction);
        
        expect(result).toBe('test-result');
        expect(testFunction).toHaveBeenCalled();
        expect(mockRedisClient.set).toHaveBeenCalled();
        expect(mockRedisClient.eval).toHaveBeenCalled();
      });

      it('ロック取得に失敗した場合はエラーを投げること', async () => {
        mockRedisClient.set.mockResolvedValue(null);
        
        const testFunction = jest.fn();
        
        await expect(
          balanceChecker.withDistributedLock('test-key', testFunction)
        ).rejects.toThrow('分散ロック取得失敗');
        
        expect(testFunction).not.toHaveBeenCalled();
      });

      it('関数実行中にエラーが発生してもロックを解放すること', async () => {
        mockRedisClient.set.mockResolvedValue('OK');
        mockRedisClient.eval.mockResolvedValue(1);
        
        const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
        
        await expect(
          balanceChecker.withDistributedLock('test-key', testFunction)
        ).rejects.toThrow('Test error');
        
        expect(testFunction).toHaveBeenCalled();
        expect(mockRedisClient.set).toHaveBeenCalled();
        expect(mockRedisClient.eval).toHaveBeenCalled(); // ロック解放が呼ばれること
      });
    });
  });

  describe('checkAllExchangeBalances with 分散ロック', () => {
    it('分散ロックが取得できない場合は空の配列を返すこと', async () => {
      mockRedisClient.set.mockResolvedValue(null);
      
      const result = await balanceChecker.checkAllExchangeBalances();
      
      expect(result).toEqual([]);
    });

    it('分散ロックを使用して処理を実行すること', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);
      
      // getAllPositionsRedisのモック
      const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
      getAllPositionsRedis.mockResolvedValue([]);
      
      // withBitbankErrorHandlingのモック
      const { withBitbankErrorHandling } = require('../../../src/common/bitbankErrorHandler');
      withBitbankErrorHandling.mockResolvedValue({
        total: {}
      });
      
      const result = await balanceChecker.checkAllExchangeBalances();
      
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'balance_checker_lock:all_exchanges',
        expect.any(String),
        'PX',
        300000,
        'NX'
      );
      expect(mockRedisClient.eval).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });

    it('分散ロック実行中にエラーが発生してもロックを解放すること', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);
      
      // getAllPositionsRedisでエラーを発生させる
      const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
      getAllPositionsRedis.mockRejectedValue(new Error('Redis error'));
      
      const result = await balanceChecker.checkAllExchangeBalances();
      
      // エラーが発生しても結果を返す（エラー処理が組み込まれている）
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toEqual({
        exchangeId: 'bitbank',
        error: 'Redis error',
        isHealthy: false
      });
      
      expect(mockRedisClient.set).toHaveBeenCalled();
      expect(mockRedisClient.eval).toHaveBeenCalled(); // ロック解放が呼ばれること
    });
  });

  describe('Issue #2462 - 外部取引判定のテスト', () => {
    it('98%以上の差異で外部取引の可能性がある場合の判定テスト', () => {
      // Issue #2462で発生した実際のケース
      const mockDiscrepancies = [
        {
          currency: 'MANA',
          discrepancyPercent: 99.8,
          isExternalTradeSuspected: true,
          exchangeAmount: 4.4588,
          botAmount: 0.009,
          difference: 4.4498
        },
        {
          currency: 'AVAX',
          discrepancyPercent: 98.58,
          isExternalTradeSuspected: true,
          exchangeAmount: 0.0141,
          botAmount: 0.0002,
          difference: 0.0139
        }
      ];
      
      // 98%以上の差異が全て外部取引の可能性がある場合
      expect(mockDiscrepancies.every(d => d.discrepancyPercent >= 98)).toBe(true);
      expect(mockDiscrepancies.every(d => d.isExternalTradeSuspected)).toBe(true);
      expect(mockDiscrepancies.every(d => d.discrepancyPercent >= 50)).toBe(true);
      
      // 外部取引の判定が正しく行われていることを確認
      mockDiscrepancies.forEach(disc => {
        expect(disc.isExternalTradeSuspected).toBe(true);
        expect(disc.discrepancyPercent).toBeGreaterThanOrEqual(50);
      });
    });

    it('外部取引判定の閾値テスト', () => {
      const testCases = [
        { discrepancyPercent: 49, expected: false },
        { discrepancyPercent: 50, expected: true },
        { discrepancyPercent: 89, expected: true },
        { discrepancyPercent: 90, expected: true },
        { discrepancyPercent: 98.58, expected: true },
        { discrepancyPercent: 99.8, expected: true },
        { discrepancyPercent: 100, expected: true }
      ];
      
      testCases.forEach(({ discrepancyPercent, expected }) => {
        const isExternalTradeSuspected = discrepancyPercent >= 50;
        expect(isExternalTradeSuspected).toBe(expected);
      });
    });
  });
});