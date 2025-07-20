/**
 * Test file for Issue #5051 fix
 * TypeError: Cannot convert undefined or null to object in extractConfigParameters
 */
const { extractConfigParameters } = require('../../../src/common/tradingUtils');

describe('tradingUtils - Issue #5051 Fix', () => {
  describe('extractConfigParameters', () => {
    test('正常なパラメータで正しく動作する', () => {
      const config = { period: 20, threshold: 0.8 };
      const parameterMap = { period: 30, threshold: 0.5, newParam: 1.0 };
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({
        period: 20,       // configから取得
        threshold: 0.8,   // configから取得
        newParam: 1.0     // デフォルト値を使用
      });
    });

    test('parameterMapがnullの場合は空オブジェクトを返す', () => {
      const config = { period: 20 };
      const parameterMap = null;
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({});
    });

    test('parameterMapがundefinedの場合は空オブジェクトを返す', () => {
      const config = { period: 20 };
      const parameterMap = undefined;
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({});
    });

    test('parameterMapが文字列の場合は空オブジェクトを返す', () => {
      const config = { period: 20 };
      const parameterMap = 'invalid';
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({});
    });

    test('parameterMapが配列の場合は空オブジェクトを返す', () => {
      const config = { period: 20 };
      const parameterMap = ['invalid'];
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({});
    });

    test('configがnullの場合はデフォルト値を返す', () => {
      const config = null;
      const parameterMap = { period: 30, threshold: 0.5 };
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({
        period: 30,
        threshold: 0.5
      });
    });

    test('configがundefinedの場合はデフォルト値を返す', () => {
      const config = undefined;
      const parameterMap = { period: 30, threshold: 0.5 };
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({
        period: 30,
        threshold: 0.5
      });
    });

    test('configが文字列の場合はデフォルト値を返す', () => {
      const config = 'invalid';
      const parameterMap = { period: 30, threshold: 0.5 };
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({
        period: 30,
        threshold: 0.5
      });
    });

    test('configが配列の場合はデフォルト値を返す', () => {
      const config = ['invalid'];
      const parameterMap = { period: 30, threshold: 0.5 };
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({
        period: 30,
        threshold: 0.5
      });
    });

    test('両方ともnullの場合は空オブジェクトを返す', () => {
      const config = null;
      const parameterMap = null;
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({});
    });

    test('両方ともundefinedの場合は空オブジェクトを返す', () => {
      const config = undefined;
      const parameterMap = undefined;
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({});
    });

    test('空のオブジェクトでも正しく動作する', () => {
      const config = {};
      const parameterMap = {};
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({});
    });

    test('configに0やfalseなどのfalsy値が含まれても正しく処理される', () => {
      const config = { 
        period: 0,
        threshold: false,
        ratio: '',
        count: null,
        enabled: undefined
      };
      const parameterMap = { 
        period: 30, 
        threshold: true, 
        ratio: 'default',
        count: 5,
        enabled: true
      };
      
      const result = extractConfigParameters(config, parameterMap);
      
      expect(result).toEqual({
        period: 0,           // configの値（falsy だが undefined ではない）
        threshold: false,    // configの値（falsy だが undefined ではない）
        ratio: '',           // configの値（falsy だが undefined ではない）
        count: null,         // configの値（falsy だが undefined ではない）
        enabled: true        // デフォルト値（configがundefined）
      });
    });
  });
});