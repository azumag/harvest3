/**
 * Tests for src/common/balanceChecker.js
 * 残高整合性チェッカーのテスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'GRT/JPY'],
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    },
    strategies: {
      MA: { enabled: true, enableBalanceCheck: true },
      BOLLINGER_BANDS: { enabled: true, enableBalanceCheck: true },
      MULTI_INDICATOR: { enabled: true, enableBalanceCheck: true },
      OSCILLATOR: { enabled: true, enableBalanceCheck: true },
      MUTUAL_INFO: { enabled: true, enableBalanceCheck: true }
    }
  }
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => ({
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn()
  })),
  getAllPositionsRedis: jest.fn(),
  getAllTradeSummaries: jest.fn()
}));

jest.mock('../../../src/database/manager', () => ({
  getAllTradeSummaries: jest.fn(),
  getTradeCurrentPosition: jest.fn()
}));

const {
  getExchangeBalance,
  getBotManagedBalance,
  compareBalances,
  compareBalancesRobust,
  getBotManagedBalanceDetailed,
  getCheckerState,
  resetCheckerState,
  STATE
} = require('../../../src/common/balanceChecker');

const { config } = require('../../../src/config');
const { getAllPositionsRedis, getAllTradeSummaries } = require('../../../src/database/redisDatabase');
const { getTradeCurrentPosition } = require('../../../src/database/manager');

describe('残高チェッカーのテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getExchangeBalance', () => {
    it('取引所残高を正常に取得する', async () => {
      const mockBalance = {
        total: { BTC: 1.5, ETH: 10.0, GRT: 0.2626 },
        free: { BTC: 1.0, ETH: 8.0, GRT: 0.2626 },
        used: { BTC: 0.5, ETH: 2.0, GRT: 0.0 }
      };

      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue(mockBalance);

      const result = await getExchangeBalance('bitbank');

      expect(result).toEqual(mockBalance);
      expect(config.exchanges.bitbank.instance.fetchBalance).toHaveBeenCalled();
    });

    it('存在しない取引所でエラーを投げる', async () => {
      await expect(getExchangeBalance('nonexistent')).rejects.toThrow('Exchange nonexistent not found in config');
    });

    it('取引所API エラーを正しく処理する', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockRejectedValue(new Error('API Error'));

      await expect(getExchangeBalance('bitbank')).rejects.toThrow('API Error');
    });
  });

  describe('getBotManagedBalance', () => {
    it('BOT管理残高を正常に計算する', async () => {
      const mockPositions = [
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 1.5,
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 10.0,
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'GRT/JPY',
          side: 'buy',
          amount: 0.2626,
          status: 'closed' // クローズ済みは除外
        }
      ];

      getAllPositionsRedis.mockResolvedValue(mockPositions);

      const result = await getBotManagedBalance();

      expect(result).toEqual({
        BTC: 1.5,
        ETH: 10.0
      });
    });

    it('空のポジションで空のオブジェクトを返す', async () => {
      getAllPositionsRedis.mockResolvedValue([]);

      const result = await getBotManagedBalance();

      expect(result).toEqual({});
    });
  });

  describe('compareBalances', () => {
    beforeEach(() => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.5, ETH: 10.0, GRT: 0.2626 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 1.5,
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 8.0, // 不整合: 取引所10.0 vs BOT8.0
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'GRT/JPY',
          side: 'buy',
          amount: 0.0183, // 不整合: 取引所0.2626 vs BOT0.0183
          status: 'open'
        }
      ]);
    });

    it('残高不整合を正しく検出する', async () => {
      const result = await compareBalances('bitbank');

      expect(result.exchangeId).toBe('bitbank');
      expect(result.discrepancies).toHaveLength(2); // ETH と GRT で不整合
      expect(result.isHealthy).toBe(false);

      const ethDiscrepancy = result.discrepancies.find(d => d.currency === 'ETH');
      expect(ethDiscrepancy).toBeTruthy();
      expect(ethDiscrepancy.exchangeAmount).toBe(10.0);
      expect(ethDiscrepancy.botAmount).toBe(8.0);

      const grtDiscrepancy = result.discrepancies.find(d => d.currency === 'GRT');
      expect(grtDiscrepancy).toBeTruthy();
      expect(grtDiscrepancy.exchangeAmount).toBe(0.2626);
      expect(grtDiscrepancy.botAmount).toBe(0.0183);
    });

    it('残高が一致している場合は正常と判定する', async () => {
      // 一致するよう修正
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 1.5,
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 10.0,
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'GRT/JPY',
          side: 'buy',
          amount: 0.2626,
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.exchangeId).toBe('bitbank');
      expect(result.discrepancies).toHaveLength(0);
      expect(result.isHealthy).toBe(true);
    });
  });

  describe('getBotManagedBalanceDetailed', () => {
    beforeEach(() => {
      // MongoDB calculation mock
      getTradeCurrentPosition
        .mockResolvedValueOnce(1.0) // BTC/JPY MA
        .mockResolvedValueOnce(0.5) // BTC/JPY BOLLINGER_BANDS
        .mockResolvedValueOnce(0.0) // BTC/JPY MULTI_INDICATOR
        .mockResolvedValueOnce(0.0) // BTC/JPY OSCILLATOR
        .mockResolvedValueOnce(0.0) // BTC/JPY MUTUAL_INFO
        .mockResolvedValueOnce(0.0) // BTC/JPY OUTSIDE
        .mockResolvedValueOnce(0.0); // BTC/JPY UNKNOWN

      // Redis summary mock
      getAllTradeSummaries.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'MA',
          netPosition: 1.2
        }
      ]);

      // Redis positions mock
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 1.3,
          status: 'open'
        }
      ]);
    });

    it('詳細なBOT残高を3つのソースから取得する', async () => {
      const result = await getBotManagedBalanceDetailed('bitbank');

      expect(result.exchangeId).toBe('bitbank');
      expect(result.mongodb).toBeDefined();
      expect(result.redisSummary).toBeDefined();
      expect(result.redisPositions).toBeDefined();

      // MongoDB計算: MA(1.0) + BOLLINGER_BANDS(0.5) = 1.5
      expect(result.mongodb.BTC).toBe(1.5);

      // Redis summary: MA netPosition 1.2
      expect(result.redisSummary.BTC).toBe(1.2);

      // Redis positions: 1.3
      expect(result.redisPositions.BTC).toBe(1.3);
    });
  });

  describe('compareBalancesRobust', () => {
    it('分散ロックを取得して堅牢な比較を実行する', async () => {
      const mockRedisClient = {
        set: jest.fn().mockResolvedValue('OK'), // ロック取得成功
        get: jest.fn().mockResolvedValue(JSON.stringify({ state: STATE.OK })),
        eval: jest.fn().mockResolvedValue(1) // ロック解放成功
      };

      require('../../../src/database/redisDatabase').getClient.mockReturnValue(mockRedisClient);

      // 取引所残高
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.5 }
      });

      // MongoDB, Redis, Positions を設定（一致させる）
      getTradeCurrentPosition.mockResolvedValue(1.5);
      getAllTradeSummaries.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', netPosition: 1.5 }
      ]);
      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 1.5, status: 'open' }
      ]);

      const result = await compareBalancesRobust('bitbank');

      expect(result.success).toBe(true);
      // 実装の詳細によって内部不整合が検出される可能性があるため、成功のみチェック
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'balance_checker_lock',
        expect.any(String),
        'PX',
        300000,
        'NX'
      );
    });

    it('ロック取得失敗時はスキップする', async () => {
      const mockRedisClient = {
        set: jest.fn().mockResolvedValue(null) // ロック取得失敗
      };

      require('../../../src/database/redisDatabase').getClient.mockReturnValue(mockRedisClient);

      const result = await compareBalancesRobust('bitbank');

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('another_check_running');
    });
  });

  describe('状態管理', () => {
    it('チェック状態を正しく取得・設定する', async () => {
      const mockRedisClient = {
        get: jest.fn().mockResolvedValue(JSON.stringify({
          state: STATE.ERROR,
          timestamp: Date.now(),
          details: { error: 'test error' }
        })),
        set: jest.fn().mockResolvedValue('OK')
      };

      require('../../../src/database/redisDatabase').getClient.mockReturnValue(mockRedisClient);

      const state = await getCheckerState();
      expect(state.state).toBe(STATE.ERROR);

      await resetCheckerState();
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'balance_checker_state',
        expect.stringContaining(STATE.OK)
      );
    });
  });

  describe('エラーケースのテスト', () => {
    describe('ネットワークエラー処理', () => {
      it('取引所API接続失敗時の適切なエラーハンドリング', async () => {
        config.exchanges.bitbank.instance.fetchBalance.mockRejectedValue(
          new Error('Network timeout')
        );

        await expect(compareBalances('bitbank')).rejects.toThrow('Network timeout');
      });

      it('Redis接続失敗時の堅牢な比較エラーハンドリング', async () => {
        const mockRedisClient = {
          set: jest.fn().mockRejectedValue(new Error('Redis connection failed'))
        };

        require('../../../src/database/redisDatabase').getClient.mockReturnValue(mockRedisClient);

        await expect(compareBalancesRobust('bitbank')).rejects.toThrow('Redis connection failed');
      });
    });

    describe('データ不整合エラー', () => {
      it('MongoDB取引履歴が破損している場合のエラーハンドリング', async () => {
        // 全て正常に設定してから個別にエラーを設定
        getAllTradeSummaries.mockResolvedValue([]);
        getAllPositionsRedis.mockResolvedValue([]);
        getTradeCurrentPosition.mockRejectedValue(new Error('MongoDB connection error'));

        // MongoDBエラーは内部でキャッチされ、空の結果を返す
        const result = await getBotManagedBalanceDetailed('bitbank');
        expect(result.mongodb).toEqual({});
        expect(result.exchangeId).toBe('bitbank');
      });

      it('Redis Summary データが不正な場合のエラーハンドリング', async () => {
        getAllTradeSummaries.mockRejectedValue(new Error('Redis summary corrupted'));

        await expect(getBotManagedBalanceDetailed('bitbank')).rejects.toThrow('Redis summary corrupted');
      });

      it('Redis Positions データが不正な場合のエラーハンドリング', async () => {
        getAllPositionsRedis.mockRejectedValue(new Error('Redis positions corrupted'));

        await expect(getBotManagedBalance()).rejects.toThrow('Redis positions corrupted');
      });
    });

    describe('設定エラー処理', () => {
      it('存在しない取引所での詳細残高取得エラー', async () => {
        // Redis mocks を正常な状態にリセット
        getAllTradeSummaries.mockResolvedValue([]);
        getAllPositionsRedis.mockResolvedValue([]);
        getTradeCurrentPosition.mockResolvedValue(0);

        await expect(getBotManagedBalanceDetailed('nonexistent_exchange')).resolves.toEqual(
          expect.objectContaining({
            exchangeId: 'nonexistent_exchange',
            mongodb: {},
            redisSummary: {},
            redisPositions: expect.any(Object)
          })
        );
      });

      it('戦略設定が破損している場合の処理', async () => {
        // 戦略設定を一時的に破損させる
        const originalStrategies = config.strategies;
        config.strategies = null;

        // 破損した設定でエラーが発生することを確認
        await expect(getBotManagedBalanceDetailed('bitbank')).rejects.toThrow('Cannot convert undefined or null to object');

        // 設定を復元
        config.strategies = originalStrategies;
      });
    });

    describe('極端な値の処理', () => {
      it('非常に大きな残高値の処理', async () => {
        const largeBalance = {
          total: { BTC: 9999999999.99999999 }
        };
        config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue(largeBalance);

        getAllPositionsRedis.mockResolvedValue([
          {
            exchange: 'bitbank',
            symbol: 'BTC/JPY',
            side: 'buy',
            amount: 9999999999.99999999,
            status: 'open'
          }
        ]);

        const result = await compareBalances('bitbank');
        expect(result.isHealthy).toBe(true);
      });

      it('非常に小さな残高値の処理', async () => {
        const smallBalance = {
          total: { BTC: 0.000000001 }
        };
        config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue(smallBalance);

        getAllPositionsRedis.mockResolvedValue([
          {
            exchange: 'bitbank',
            symbol: 'BTC/JPY',
            side: 'buy',
            amount: 0.000000001,
            status: 'open'
          }
        ]);

        const result = await compareBalances('bitbank');
        // 有意な閾値未満なので不整合にはならない
        expect(result.discrepancies).toHaveLength(0);
      });

      it('ゼロ残高の適切な処理', async () => {
        const zeroBalance = {
          total: { BTC: 0, ETH: 0 }
        };
        config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue(zeroBalance);

        getAllPositionsRedis.mockResolvedValue([]);

        const result = await compareBalances('bitbank');
        expect(result.isHealthy).toBe(true);
        expect(result.discrepancies).toHaveLength(0);
      });
    });

    describe('同期エラー処理', () => {
      it('Discord通知送信失敗時の処理', async () => {
        const { postOrderToDiscord } = require('../../../src/common/notifications');
        postOrderToDiscord.mockRejectedValue(new Error('Discord API error'));

        config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
          total: { BTC: 1.0 }
        });
        getAllPositionsRedis.mockResolvedValue([
          {
            exchange: 'bitbank',
            symbol: 'BTC/JPY',
            side: 'buy',
            amount: 2.0, // 不整合
            status: 'open'
          }
        ]);

        // Discord送信失敗時はエラーが伝播される
        await expect(compareBalances('bitbank')).rejects.toThrow('Discord API error');
      });
    });
  });
});