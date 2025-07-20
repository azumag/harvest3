/**
 * Issue #5010 修正テスト: バックテストサービスでnull/undefined例外修正
 * 
 * 問題: extractNumericParameterKeys関数でnull/undefinedオブジェクトに対して
 *       Object.keys()を呼び出すことで"TypeError: Cannot convert undefined or null to object"が発生
 * 
 * 修正: null/undefinedチェックを追加し、空配列を返すように変更
 */

const { extractNumericParameterKeys, generateParameterCombinations, generateRandomParameterCombinations } = require('../src/strategies/utils/common');

describe('Issue #5010: extractNumericParameterKeys null/undefined 対応', () => {
  describe('extractNumericParameterKeys', () => {
    test('正常なオブジェクトから数値キーを抽出', () => {
      const config = {
        period: 20,
        multiplier: 2.5,
        threshold: 0.8,
        enabled: true,
        name: 'test'
      };
      
      const result = extractNumericParameterKeys(config);
      expect(result).toEqual(['period', 'multiplier', 'threshold']);
    });

    test('nullが渡された場合、空配列を返す（エラーなし）', () => {
      const result = extractNumericParameterKeys(null);
      expect(result).toEqual([]);
    });

    test('undefinedが渡された場合、空配列を返す（エラーなし）', () => {
      const result = extractNumericParameterKeys(undefined);
      expect(result).toEqual([]);
    });

    test('空オブジェクトの場合、空配列を返す', () => {
      const result = extractNumericParameterKeys({});
      expect(result).toEqual([]);
    });

    test('数値プロパティがないオブジェクトの場合、空配列を返す', () => {
      const config = {
        enabled: true,
        name: 'test',
        mode: 'live'
      };
      
      const result = extractNumericParameterKeys(config);
      expect(result).toEqual([]);
    });

    test('文字列が渡された場合、空配列を返す', () => {
      const result = extractNumericParameterKeys('invalid');
      expect(result).toEqual([]);
    });

    test('数値が渡された場合、空配列を返す', () => {
      const result = extractNumericParameterKeys(123);
      expect(result).toEqual([]);
    });

    test('配列が渡された場合、空配列を返す', () => {
      const result = extractNumericParameterKeys([1, 2, 3]);
      expect(result).toEqual([]);
    });
  });

  describe('generateParameterCombinations null安全性', () => {
    test('extractNumericParameterKeysがnullの場合でも動作する', () => {
      const defaultConfig = { period: 20 };
      const numericKeys = extractNumericParameterKeys(null); // []が返される
      
      const result = generateParameterCombinations(defaultConfig, numericKeys);
      expect(result).toEqual([{}]);
    });

    test('extractNumericParameterKeysがundefinedの場合でも動作する', () => {
      const defaultConfig = { period: 20 };
      const numericKeys = extractNumericParameterKeys(undefined); // []が返される
      
      const result = generateParameterCombinations(defaultConfig, numericKeys);
      expect(result).toEqual([{}]);
    });
  });

  describe('generateRandomParameterCombinations null安全性', () => {
    test('extractNumericParameterKeysがnullの場合でも動作する', () => {
      const defaultConfig = { period: 20 };
      const numericKeys = extractNumericParameterKeys(null); // []が返される
      
      const result = generateRandomParameterCombinations(defaultConfig, numericKeys, 5);
      expect(result).toEqual([{}]);
    });

    test('extractNumericParameterKeysがundefinedの場合でも動作する', () => {
      const defaultConfig = { period: 20 };
      const numericKeys = extractNumericParameterKeys(undefined); // []が返される
      
      const result = generateRandomParameterCombinations(defaultConfig, numericKeys, 5);
      expect(result).toEqual([{}]);
    });
  });

  describe('統合テスト: バックテストワークフロー', () => {
    test('getStrategyParametersがnullを返すシナリオをシミュレート', () => {
      // Redis接続不可時やパラメータ未存在時を想定
      const dbParams = null;
      
      // 実際のバックテストで行われる処理をシミュレート
      const numericParameterKeys = extractNumericParameterKeys(dbParams);
      expect(numericParameterKeys).toEqual([]);
      
      // パラメータ組み合わせ生成も正常に動作する
      const defaultConfig = { period: 20, threshold: 0.5 };
      const combinations = generateParameterCombinations(defaultConfig, numericParameterKeys);
      expect(combinations).toEqual([{}]);
    });

    test('getStrategyParametersがundefinedを返すシナリオをシミュレート', () => {
      // エラー時やレスポンス未定義時を想定
      const dbParams = undefined;
      
      // 実際のバックテストで行われる処理をシミュレート
      const numericParameterKeys = extractNumericParameterKeys(dbParams);
      expect(numericParameterKeys).toEqual([]);
      
      // ランダムパラメータ組み合わせ生成も正常に動作する
      const defaultConfig = { period: 20, threshold: 0.5 };
      const combinations = generateRandomParameterCombinations(defaultConfig, numericParameterKeys, 10);
      expect(combinations).toEqual([{}]);
    });
  });

  describe('Issue #5010 具体的なエラーケースの再現', () => {
    test('Redis接続失敗時のエラーを再現・修正確認', () => {
      // Issue #5010で発生したシナリオ:
      // 1. Redis接続が利用できない -> getStrategyParametersRedis が null を返す
      // 2. extractNumericParameterKeys(null) が呼ばれる
      // 3. 以前: Object.keys(null) でTypeError発生
      // 4. 修正後: 空配列が返される

      const dbParams = null; // Redis接続失敗時の戻り値

      // 修正前なら TypeError: Cannot convert undefined or null to object
      // 修正後は正常に動作するはず
      expect(() => {
        const numericKeys = extractNumericParameterKeys(dbParams);
        expect(numericKeys).toEqual([]);
      }).not.toThrow();
    });

    test('戦略パラメータ未存在時のエラーを再現・修正確認', () => {
      // Issue #5010で発生したシナリオ:
      // 1. 戦略パラメータがRedisに存在しない -> getStrategyParametersRedis が null を返す
      // 2. extractNumericParameterKeys(null) が呼ばれる
      // 3. 以前: Object.keys(null) でTypeError発生
      // 4. 修正後: 空配列が返される

      const dbParams = null; // パラメータ未存在時の戻り値

      expect(() => {
        const numericKeys = extractNumericParameterKeys(dbParams);
        expect(numericKeys).toEqual([]);
      }).not.toThrow();
    });
  });
});