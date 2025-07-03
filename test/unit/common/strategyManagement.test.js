/**
 * 統一戦略管理のテスト
 * geminiレビュー対応：戦略管理の冗長性解決のテスト
 * 更新: enableBalanceCheck削除に伴う純粋な型ベースフィルタリングへの移行
 */

const { config } = require('../../../src/config');
const { getBalanceCheckEligibleStrategies } = require('../../../src/common/strategyUtils');

describe('統一戦略管理', () => {
  describe('型ベースフィルタリング', () => {
    test('残高チェック有効な戦略が正しく設定されている', () => {
      // 型ベースフィルタリングによる残高チェック対象戦略の取得
      const strategies = getBalanceCheckEligibleStrategies(config);

      // 期待される戦略が含まれていることを確認
      const expectedStrategies = [
        'MACD', 'BOLLINGER_BANDS', 'MA', 'OSCILLATOR', 
        'RSI', 'MULTI_INDICATOR', 'MUTUAL_INFO', 'MEAN_REVERSION'
      ];

      expectedStrategies.forEach(expectedStrategy => {
        // 環境変数依存の戦略は、無効化されている場合は含まれない
        const strategy = config.strategies[expectedStrategy];
        const isEnabled = expectedStrategy === 'OSCILLATOR' ? process.env.STRATEGY_OSCILLATOR_ENABLED === 'true' :
                         expectedStrategy === 'RSI' ? process.env.STRATEGY_RSI_ENABLED === 'true' :
                         expectedStrategy === 'MULTI_INDICATOR' ? process.env.STRATEGY_MULTI_INDICATOR_ENABLED === 'true' :
                         strategy.enabled;
        
        if (isEnabled) {
          expect(strategies).toContain(expectedStrategy);
        }
      });

      // HFT戦略は含まれていないことを確認
      expect(strategies).not.toContain('HFT');
    });

    test('HFT戦略は型ベースフィルタリングにより除外される', () => {
      const hftStrategy = config.strategies.HFT;
      expect(hftStrategy.type).toBe('high_frequency');
      
      // HFTが有効でも型ベースフィルタリングにより除外されることを確認
      const mockConfig = {
        strategies: {
          HFT: {
            type: 'high_frequency',
            enabled: true
          }
        }
      };
      
      const strategies = getBalanceCheckEligibleStrategies(mockConfig);
      expect(strategies).not.toContain('HFT');
    });

    test('OUTSIDE戦略が正しく設定されている', () => {
      const outsideStrategy = config.strategies.OUTSIDE;
      expect(outsideStrategy).toBeDefined();
      expect(outsideStrategy.type).toBe('legacy');
      expect(outsideStrategy.enabled).toBe(false);
      expect(outsideStrategy.function).toBe(null);
    });

    test('UNKNOWN戦略が正しく設定されている', () => {
      const unknownStrategy = config.strategies.UNKNOWN;
      expect(unknownStrategy).toBeDefined();
      expect(unknownStrategy.type).toBe('legacy');
      expect(unknownStrategy.enabled).toBe(false);
      expect(unknownStrategy.function).toBe(null);
    });

    test('enableBalanceCheck プロパティが削除されている', () => {
      // 全ての戦略からenableBalanceCheckプロパティが削除されていることを確認
      Object.keys(config.strategies).forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.enableBalanceCheck).toBeUndefined();
      });
    });
  });

  describe('戦略設定の整合性', () => {
    test('全ての戦略に型が定義されている', () => {
      Object.keys(config.strategies).forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.type).toBeDefined();
        expect(typeof strategy.type).toBe('string');
      });
    });

    test('レガシー戦略（OUTSIDE, UNKNOWN）は無効化されているが型ベースフィルタリング対象', () => {
      const legacyStrategies = ['OUTSIDE', 'UNKNOWN'];
      
      legacyStrategies.forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.enabled).toBe(false);
        expect(strategy.type).toBe('legacy');
        expect(strategy.function).toBe(null);
        
        // 型ベースフィルタリングでは、有効化されていれば含まれることを確認
        const mockConfig = {
          strategies: {
            [strategyKey]: {
              ...strategy,
              enabled: true
            }
          }
        };
        
        const strategies = getBalanceCheckEligibleStrategies(mockConfig);
        expect(strategies).toContain(strategyKey);
      });
    });

    test('high_frequency型以外の有効戦略は残高チェック対象', () => {
      const strategies = getBalanceCheckEligibleStrategies(config);
      
      strategies.forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.type).not.toBe('high_frequency');
        expect(strategy.enabled).toBe(true);
      });
    });
  });
});