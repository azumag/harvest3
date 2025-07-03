/**
 * 統一戦略管理のテスト
 * geminiレビュー対応：戦略管理の冗長性解決のテスト
 */

const { config } = require('../../../src/config');

describe('統一戦略管理', () => {
  describe('enableBalanceCheck プロパティ', () => {
    test('残高チェック有効な戦略が正しく設定されている', () => {
      const strategies = Object.keys(config.strategies).filter(strategyKey => {
        const strategy = config.strategies[strategyKey];
        return strategy.enableBalanceCheck === true;
      });

      // 期待される戦略が含まれていることを確認
      const expectedStrategies = [
        'MACD', 'BOLLINGER_BANDS', 'MA', 'OSCILLATOR', 
        'RSI', 'MULTI_INDICATOR', 'MUTUAL_INFO', 'MEAN_REVERSION',
        'OUTSIDE', 'UNKNOWN'
      ];

      expectedStrategies.forEach(expectedStrategy => {
        expect(strategies).toContain(expectedStrategy);
      });

      // HFT戦略は含まれていないことを確認
      expect(strategies).not.toContain('HFT');
    });

    test('HFT戦略はenableBalanceCheckがfalseに設定されている', () => {
      const hftStrategy = config.strategies.HFT;
      expect(hftStrategy.enableBalanceCheck).toBe(false);
    });

    test('OUTSIDE戦略が正しく設定されている', () => {
      const outsideStrategy = config.strategies.OUTSIDE;
      expect(outsideStrategy).toBeDefined();
      expect(outsideStrategy.enableBalanceCheck).toBe(true);
      expect(outsideStrategy.enabled).toBe(false);
      expect(outsideStrategy.function).toBe(null);
    });

    test('UNKNOWN戦略が正しく設定されている', () => {
      const unknownStrategy = config.strategies.UNKNOWN;
      expect(unknownStrategy).toBeDefined();
      expect(unknownStrategy.enableBalanceCheck).toBe(true);
      expect(unknownStrategy.enabled).toBe(false);
      expect(unknownStrategy.function).toBe(null);
    });

    test('enableBalanceCheck が未定義の戦略は残高チェック対象外', () => {
      // 新しい戦略がenableBalanceCheckプロパティを持たない場合のテスト
      const strategiesWithoutBalanceCheck = Object.keys(config.strategies).filter(strategyKey => {
        const strategy = config.strategies[strategyKey];
        return strategy.enableBalanceCheck === undefined;
      });

      // enableBalanceCheckが未定義の戦略は残高チェック対象外であることを確認
      strategiesWithoutBalanceCheck.forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.enableBalanceCheck).not.toBe(true);
      });
    });
  });

  describe('戦略設定の整合性', () => {
    test('全ての有効戦略（HFT以外）にenableBalanceCheckが定義されている', () => {
      const enabledStrategies = Object.keys(config.strategies).filter(strategyKey => {
        const strategy = config.strategies[strategyKey];
        return strategy.enabled === true && strategyKey !== 'HFT';
      });

      enabledStrategies.forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.enableBalanceCheck).toBeDefined();
        expect(typeof strategy.enableBalanceCheck).toBe('boolean');
      });
    });

    test('レガシー戦略（OUTSIDE, UNKNOWN）は無効化されているが残高チェック対象', () => {
      const legacyStrategies = ['OUTSIDE', 'UNKNOWN'];
      
      legacyStrategies.forEach(strategyKey => {
        const strategy = config.strategies[strategyKey];
        expect(strategy.enabled).toBe(false);
        expect(strategy.enableBalanceCheck).toBe(true);
        expect(strategy.function).toBe(null);
      });
    });
  });
});