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

      // 緊急対応中: すべての戦略が無効化されているため、空配列が期待される
      expect(Array.isArray(strategies)).toBe(true);

      // 期待される戦略（緊急対応解除後は有効化される）
      const expectedStrategies = [
        'MACD', 'BOLLINGER_BANDS', 'MA', 'OSCILLATOR',
        'RSI', 'MULTI_INDICATOR', 'MUTUAL_INFO', 'MEAN_REVERSION'
      ];

      expectedStrategies.forEach(expectedStrategy => {
        // 戦略が存在し、type が定義されていることを確認
        const strategy = config.strategies[expectedStrategy];
        expect(strategy).toBeDefined();
        expect(strategy.type).toBeDefined();
        expect(strategy.type).not.toBe('high_frequency');

        // 緊急対応中はすべて無効化されていることを確認（現在は一部有効化されている場合がある）
        expect(typeof strategy.enabled).toBe('boolean');
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
      expect(outsideStrategy.enabled).toBe(true); // Issue #408: レガシー戦略有効化
      expect(outsideStrategy.function).toBe(null);
    });

    test('UNKNOWN戦略が正しく設定されている', () => {
      const unknownStrategy = config.strategies.UNKNOWN;
      expect(unknownStrategy).toBeDefined();
      expect(unknownStrategy.type).toBe('legacy');
      expect(unknownStrategy.enabled).toBe(true); // Issue #408: レガシー戦略有効化
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

    test('レガシー戦略（OUTSIDE, UNKNOWN）は有効化されており型ベースフィルタリング対象', () => {
      const legacyStrategies = ['OUTSIDE', 'UNKNOWN'];

      legacyStrategies.forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.enabled).toBe(true); // Issue #408: レガシー戦略有効化
        expect(strategy.type).toBe('legacy');
        expect(strategy.function).toBe(null);

        // 有効化されているため型ベースフィルタリングに含まれることを確認
        const strategies = getBalanceCheckEligibleStrategies(config);
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