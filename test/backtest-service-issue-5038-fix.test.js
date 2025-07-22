/**
 * Issue #5038 バックテストサービス例外修正のテスト
 * TypeError: Cannot convert undefined or null to object の修正を検証
 */

const {
  extractNumericParameterKeys,
  generateParameterCombinations,
  generateRandomParameterCombinations
} = require('./helpers/backtest-test-helpers');

const { IntelligentParameterManager, createIntelligentParameterManager } = require('../src/parameters');

describe('Issue #5038: バックテストサービス例外修正', () => {
  describe('extractNumericParameterKeys関数のnull/undefined対応', () => {
    test('nullが渡された場合、空配列を返すこと', () => {
      const result = extractNumericParameterKeys(null);
      expect(result).toEqual([]);
    });

    test('undefinedが渡された場合、空配列を返すこと', () => {
      const result = extractNumericParameterKeys(undefined);
      expect(result).toEqual([]);
    });

    test('配列が渡された場合、空配列を返すこと', () => {
      const result = extractNumericParameterKeys(['period', 'threshold']);
      expect(result).toEqual([]);
    });

    test('正常なオブジェクトが渡された場合、数値キーのみを返すこと', () => {
      const config = {
        period: 30,
        threshold: 0.7,
        name: 'strategy',
        enabled: true,
        count: 10
      };
      const result = extractNumericParameterKeys(config);
      expect(result).toEqual(['period', 'threshold', 'count']);
    });

    test('空のオブジェクトが渡された場合、空配列を返すこと', () => {
      const result = extractNumericParameterKeys({});
      expect(result).toEqual([]);
    });
  });

  describe('generateParameterCombinations関数のnull/undefined対応', () => {
    test('defaultConfigがnullの場合、空オブジェクトの配列を返すこと', () => {
      const result = generateParameterCombinations(null, ['period', 'threshold']);
      expect(result).toEqual([{}]);
    });

    test('defaultConfigがundefinedの場合、空オブジェクトの配列を返すこと', () => {
      const result = generateParameterCombinations(undefined, ['period', 'threshold']);
      expect(result).toEqual([{}]);
    });

    test('numericKeysが空の場合、空オブジェクトの配列を返すこと', () => {
      const config = { period: 30, threshold: 0.7 };
      const result = generateParameterCombinations(config, []);
      expect(result).toEqual([{}]);
    });

    test('defaultConfigのプロパティが数値でない場合、フォールバック値を使用すること', () => {
      const config = { period: null, threshold: 'invalid' };
      const result = generateParameterCombinations(config, ['period'], 0.1, 2);
      
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // フォールバック値10を基準とした範囲の値が生成されることを確認
      result.forEach(combo => {
        expect(typeof combo.period).toBe('number');
        expect(combo.period).toBeGreaterThan(0);
      });
    });

    test('正常なパラメータの場合、適切な組み合わせを生成すること', () => {
      const config = { period: 30, threshold: 20 };
      const result = generateParameterCombinations(config, ['period'], 0.2, 3);
      
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      result.forEach(combo => {
        expect(typeof combo.period).toBe('number');
        expect(combo.period).toBeGreaterThan(0);
        // 30の±20%の範囲内であることを確認（24-36の範囲）
        expect(combo.period).toBeGreaterThanOrEqual(24);
        expect(combo.period).toBeLessThanOrEqual(36);
      });
    });
  });

  describe('generateRandomParameterCombinations関数のnull/undefined対応', () => {
    test('defaultConfigがnullの場合、空オブジェクトの配列を返すこと', () => {
      const result = generateRandomParameterCombinations(null, ['period', 'threshold'], 10);
      expect(result).toEqual([{}]);
    });

    test('defaultConfigがundefinedの場合、空オブジェクトの配列を返すこと', () => {
      const result = generateRandomParameterCombinations(undefined, ['period', 'threshold'], 10);
      expect(result).toEqual([{}]);
    });

    test('numericKeysが空の場合、空オブジェクトの配列を返すこと', () => {
      const config = { period: 30, threshold: 0.7 };
      const result = generateRandomParameterCombinations(config, [], 10);
      expect(result).toEqual([{}]);
    });

    test('defaultConfigのプロパティが数値でない場合、フォールバック値を使用すること', () => {
      const config = { period: null, threshold: 'invalid', count: undefined };
      const result = generateRandomParameterCombinations(config, ['period', 'threshold', 'count'], 5);
      
      expect(result).toBeDefined();
      expect(result.length).toBe(5);
      result.forEach(combo => {
        if (Object.keys(combo).length > 0) {
          // フォールバック値10を基準とした値が生成されることを確認
          expect(typeof combo.period).toBe('number');
          expect(typeof combo.threshold).toBe('number');
          expect(typeof combo.count).toBe('number');
          expect(combo.period).toBeGreaterThan(0);
          expect(combo.threshold).toBeGreaterThan(0);
          expect(combo.count).toBeGreaterThan(0);
        }
      });
    });

    test('正常なパラメータの場合、適切なランダム組み合わせを生成すること', () => {
      const config = { period: 30, threshold: 50 };
      const result = generateRandomParameterCombinations(config, ['period', 'threshold'], 5, 0.1);
      
      expect(result).toBeDefined();
      expect(result.length).toBe(5);
      
      // 最初の要素はデフォルト設定であることを確認
      expect(result[0]).toEqual({ period: 30, threshold: 50 });
      
      // 残りの要素はランダム値であることを確認
      for (let i = 1; i < result.length; i++) {
        expect(typeof result[i].period).toBe('number');
        expect(typeof result[i].threshold).toBe('number');
        expect(result[i].period).toBeGreaterThan(0);
        expect(result[i].threshold).toBeGreaterThan(0);
      }
    });
  });

  describe('IntelligentParameterManager のnull/undefined対応', () => {
    test('nullのdefaultConfigでも例外を発生させないこと', () => {
      expect(() => {
        createIntelligentParameterManager(null, []);
      }).not.toThrow();
    });

    test('undefinedのdefaultConfigでも例外を発生させないこと', () => {
      expect(() => {
        createIntelligentParameterManager(undefined, []);
      }).not.toThrow();
    });

    test('null sampleConfigでも例外を発生させないこと', () => {
      const manager = createIntelligentParameterManager({}, []);
      expect(() => {
        manager.generateParameterCombinations(null, [], 0.1, 10);
      }).not.toThrow();
    });
  });

  describe('統合テスト - バックテスト実行フロー', () => {
    test('getStrategyParametersがnullを返した場合の処理', () => {
      // モックデータでバックテスト処理をシミュレート
      const dbParams = null;
      const numericKeys = extractNumericParameterKeys(dbParams);
      
      expect(numericKeys).toEqual([]);
      
      // パラメータ生成関数が例外を発生させないことを確認
      expect(() => {
        generateParameterCombinations(dbParams, numericKeys);
      }).not.toThrow();
      
      expect(() => {
        generateRandomParameterCombinations(dbParams, numericKeys, 10);
      }).not.toThrow();
    });

    test('部分的に無効なパラメータを持つ設定の処理', () => {
      const dbParams = {
        period: 30,
        threshold: null, // 無効な値
        enabled: true,   // 数値以外
        count: undefined // 無効な値
      };
      
      const numericKeys = extractNumericParameterKeys(dbParams);
      expect(numericKeys).toEqual(['period']); // periodのみが数値
      
      // パラメータ生成が正常に動作することを確認
      const gridCombinations = generateParameterCombinations(dbParams, numericKeys, 0.1, 3);
      expect(gridCombinations.length).toBeGreaterThan(0);
      gridCombinations.forEach(combo => {
        expect(typeof combo.period).toBe('number');
        expect(combo.period).toBeGreaterThan(0);
      });
      
      const randomCombinations = generateRandomParameterCombinations(dbParams, numericKeys, 5, 0.1);
      expect(randomCombinations.length).toBe(5);
      randomCombinations.forEach(combo => {
        if (Object.keys(combo).length > 0) {
          expect(typeof combo.period).toBe('number');
          expect(combo.period).toBeGreaterThan(0);
        }
      });
    });
  });
});