/**
 * BalanceIntegrityService単体テスト
 */

const { config } = require('../../../src/config');
const Decimal = require('decimal.js');

// タイマーのモック設定
jest.useFakeTimers();

// モックの設定
jest.mock('../../../src/database/manager', () => ({
  getCollectionRef: jest.fn(),
  ensureConnection: jest.fn()
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  getStrategyPositionsRedis: jest.fn(),
  getRedisClient: jest.fn()
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/common/utils', () => ({
  formatJST: jest.fn(() => '2025-07-10 12:34:56')
}));

jest.mock('../../../src/config', () => ({
  config: {
    global: {
      balanceIntegritySystem: {
        enabled: true,
        realTimeMonitoring: {
          enabled: true,
          interval: 60000,
          maxConcurrentChecks: 3,
          timeout: 30000
        },
        thresholds: {
          absoluteThreshold: 0.001,
          percentageThreshold: 1.0,
          warningThreshold: 0.5,
          criticalThreshold: 5.0
        },
        autoCorrection: {
          enabled: true,
          minorDiscrepancyThreshold: 0.01,
          majorDiscrepancyThreshold: 0.1,
          maxAutoCorrections: 3,
          requireManualApproval: false
        },
        tradingHalt: {
          enabled: true,
          majorDiscrepancyThreshold: 0.1,
          maxConsecutiveFailures: 3,
          cooldownPeriod: 300000
        }
      }
    },
    exchanges: {
      bitbank: {
        instance: {
          fetchBalance: jest.fn()
        }
      }
    },
    strategies: {
      arbitrage: { enabled: true },
      macd: { enabled: true }
    }
  }
}));

const { BalanceIntegrityService } = require('../../../src/services/balanceIntegrityService');

describe('BalanceIntegrityService', () => {
  let service;
  let mockRedisClient;
  let mockExchange;
  let mockCollection;

  beforeEach(() => {
    jest.clearAllMocks();

    // Redisクライアントのモック
    mockRedisClient = {
      hGetAll: jest.fn(),
      hSet: jest.fn(),
      hGet: jest.fn(),
      multi: jest.fn(),
      del: jest.fn()
    };

    const mockMulti = {
      hSet: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([])
    };
    mockRedisClient.multi.mockReturnValue(mockMulti);

    // 取引所インスタンスのモック
    mockExchange = config.exchanges.bitbank.instance;
    mockExchange.fetchBalance.mockResolvedValue({
      total: { BTC: 1.0, ETH: 10.0 },
      free: { BTC: 0.5, ETH: 5.0 },
      used: { BTC: 0.5, ETH: 5.0 }
    });

    // MongoDBコレクションのモック
    mockCollection = {
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([])
      }),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true })
    };

    const { getRedisClient, getStrategyPositionsRedis } = require('../../../src/database/redisDatabase');
    const { getCollectionRef } = require('../../../src/database/manager');

    getRedisClient.mockResolvedValue(mockRedisClient);
    getCollectionRef.mockReturnValue(mockCollection);
    getStrategyPositionsRedis.mockResolvedValue([]);

    service = new BalanceIntegrityService();
  });

  afterEach(async () => {
    // 各テスト後にサービスを停止してタイマーをクリア
    if (service && service.isRunning) {
      await service.stop();
    }
    // すべてのタイマーを実行してクリア
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
  });

  afterAll(() => {
    // テスト終了時にタイマーを実際のものに戻す
    jest.useRealTimers();
  });

  describe('start/stop', () => {
    it('サービスを正常に開始できる', async () => {
      await service.start();
      expect(service.isRunning).toBe(true);
    });

    it('サービスを正常に停止できる', async () => {
      await service.start();
      await service.stop();
      expect(service.isRunning).toBe(false);
    });

    it('設定が無効の場合は開始しない', async () => {
      config.global.balanceIntegritySystem.enabled = false;
      await service.start();
      expect(service.isRunning).toBe(false);
    });
  });

  describe('compareAllDataSources', () => {
    it('3つのデータソース間の不整合を検出する', async () => {
      const exchangeBalances = {
        bitbank: {
          used: {
            BTC: 1.0,
            ETH: 10.0
          }
        }
      };

      const redisBalances = {
        BTC: { total: 0.99, strategies: {} },
        ETH: { total: 10.05, strategies: {} }
      };

      const mongoBalances = {
        BTC: { netPosition: 1.01 },
        ETH: { netPosition: 9.98 }
      };

      const discrepancies = await service.compareAllDataSources(
        exchangeBalances,
        redisBalances,
        mongoBalances
      );

      expect(discrepancies).toHaveLength(1); // 不整合検出
      expect(discrepancies[0].currency).toBeDefined();
      expect(['BTC', 'ETH']).toContain(discrepancies[0].currency); // いずれかの通貨
      expect(['minor', 'warning', 'critical']).toContain(discrepancies[0].severity);
    });

    it('閾値内の差異は無視する', async () => {
      const exchangeBalances = {
        bitbank: {
          used: {
            BTC: 1.0
          }
        }
      };

      const redisBalances = {
        BTC: { total: 1.0001, strategies: {} }
      };

      const mongoBalances = {
        BTC: { netPosition: 1.0 }
      };

      const discrepancies = await service.compareAllDataSources(
        exchangeBalances,
        redisBalances,
        mongoBalances
      );

      expect(discrepancies).toHaveLength(0);
    });
  });

  describe('calculateSeverity', () => {
    it('深刻度を正しく計算する', () => {
      expect(service.calculateSeverity(0.3)).toBe('minor');
      expect(service.calculateSeverity(0.7)).toBe('warning');
      expect(service.calculateSeverity(6.0)).toBe('critical');
    });
  });

  describe('shouldAutoCorrect', () => {
    beforeEach(() => {
      service.dailyAutoCorrections = 0;
    });

    it('自動修正が有効で条件を満たす場合はtrueを返す', () => {
      const discrepancy = {
        discrepancies: { max: 0.005 }
      };

      expect(service.shouldAutoCorrect(discrepancy)).toBe(true);
    });

    it('自動修正が無効の場合はfalseを返す', () => {
      config.global.balanceIntegritySystem.autoCorrection.enabled = false;
      const discrepancy = {
        discrepancies: { max: 0.005 }
      };

      expect(service.shouldAutoCorrect(discrepancy)).toBe(false);
    });

    it('重大な不整合の場合はfalseを返す', () => {
      const discrepancy = {
        discrepancies: { max: 0.2 }
      };

      expect(service.shouldAutoCorrect(discrepancy)).toBe(false);
    });

    it('1日の最大回数を超えた場合はfalseを返す', () => {
      service.dailyAutoCorrections = 3;
      const discrepancy = {
        discrepancies: { max: 0.005 }
      };

      expect(service.shouldAutoCorrect(discrepancy)).toBe(false);
    });
  });

  describe('performCorrection', () => {
    it('手動承認が不要な場合は自動修正を実行する', async () => {
      config.global.balanceIntegritySystem.autoCorrection.requireManualApproval = false;

      const discrepancy = {
        currency: 'BTC',
        exchangeBalance: 1.0,
        redisBalance: 0.99,
        discrepancies: { max: 0.01 }
      };

      const result = await service.performCorrection(discrepancy);

      expect(result.success).toBe(true);
      expect(result.action).toBe('auto_corrected');
      expect(mockRedisClient.multi).toHaveBeenCalled();
    });

    it('手動承認が必要な場合は承認要求を返す', async () => {
      config.global.balanceIntegritySystem.autoCorrection.requireManualApproval = true;

      const discrepancy = {
        currency: 'BTC',
        exchangeBalance: 1.0,
        redisBalance: 0.99,
        discrepancies: { max: 0.01 }
      };

      const result = await service.performCorrection(discrepancy);

      expect(result.success).toBe(false);
      expect(result.action).toBe('manual_approval_required');
      expect(mockRedisClient.multi).not.toHaveBeenCalled();
    });

    it('無効なデータの場合はエラーを返す', async () => {
      const result = await service.performCorrection(null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('無効な不整合データ');
    });

    it('取引所残高が無効な場合はエラーを返す', async () => {
      const discrepancy = {
        currency: 'BTC',
        exchangeBalance: -1.0,
        redisBalance: 0.99,
        discrepancies: { max: 0.01 }
      };

      const result = await service.performCorrection(discrepancy);

      expect(result.success).toBe(false);
      expect(result.error).toContain('取引所残高の検証失敗');
    });
  });

  describe('considerTradingHalt', () => {
    it('重大な不整合で取引停止を実行する', async () => {
      const discrepancy = {
        discrepancies: { max: 0.2 }
      };

      await service.considerTradingHalt(discrepancy);

      expect(service.tradingHalted).toBe(true);

      // タイマーをスキップして即座に実行
      jest.runAllTimers();
    });

    it('取引停止が無効の場合は実行しない', async () => {
      config.global.balanceIntegritySystem.tradingHalt.enabled = false;
      const discrepancy = {
        discrepancies: { max: 0.2 }
      };

      await service.considerTradingHalt(discrepancy);

      expect(service.tradingHalted).toBe(false);
    });
  });

  describe('メトリクス更新', () => {
    it('チェック後にメトリクスが更新される', () => {
      const startTime = Date.now() - 100;
      const discrepancies = [
        { currency: 'BTC' },
        { currency: 'ETH' }
      ];

      service.updateMetrics(startTime, discrepancies);

      expect(service.metrics.totalChecks).toBe(1);
      expect(service.metrics.discrepanciesFound).toBe(2);
      expect(service.metrics.lastCheckTime).toBeInstanceOf(Date);
      expect(service.metrics.averageCheckTime).toBeGreaterThan(0);
    });
  });
});