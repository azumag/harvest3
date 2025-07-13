/**
 * 戦略無効化制御機能のテスト (Issue #436)
 * 戦略の無効化を禁止し、backtestによるパラメータアップデートの無効化のみ有効とする機能のテスト
 */

// モック化
jest.mock('../../../src/database/redisDatabase', () => ({
  getStrategyParametersRedis: jest.fn(),
  saveStrategyParametersRedis: jest.fn()
}));

const { disableStrategy, disableStrategyLegacy } = require('../../../src/config/strategyManager');
const { getStrategyParametersRedis, saveStrategyParametersRedis } = require('../../../src/database/redisDatabase');

describe('戦略無効化制御機能テスト (Issue #436)', () => {
  const mockExchangeId = 'test-exchange';
  const mockSymbol = 'BTC/JPY';
  const mockStrategyKey = 'testStrategy';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // デフォルトのモック実装
    getStrategyParametersRedis.mockResolvedValue({
      enabled: true,
      param1: 'value1'
    });
    saveStrategyParametersRedis.mockResolvedValue(true);
  });

  describe('disableStrategy - 権限チェック付き', () => {
    it('手動無効化が禁止されている場合、手動無効化を拒否する', async () => {
      const config = {
        global: {
          backtest: {
            strategyInvalidation: {
              allowManualDisable: false,
              allowBacktestParameterDisable: true
            }
          }
        }
      };

      const result = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        false // 手動無効化
      );

      expect(result).toBe(false);
      expect(saveStrategyParametersRedis).not.toHaveBeenCalled();
    });

    it('バックテストパラメータ更新による無効化が禁止されている場合、バックテスト無効化を拒否する', async () => {
      const config = {
        global: {
          backtest: {
            strategyInvalidation: {
              allowManualDisable: true,
              allowBacktestParameterDisable: false
            }
          }
        }
      };

      const result = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        true // バックテストパラメータ更新
      );

      expect(result).toBe(false);
      expect(saveStrategyParametersRedis).not.toHaveBeenCalled();
    });

    it('手動無効化が許可されている場合、手動無効化を実行する', async () => {
      const config = {
        global: {
          backtest: {
            strategyInvalidation: {
              allowManualDisable: true,
              allowBacktestParameterDisable: true
            }
          }
        }
      };

      const result = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        false // 手動無効化
      );

      expect(result).toBe(true);
      expect(getStrategyParametersRedis).toHaveBeenCalledWith(mockExchangeId, mockSymbol, mockStrategyKey);
      expect(saveStrategyParametersRedis).toHaveBeenCalledWith(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        expect.objectContaining({ enabled: false })
      );
    });

    it('バックテストパラメータ更新による無効化が許可されている場合、バックテスト無効化を実行する', async () => {
      const config = {
        global: {
          backtest: {
            strategyInvalidation: {
              allowManualDisable: false,
              allowBacktestParameterDisable: true
            }
          }
        }
      };

      const result = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        true // バックテストパラメータ更新
      );

      expect(result).toBe(true);
      expect(getStrategyParametersRedis).toHaveBeenCalledWith(mockExchangeId, mockSymbol, mockStrategyKey);
      expect(saveStrategyParametersRedis).toHaveBeenCalledWith(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        expect.objectContaining({ enabled: false })
      );
    });

    it('設定が提供されていない場合、無効化を実行する（後方互換性）', async () => {
      const result = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey
        // config未提供
      );

      expect(result).toBe(true);
      expect(getStrategyParametersRedis).toHaveBeenCalledWith(mockExchangeId, mockSymbol, mockStrategyKey);
      expect(saveStrategyParametersRedis).toHaveBeenCalledWith(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        expect.objectContaining({ enabled: false })
      );
    });

    it('strategyInvalidation設定が存在しない場合、無効化を実行する', async () => {
      const config = {
        global: {
          backtest: {
            // strategyInvalidation設定なし
          }
        }
      };

      const result = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        false
      );

      expect(result).toBe(true);
      expect(saveStrategyParametersRedis).toHaveBeenCalled();
    });

    it('RedisDatabase エラー時にfalseを返す', async () => {
      getStrategyParametersRedis.mockRejectedValue(new Error('Redis connection error'));

      const config = {
        global: {
          backtest: {
            strategyInvalidation: {
              allowManualDisable: true,
              allowBacktestParameterDisable: true
            }
          }
        }
      };

      const result = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        false
      );

      expect(result).toBe(false);
    });
  });

  describe('disableStrategyLegacy - 後方互換性', () => {
    it('常に無効化を実行する（旧来の動作）', async () => {
      const result = await disableStrategyLegacy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey
      );

      expect(result).toBe(true);
      expect(getStrategyParametersRedis).toHaveBeenCalledWith(mockExchangeId, mockSymbol, mockStrategyKey);
      expect(saveStrategyParametersRedis).toHaveBeenCalledWith(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        expect.objectContaining({ enabled: false })
      );
    });

    it('エラー時にfalseを返す', async () => {
      saveStrategyParametersRedis.mockRejectedValue(new Error('Save error'));

      const result = await disableStrategyLegacy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey
      );

      expect(result).toBe(false);
    });
  });

  describe('統合テスト - 実際の設定パターン', () => {
    it('Issue #436要件: 手動無効化禁止、バックテストパラメータ更新無効化許可', async () => {
      const config = {
        global: {
          backtest: {
            strategyInvalidation: {
              allowManualDisable: false,           // 手動での戦略無効化を禁止
              allowBacktestParameterDisable: true  // バックテストによるパラメータ更新時の無効化のみ許可
            }
          }
        }
      };

      // 手動無効化は失敗
      const manualResult = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        false
      );
      expect(manualResult).toBe(false);

      // バックテストパラメータ更新による無効化は成功
      const backtestResult = await disableStrategy(
        mockExchangeId, 
        mockSymbol, 
        mockStrategyKey, 
        config, 
        true
      );
      expect(backtestResult).toBe(true);
    });
  });
});