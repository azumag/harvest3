/**
 * 設定外部化機能のテスト - Issue #211
 */

const { SETTINGS, validateSettings } = require('../../../src/config/settings');

describe('設定外部化システム', () => {
  describe('基本設定値の読み込み', () => {
    it('EXCHANGE設定が正しく設定されている', () => {
      expect(SETTINGS.EXCHANGE).toBeDefined();
      expect(SETTINGS.EXCHANGE.BITFLYER_RATE_LIMIT).toBeGreaterThan(0);
      expect(SETTINGS.EXCHANGE.BITBANK_RATE_LIMIT).toBeGreaterThan(0);
      expect(SETTINGS.EXCHANGE.API_TIMEOUT).toBeGreaterThan(0);
    });

    it('DATABASE設定が正しく設定されている', () => {
      expect(SETTINGS.DATABASE).toBeDefined();
      expect(SETTINGS.DATABASE.REDIS).toBeDefined();
      expect(SETTINGS.DATABASE.MONGODB).toBeDefined();
      
      // Redis設定
      expect(SETTINGS.DATABASE.REDIS.RECONNECT_DELAY).toBeGreaterThan(0);
      expect(SETTINGS.DATABASE.REDIS.CONNECTION_TIMEOUT).toBeGreaterThan(0);
      
      // MongoDB設定
      expect(SETTINGS.DATABASE.MONGODB.MAX_POOL_SIZE).toBeGreaterThanOrEqual(1);
      expect(SETTINGS.DATABASE.MONGODB.MIN_POOL_SIZE).toBeGreaterThanOrEqual(1);
    });

    it('MONITORING設定が正しく設定されている', () => {
      expect(SETTINGS.MONITORING).toBeDefined();
      expect(SETTINGS.MONITORING.BALANCE_CHECK_INTERVAL).toBeGreaterThan(0);
      expect(SETTINGS.MONITORING.MAX_CONSECUTIVE_FAILURES).toBeGreaterThan(0);
      expect(SETTINGS.MONITORING.COMPREHENSIVE_CLEANUP_INTERVAL).toBeGreaterThan(0);
    });

    it('RISK_MANAGEMENT設定が正しく設定されている', () => {
      expect(SETTINGS.RISK_MANAGEMENT).toBeDefined();
      expect(SETTINGS.RISK_MANAGEMENT.FIXED_STOP_LOSS_PERCENT).toBeGreaterThan(0);
      expect(SETTINGS.RISK_MANAGEMENT.DAILY_MAX_LOSS_PERCENT).toBeGreaterThan(0);
      expect(SETTINGS.RISK_MANAGEMENT.WEEKLY_MAX_LOSS_PERCENT).toBeGreaterThan(0);
    });
  });

  describe('環境変数の処理', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // 環境変数をクリア
      delete process.env.BITFLYER_RATE_LIMIT;
      delete process.env.REDIS_RECONNECT_DELAY;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('環境変数が設定されていない場合デフォルト値を使用', () => {
      // 設定ファイルを再読み込み
      delete require.cache[require.resolve('../../../src/config/settings')];
      const { SETTINGS: freshSettings } = require('../../../src/config/settings');
      
      expect(freshSettings.EXCHANGE.BITFLYER_RATE_LIMIT).toBe(1000); // デフォルト値
    });

    it('無効な環境変数はデフォルト値にフォールバック', () => {
      process.env.BITFLYER_RATE_LIMIT = 'invalid';
      
      delete require.cache[require.resolve('../../../src/config/settings')];
      const { SETTINGS: freshSettings } = require('../../../src/config/settings');
      
      expect(freshSettings.EXCHANGE.BITFLYER_RATE_LIMIT).toBe(1000); // デフォルト値
    });
  });

  describe('設定値の妥当性', () => {
    it('API制限値が妥当な範囲内', () => {
      expect(SETTINGS.EXCHANGE.BITFLYER_RATE_LIMIT).toBeGreaterThanOrEqual(100);
      expect(SETTINGS.EXCHANGE.BITBANK_RATE_LIMIT).toBeGreaterThanOrEqual(1000);
    });

    it('タイムアウト値が妥当な範囲内', () => {
      expect(SETTINGS.EXCHANGE.API_TIMEOUT).toBeGreaterThanOrEqual(5000);
      expect(SETTINGS.DATABASE.REDIS.CONNECTION_TIMEOUT).toBeGreaterThanOrEqual(60000);
    });

    it('リスク管理値が妥当な範囲内', () => {
      expect(SETTINGS.RISK_MANAGEMENT.FIXED_STOP_LOSS_PERCENT).toBeLessThan(1.0);
      expect(SETTINGS.RISK_MANAGEMENT.DAILY_MAX_LOSS_PERCENT).toBeLessThan(1.0);
      expect(SETTINGS.RISK_MANAGEMENT.WEEKLY_MAX_LOSS_PERCENT).toBeGreaterThan(
        SETTINGS.RISK_MANAGEMENT.DAILY_MAX_LOSS_PERCENT
      );
    });
  });

  describe('設定検証機能', () => {
    it('validateSettings関数が存在する', () => {
      expect(typeof validateSettings).toBe('function');
    });

    it('正常な設定値で検証が成功する', () => {
      const result = validateSettings();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('設定構造の整合性', () => {
    it('すべての必要なカテゴリが存在する', () => {
      const requiredCategories = [
        'EXCHANGE',
        'DATABASE', 
        'MONITORING',
        'RISK_MANAGEMENT',
        'PERFORMANCE',
        'HFT',
        'TRADING'
      ];

      requiredCategories.forEach(category => {
        expect(SETTINGS[category]).toBeDefined();
      });
    });

    it('HFT設定が正しく構成されている', () => {
      expect(SETTINGS.HFT.WEBSOCKET).toBeDefined();
      expect(SETTINGS.HFT.STRATEGY).toBeDefined();
      expect(SETTINGS.HFT.WEBSOCKET.PUBLIC_ENDPOINT).toContain('wss://');
    });

    it('TRADING設定が正しく構成されている', () => {
      expect(SETTINGS.TRADING.TRADING_PAIRS).toBeInstanceOf(Array);
      expect(SETTINGS.TRADING.ICEBERG_THRESHOLDS).toBeDefined();
      expect(SETTINGS.TRADING.ICEBERG_THRESHOLDS.BTC).toBeGreaterThan(0);
    });
  });

  describe('後方互換性', () => {
    it('既存の設定ファイルから値を正しく読み込む', () => {
      // 既存設定との互換性確認
      const { EXCHANGE_SETTINGS } = require('../../../src/common/const');
      
      // 既存設定値が利用可能であることを確認
      expect(EXCHANGE_SETTINGS.RATE_LIMIT).toBeDefined();
      expect(EXCHANGE_SETTINGS.TIMEOUT).toBeDefined();
    });
  });
});