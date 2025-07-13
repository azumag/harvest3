/**
 * 戦略有効化機能のテスト (Issue #408)
 * 無効な戦略の有効化機能のテスト
 */

// モック化
jest.mock('../../../src/database/redisDatabase', () => ({
  getStrategyParametersRedis: jest.fn(),
  saveStrategyParametersRedis: jest.fn()
}));

const { enableStrategy, isStrategyEnabled, getUnifiedStrategyConfig } = require('../../../src/config/strategyManager');
const { getStrategyParametersRedis, saveStrategyParametersRedis } = require('../../../src/database/redisDatabase');
const { config } = require('../../../src/config');

describe('戦略有効化機能テスト (Issue #408)', () => {
  const mockExchangeId = 'bitbank';
  const mockSymbol = 'BTC/JPY';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // デフォルトのモック実装
    getStrategyParametersRedis.mockResolvedValue(null); // Redis設定なし
    saveStrategyParametersRedis.mockResolvedValue(true);
  });

  describe('config.js の戦略有効化設定テスト', () => {
    it('MA戦略が有効化されていることを確認', () => {
      expect(config.strategies.MA.enabled).toBe(true);
      expect(config.strategies.MA.type).toBe('trend_following');
    });

    it('OSCILLATOR戦略が有効化されていることを確認', () => {
      expect(config.strategies.OSCILLATOR.enabled).toBe(true);
      expect(config.strategies.OSCILLATOR.type).toBe('mean_reversion');
    });

    it('RSI戦略が有効化されていることを確認', () => {
      expect(config.strategies.RSI.enabled).toBe(true);
      expect(config.strategies.RSI.type).toBe('mean_reversion');
    });

    it('MULTI_INDICATOR戦略が有効化されていることを確認', () => {
      expect(config.strategies.MULTI_INDICATOR.enabled).toBe(true);
      expect(config.strategies.MULTI_INDICATOR.type).toBe('composite');
    });

    it('OUTSIDE戦略が有効化されていることを確認（レガシー戦略）', () => {
      expect(config.strategies.OUTSIDE.enabled).toBe(true);
      expect(config.strategies.OUTSIDE.type).toBe('legacy');
      expect(config.strategies.OUTSIDE.function).toBe(null);
    });

    it('UNKNOWN戦略が有効化されていることを確認（レガシー戦略）', () => {
      expect(config.strategies.UNKNOWN.enabled).toBe(true);
      expect(config.strategies.UNKNOWN.type).toBe('legacy');
      expect(config.strategies.UNKNOWN.function).toBe(null);
    });
  });

  describe('enableStrategy 関数テスト', () => {
    it('戦略有効化が成功することを確認', async () => {
      const strategyKey = 'MA';
      
      const result = await enableStrategy(mockExchangeId, mockSymbol, strategyKey);

      expect(result).toBe(true);
      expect(getStrategyParametersRedis).toHaveBeenCalledWith(mockExchangeId, mockSymbol, strategyKey);
      expect(saveStrategyParametersRedis).toHaveBeenCalledWith(
        mockExchangeId, 
        mockSymbol, 
        strategyKey, 
        expect.objectContaining({ enabled: true })
      );
    });

    it('既存のパラメータを保持しつつ有効化されることを確認', async () => {
      const strategyKey = 'RSI';
      const existingParams = {
        period: 14,
        oversoldThreshold: 30,
        overboughtThreshold: 70,
        enabled: false
      };
      
      getStrategyParametersRedis.mockResolvedValue(existingParams);

      const result = await enableStrategy(mockExchangeId, mockSymbol, strategyKey);

      expect(result).toBe(true);
      expect(saveStrategyParametersRedis).toHaveBeenCalledWith(
        mockExchangeId, 
        mockSymbol, 
        strategyKey, 
        expect.objectContaining({
          period: 14,
          oversoldThreshold: 30,
          overboughtThreshold: 70,
          enabled: true
        })
      );
    });

    it('Redis エラー時に false を返すことを確認', async () => {
      getStrategyParametersRedis.mockRejectedValue(new Error('Redis connection error'));

      const result = await enableStrategy(mockExchangeId, mockSymbol, 'MA');

      expect(result).toBe(false);
    });

    it('保存エラー時に false を返すことを確認', async () => {
      saveStrategyParametersRedis.mockRejectedValue(new Error('Save error'));

      const result = await enableStrategy(mockExchangeId, mockSymbol, 'MA');

      expect(result).toBe(false);
    });
  });

  describe('isStrategyEnabled 関数テスト', () => {
    it('config.jsで有効化された戦略が有効と判定されることを確認', async () => {
      const result = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'MA');
      expect(result).toBe(true);
    });

    it('Redisで有効化された戦略が有効と判定されることを確認', async () => {
      getStrategyParametersRedis.mockResolvedValue({ enabled: true });

      const result = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'MA');
      expect(result).toBe(true);
    });

    it('Redisで無効化された戦略が無効と判定されることを確認（Redis優先）', async () => {
      getStrategyParametersRedis.mockResolvedValue({ enabled: false });

      const result = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'MA');
      expect(result).toBe(false);
    });

    it('存在しない戦略が無効と判定されることを確認', async () => {
      const result = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'NON_EXISTENT');
      expect(result).toBe(false);
    });
  });

  describe('getUnifiedStrategyConfig 関数テスト', () => {
    it('有効化された戦略の統一設定が正しく取得されることを確認', async () => {
      const result = await getUnifiedStrategyConfig(config, mockExchangeId, mockSymbol, 'MA');

      expect(result).not.toBeNull();
      expect(result.enabled).toBe(true);
      expect(result.type).toBe('trend_following');
      expect(result.shortPeriod).toBe(5);
      expect(result.longPeriod).toBe(20);
    });

    it('Redis設定がconfig.js設定を上書きすることを確認', async () => {
      const redisParams = {
        enabled: false,
        shortPeriod: 10,
        longPeriod: 30
      };
      getStrategyParametersRedis.mockResolvedValue(redisParams);

      const result = await getUnifiedStrategyConfig(config, mockExchangeId, mockSymbol, 'MA');

      expect(result.enabled).toBe(false); // Redis設定が優先
      expect(result.shortPeriod).toBe(10); // Redis設定が優先
      expect(result.longPeriod).toBe(30); // Redis設定が優先
      expect(result.type).toBe('trend_following'); // config.js設定が保持
    });

    it('レガシー戦略の統一設定が正しく取得されることを確認', async () => {
      const result = await getUnifiedStrategyConfig(config, mockExchangeId, mockSymbol, 'OUTSIDE');

      expect(result).not.toBeNull();
      expect(result.enabled).toBe(true);
      expect(result.type).toBe('legacy');
      expect(result.function).toBe(null);
    });
  });

  describe('統合テスト - 戦略有効化の完全フロー', () => {
    it('Issue #408対象戦略がすべて有効化されていることを確認', async () => {
      const targetStrategies = ['MA', 'OSCILLATOR', 'RSI', 'MULTI_INDICATOR', 'OUTSIDE', 'UNKNOWN'];
      
      for (const strategyKey of targetStrategies) {
        const isEnabled = await isStrategyEnabled(config, mockExchangeId, mockSymbol, strategyKey);
        expect(isEnabled).toBe(true);
        
        const unifiedConfig = await getUnifiedStrategyConfig(config, mockExchangeId, mockSymbol, strategyKey);
        expect(unifiedConfig).not.toBeNull();
        expect(unifiedConfig.enabled).toBe(true);
      }
    });

    it('戦略タイプ別の有効化状況を確認', async () => {
      // トレンドフォロー戦略
      const maEnabled = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'MA');
      expect(maEnabled).toBe(true);

      // 平均回帰戦略  
      const oscillatorEnabled = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'OSCILLATOR');
      const rsiEnabled = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'RSI');
      expect(oscillatorEnabled).toBe(true);
      expect(rsiEnabled).toBe(true);

      // 複合戦略
      const multiEnabled = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'MULTI_INDICATOR');
      expect(multiEnabled).toBe(true);

      // レガシー戦略
      const outsideEnabled = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'OUTSIDE');
      const unknownEnabled = await isStrategyEnabled(config, mockExchangeId, mockSymbol, 'UNKNOWN');
      expect(outsideEnabled).toBe(true);
      expect(unknownEnabled).toBe(true);
    });
  });
});