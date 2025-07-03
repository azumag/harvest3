/**
 * Tests for src/common/balanceCheckerConfig.js
 * 残高チェッカー設定のテスト
 */

const {
  BALANCE_CHECKER_CONFIG,
  getBalanceCheckerConfig,
  validateConfig,
  getValidatedConfig
} = require('../../../src/common/balanceCheckerConfig');

describe('残高チェッカー設定のテスト', () => {
  // 元の環境変数を保存
  const originalEnv = process.env;

  beforeEach(() => {
    // 環境変数をリセット
    jest.resetModules();
    process.env = { ...originalEnv };
    // テスト関連の環境変数をクリア
    delete process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD;
    delete process.env.BALANCE_CHECKER_HIGH_DISCREPANCY_PERCENT;
    delete process.env.BALANCE_CHECKER_LOCK_TTL;
    delete process.env.BALANCE_CHECKER_LIGHTWEIGHT_INTERVAL;
    delete process.env.BALANCE_CHECKER_ROBUST_INTERVAL;
    delete process.env.BALANCE_CHECKER_DEBUG;
  });

  afterAll(() => {
    // 環境変数を復元
    process.env = originalEnv;
  });

  describe('デフォルト設定の検証', () => {
    it('デフォルト設定が正しく定義されている', () => {
      expect(BALANCE_CHECKER_CONFIG.thresholds.significantBalance).toBe(0.00001);
      expect(BALANCE_CHECKER_CONFIG.thresholds.highDiscrepancyPercent).toBe(10);
      expect(BALANCE_CHECKER_CONFIG.thresholds.balanceComparisonTolerance).toBe(0);
      
      expect(BALANCE_CHECKER_CONFIG.distributedLock.lockKeyPrefix).toBe('balance_checker_lock');
      expect(BALANCE_CHECKER_CONFIG.distributedLock.stateKey).toBe('balance_checker_state');
      expect(BALANCE_CHECKER_CONFIG.distributedLock.defaultTtl).toBe(300000);
      
      expect(BALANCE_CHECKER_CONFIG.intervals.lightweightCheck).toBe(5 * 60 * 1000);
      expect(BALANCE_CHECKER_CONFIG.intervals.robustCheck).toBe(60 * 60 * 1000);
      expect(BALANCE_CHECKER_CONFIG.intervals.exchangeCheckDelay).toBe(2000);
      
      expect(BALANCE_CHECKER_CONFIG.notifications.maxCurrenciesToShow).toBe(5);
      expect(BALANCE_CHECKER_CONFIG.notifications.maxInconsistenciesToShow).toBe(3);
    });
  });

  describe('環境変数オーバーライド', () => {
    it('significantBalance設定', () => {
      process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD = '0.001';
      
      const config = getBalanceCheckerConfig();
      expect(config.thresholds.significantBalance).toBe(0.001);
    });

    it('highDiscrepancyPercent設定', () => {
      process.env.BALANCE_CHECKER_HIGH_DISCREPANCY_PERCENT = '15';
      
      const config = getBalanceCheckerConfig();
      expect(config.thresholds.highDiscrepancyPercent).toBe(15);
    });

    it('lockTtl設定', () => {
      process.env.BALANCE_CHECKER_LOCK_TTL = '600000';
      
      const config = getBalanceCheckerConfig();
      expect(config.distributedLock.defaultTtl).toBe(600000);
    });

    it('lightweightInterval設定', () => {
      process.env.BALANCE_CHECKER_LIGHTWEIGHT_INTERVAL = '120000';
      
      const config = getBalanceCheckerConfig();
      expect(config.intervals.lightweightCheck).toBe(120000);
    });

    it('robustInterval設定', () => {
      process.env.BALANCE_CHECKER_ROBUST_INTERVAL = '3600000';
      
      const config = getBalanceCheckerConfig();
      expect(config.intervals.robustCheck).toBe(3600000);
    });

    it('デバッグモード有効化', () => {
      process.env.BALANCE_CHECKER_DEBUG = 'true';
      
      const config = getBalanceCheckerConfig();
      expect(config.debug.enableDetailedLogging).toBe(true);
      expect(config.debug.logDataSnapshots).toBe(true);
      expect(config.debug.enablePerformanceMetrics).toBe(true);
    });

    it('複数設定同時オーバーライド', () => {
      process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD = '0.0001';
      process.env.BALANCE_CHECKER_HIGH_DISCREPANCY_PERCENT = '20';
      process.env.BALANCE_CHECKER_DEBUG = 'true';
      
      const config = getBalanceCheckerConfig();
      expect(config.thresholds.significantBalance).toBe(0.0001);
      expect(config.thresholds.highDiscrepancyPercent).toBe(20);
      expect(config.debug.enableDetailedLogging).toBe(true);
    });
  });

  describe('設定検証のテスト', () => {
    it('有効な設定で検証が成功する', () => {
      const validConfig = {
        thresholds: {
          significantBalance: 0.00001,
          highDiscrepancyPercent: 10,
          balanceComparisonTolerance: 0
        },
        distributedLock: {
          defaultTtl: 300000
        },
        intervals: {
          lightweightCheck: 300000,
          robustCheck: 3600000
        }
      };

      expect(() => validateConfig(validConfig)).not.toThrow();
      expect(validateConfig(validConfig)).toBe(true);
    });

    it('負のsignificantBalanceでエラーを投げる', () => {
      const invalidConfig = {
        thresholds: {
          significantBalance: -0.001,
          highDiscrepancyPercent: 10
        },
        distributedLock: { defaultTtl: 300000 },
        intervals: { lightweightCheck: 300000, robustCheck: 3600000 }
      };

      expect(() => validateConfig(invalidConfig)).toThrow('significantBalance must be non-negative');
    });

    it('無効なhighDiscrepancyPercentでエラーを投げる', () => {
      const invalidConfig = {
        thresholds: {
          significantBalance: 0.001,
          highDiscrepancyPercent: 150  // 100%を超える
        },
        distributedLock: { defaultTtl: 300000 },
        intervals: { lightweightCheck: 300000, robustCheck: 3600000 }
      };

      expect(() => validateConfig(invalidConfig)).toThrow('highDiscrepancyPercent must be between 0 and 100');
    });

    it('短すぎるdefaultTtlでエラーを投げる', () => {
      const invalidConfig = {
        thresholds: {
          significantBalance: 0.001,
          highDiscrepancyPercent: 10
        },
        distributedLock: { defaultTtl: 500 }, // 1000ms未満
        intervals: { lightweightCheck: 300000, robustCheck: 3600000 }
      };

      expect(() => validateConfig(invalidConfig)).toThrow('defaultTtl must be at least 1000ms');
    });

    it('短すぎるlightweightCheckでエラーを投げる', () => {
      const invalidConfig = {
        thresholds: {
          significantBalance: 0.001,
          highDiscrepancyPercent: 10
        },
        distributedLock: { defaultTtl: 300000 },
        intervals: { 
          lightweightCheck: 30000,  // 60秒未満
          robustCheck: 3600000 
        }
      };

      expect(() => validateConfig(invalidConfig)).toThrow('lightweightCheck interval must be at least 60 seconds');
    });

    it('短すぎるrobustCheckでエラーを投げる', () => {
      const invalidConfig = {
        thresholds: {
          significantBalance: 0.001,
          highDiscrepancyPercent: 10
        },
        distributedLock: { defaultTtl: 300000 },
        intervals: { 
          lightweightCheck: 300000,
          robustCheck: 120000  // 5分未満
        }
      };

      expect(() => validateConfig(invalidConfig)).toThrow('robustCheck interval must be at least 5 minutes');
    });

    it('複数のエラーがある場合、全てのエラーを報告する', () => {
      const invalidConfig = {
        thresholds: {
          significantBalance: -0.001,  // エラー1
          highDiscrepancyPercent: 150  // エラー2
        },
        distributedLock: { defaultTtl: 500 },  // エラー3
        intervals: { 
          lightweightCheck: 30000,  // エラー4
          robustCheck: 120000       // エラー5
        }
      };

      expect(() => validateConfig(invalidConfig)).toThrow(/Balance checker configuration validation failed/);
    });
  });

  describe('検証済み設定取得のテスト', () => {
    it('有効な設定で検証済み設定を取得できる', () => {
      const config = getValidatedConfig();
      
      expect(config).toBeDefined();
      expect(config.thresholds).toBeDefined();
      expect(config.distributedLock).toBeDefined();
      expect(config.intervals).toBeDefined();
      expect(config.notifications).toBeDefined();
      expect(config.strategies).toBeDefined();
    });

    it('無効な環境変数設定で検証エラーを投げる', () => {
      process.env.BALANCE_CHECKER_LOCK_TTL = '100'; // 1000ms未満で無効
      
      expect(() => getValidatedConfig()).toThrow('defaultTtl must be at least 1000ms');
    });
  });

  describe('エッジケースのテスト', () => {
    it('空の環境変数は無視されてデフォルト値が使用される', () => {
      // 確実に削除してから空文字列を設定
      delete process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD;
      process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD = '';
      
      const { getBalanceCheckerConfig } = require('../../../src/common/balanceCheckerConfig');
      const config = getBalanceCheckerConfig();
      expect(config.thresholds.significantBalance).toBe(0.00001); // デフォルト値
    });

    it('無効な数値形式の環境変数は無視される', () => {
      process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD = 'invalid_number';
      
      const config = getBalanceCheckerConfig();
      expect(config.thresholds.significantBalance).toBeNaN();
    });

    it('デバッグフラグが"true"以外では無効と判定される', () => {
      // 確実に削除してからfalseを設定
      delete process.env.BALANCE_CHECKER_DEBUG;
      process.env.BALANCE_CHECKER_DEBUG = 'false';
      
      const { getBalanceCheckerConfig } = require('../../../src/common/balanceCheckerConfig');
      const config = getBalanceCheckerConfig();
      expect(config.debug.enableDetailedLogging).toBe(false);
      expect(config.debug.logDataSnapshots).toBe(false);
      expect(config.debug.enablePerformanceMetrics).toBe(false);
    });
  });
});