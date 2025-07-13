/**
 * パラメータ制約管理システムのユニットテスト
 */

const { ParameterConstraintEngine, STRATEGY_CONSTRAINTS } = require('../../../src/parameters/constraintManager');

describe('ParameterConstraintEngine', () => {
  let constraintEngine;

  beforeEach(() => {
    constraintEngine = new ParameterConstraintEngine();
  });

  describe('初期化', () => {
    test('制約エンジンが正しく初期化される', () => {
      expect(constraintEngine.constraints).toBeDefined();
      expect(constraintEngine.constraints).toEqual(STRATEGY_CONSTRAINTS);
    });
  });

  describe('戦略制約取得', () => {
    test('MA_CROSS戦略の制約が取得できる', () => {
      const constraints = constraintEngine.getStrategyConstraints('MA_CROSS');
      expect(constraints).toBeDefined();
      expect(constraints.parameters.shortPeriod).toBeDefined();
      expect(constraints.parameters.longPeriod).toBeDefined();
      expect(constraints.constraints).toContain('shortPeriod < longPeriod');
    });

    test('存在しない戦略の制約取得でnullが返される', () => {
      const constraints = constraintEngine.getStrategyConstraints('UNKNOWN_STRATEGY');
      expect(constraints).toBeNull();
    });

    test('RSI戦略の制約が正しく定義されている', () => {
      const constraints = constraintEngine.getStrategyConstraints('RSI');
      expect(constraints.parameters.period).toEqual({ min: 5, max: 30, type: 'integer' });
      expect(constraints.parameters.oversoldThreshold).toEqual({ min: 10, max: 40, type: 'integer' });
      expect(constraints.parameters.overboughtThreshold).toEqual({ min: 60, max: 90, type: 'integer' });
    });
  });

  describe('パラメータバリデーション', () => {
    test('有効なMA_CROSSパラメータが承認される', () => {
      const params = { shortPeriod: 5, longPeriod: 20 };
      const isValid = constraintEngine.validateCombination(params, 'MA_CROSS');
      expect(isValid).toBe(true);
    });

    test('無効なMA_CROSSパラメータ（shortPeriod > longPeriod）が拒否される', () => {
      const params = { shortPeriod: 25, longPeriod: 15 };
      const isValid = constraintEngine.validateCombination(params, 'MA_CROSS');
      expect(isValid).toBe(false);
    });

    test('範囲外のパラメータが拒否される', () => {
      const params = { shortPeriod: 1, longPeriod: 20 }; // shortPeriodの最小値は3
      const isValid = constraintEngine.validateCombination(params, 'MA_CROSS');
      expect(isValid).toBe(false);
    });

    test('有効なRSIパラメータが承認される', () => {
      const params = { period: 14, oversoldThreshold: 30, overboughtThreshold: 70 };
      const isValid = constraintEngine.validateCombination(params, 'RSI');
      expect(isValid).toBe(true);
    });

    test('無効なRSI閾値関係が拒否される', () => {
      const params = { period: 14, oversoldThreshold: 40, overboughtThreshold: 50 }; // 差が20以下
      const isValid = constraintEngine.validateCombination(params, 'RSI');
      expect(isValid).toBe(false);
    });

    test('整数型制約が正しく動作する', () => {
      const params = { shortPeriod: 5.5, longPeriod: 20 }; // shortPeriodが整数でない
      const isValid = constraintEngine.validateCombination(params, 'MA_CROSS');
      expect(isValid).toBe(false);
    });

    test('存在しない戦略に対してtrueが返される', () => {
      const params = { anyParam: 10 };
      const isValid = constraintEngine.validateCombination(params, 'UNKNOWN_STRATEGY');
      expect(isValid).toBe(true);
    });
  });

  describe('制約式評価', () => {
    test('単純な不等式が正しく評価される', () => {
      const params = { a: 5, b: 10 };
      const result = constraintEngine.evaluateConstraint(params, 'a < b');
      expect(result).toBe(true);
    });

    test('複雑な制約式が正しく評価される', () => {
      const params = { shortPeriod: 5, longPeriod: 20 };
      const result = constraintEngine.evaluateConstraint(params, 'longPeriod / shortPeriod >= 1.5');
      expect(result).toBe(true);
    });

    test('不正な制約式でfalseが返される', () => {
      const params = { a: 5 };
      const result = constraintEngine.evaluateConstraint(params, 'malicious.code()');
      expect(result).toBe(false);
    });
  });

  describe('有効なパラメータ組み合わせ生成', () => {
    test('MA_CROSSの有効なパラメータが生成される', () => {
      const combinations = constraintEngine.generateValidCombinations('MA_CROSS', 10);
      expect(combinations).toHaveLength(10);
      
      combinations.forEach(combo => {
        expect(constraintEngine.validateCombination(combo, 'MA_CROSS')).toBe(true);
        expect(combo.shortPeriod).toBeGreaterThanOrEqual(3);
        expect(combo.shortPeriod).toBeLessThanOrEqual(50);
        expect(combo.longPeriod).toBeGreaterThanOrEqual(10);
        expect(combo.longPeriod).toBeLessThanOrEqual(200);
        expect(combo.shortPeriod).toBeLessThan(combo.longPeriod);
      });
    });

    test('RSIの有効なパラメータが生成される', () => {
      const combinations = constraintEngine.generateValidCombinations('RSI', 5);
      expect(combinations.length).toBeGreaterThan(0);
      expect(combinations.length).toBeLessThanOrEqual(5);
      
      combinations.forEach(combo => {
        expect(constraintEngine.validateCombination(combo, 'RSI')).toBe(true);
        expect(combo.overboughtThreshold - combo.oversoldThreshold).toBeGreaterThanOrEqual(20);
      });
    });

    test('存在しない戦略で空配列が返される', () => {
      const combinations = constraintEngine.generateValidCombinations('UNKNOWN_STRATEGY', 10);
      expect(combinations).toEqual([]);
    });
  });

  describe('候補パラメータ生成', () => {
    test('整数型パラメータが正しく生成される', () => {
      const paramDefs = {
        testParam: { min: 5, max: 15, type: 'integer' }
      };
      const candidate = constraintEngine.generateCandidate(paramDefs);
      
      expect(candidate.testParam).toBeGreaterThanOrEqual(5);
      expect(candidate.testParam).toBeLessThanOrEqual(15);
      expect(Number.isInteger(candidate.testParam)).toBe(true);
    });

    test('浮動小数点型パラメータが正しく生成される', () => {
      const paramDefs = {
        testParam: { min: 1.0, max: 3.0, type: 'float', step: 0.1 }
      };
      const candidate = constraintEngine.generateCandidate(paramDefs);
      
      expect(candidate.testParam).toBeGreaterThanOrEqual(1.0);
      expect(candidate.testParam).toBeLessThanOrEqual(3.0);
      expect(typeof candidate.testParam).toBe('number');
    });
  });

  describe('パラメータ品質指標計算', () => {
    test('有効なパラメータセットの品質が計算される', () => {
      const parameterSet = [
        { shortPeriod: 5, longPeriod: 20 },
        { shortPeriod: 10, longPeriod: 30 },
        { shortPeriod: 15, longPeriod: 40 }
      ];
      
      const quality = constraintEngine.calculateParameterQuality(parameterSet, 'MA_CROSS');
      
      expect(quality.validity).toBeGreaterThan(0);
      expect(quality.diversity).toBeGreaterThanOrEqual(0);
      expect(quality.coverage).toBeGreaterThanOrEqual(0);
      expect(quality.efficiency).toBeGreaterThanOrEqual(0);
      
      expect(quality.validity).toBeLessThanOrEqual(1);
      expect(quality.diversity).toBeLessThanOrEqual(1);
      expect(quality.coverage).toBeLessThanOrEqual(1);
      expect(quality.efficiency).toBeLessThanOrEqual(1);
    });

    test('空のパラメータセットで0が返される', () => {
      const quality = constraintEngine.calculateParameterQuality([], 'MA_CROSS');
      
      expect(quality.validity).toBe(0);
      expect(quality.diversity).toBe(0);
      expect(quality.coverage).toBe(0);
      expect(quality.efficiency).toBe(0);
    });

    test('存在しない戦略で0が返される', () => {
      const parameterSet = [{ anyParam: 10 }];
      const quality = constraintEngine.calculateParameterQuality(parameterSet, 'UNKNOWN_STRATEGY');
      
      expect(quality.validity).toBe(0);
      expect(quality.diversity).toBe(0);
      expect(quality.coverage).toBe(0);
      expect(quality.efficiency).toBe(0);
    });
  });

  describe('パラメータ多様性計算', () => {
    test('多様なパラメータで高い多様性スコアが返される', () => {
      const parameterSet = [
        { testParam: 5 },
        { testParam: 15 },
        { testParam: 25 }
      ];
      const paramDefs = {
        testParam: { min: 0, max: 30, type: 'integer' }
      };
      
      const diversity = constraintEngine.calculateParameterDiversity(parameterSet, paramDefs);
      expect(diversity).toBeGreaterThan(0);
    });

    test('同一パラメータで低い多様性スコアが返される', () => {
      const parameterSet = [
        { testParam: 10 },
        { testParam: 10 },
        { testParam: 10 }
      ];
      const paramDefs = {
        testParam: { min: 0, max: 30, type: 'integer' }
      };
      
      const diversity = constraintEngine.calculateParameterDiversity(parameterSet, paramDefs);
      expect(diversity).toBe(0);
    });
  });

  describe('パラメータ空間カバー率評価', () => {
    test('広範囲にわたるパラメータで高いカバー率が返される', () => {
      const parameterSet = [
        { testParam: 5 },
        { testParam: 15 },
        { testParam: 25 }
      ];
      const paramDefs = {
        testParam: { min: 0, max: 30, type: 'integer' }
      };
      
      const coverage = constraintEngine.assessParameterSpaceCoverage(parameterSet, paramDefs);
      expect(coverage).toBeGreaterThan(0.5);
    });

    test('狭い範囲のパラメータで低いカバー率が返される', () => {
      const parameterSet = [
        { testParam: 14 },
        { testParam: 15 },
        { testParam: 16 }
      ];
      const paramDefs = {
        testParam: { min: 0, max: 30, type: 'integer' }
      };
      
      const coverage = constraintEngine.assessParameterSpaceCoverage(parameterSet, paramDefs);
      expect(coverage).toBeLessThan(0.2);
    });
  });
});