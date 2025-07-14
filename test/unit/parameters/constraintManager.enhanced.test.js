/**
 * パラメータ制約管理システムの新機能ユニットテスト
 */

const { ParameterConstraintEngine } = require('../../../src/parameters/constraintManager');

describe('ParameterConstraintEngine - 新機能', () => {
  let engine;

  beforeEach(() => {
    engine = new ParameterConstraintEngine();
  });

  describe('新しい戦略制約の検証', () => {
    test('BOLLINGER_BANDS戦略の制約が正しく動作する（修正版）', () => {
      const validParams = { period: 20, stdDev: 2.0 };
      const invalidParams = { period: 5, stdDev: 0.5 };
      
      expect(engine.validateCombination(validParams, 'BOLLINGER_BANDS')).toBe(true);
      expect(engine.validateCombination(invalidParams, 'BOLLINGER_BANDS')).toBe(false);
    });

    test('MEAN_REVERSION戦略の制約が正しく動作する', () => {
      const validParams = { period: 20, deviationThreshold: 2.5 };
      const invalidParams = { period: 5, deviationThreshold: 0.5 };
      
      expect(engine.validateCombination(validParams, 'MEAN_REVERSION')).toBe(true);
      expect(engine.validateCombination(invalidParams, 'MEAN_REVERSION')).toBe(false);
    });

    test('MUTUAL_INFORMATION戦略の制約が正しく動作する', () => {
      const validParams = { 
        period: 20, 
        threshold: 0.5, 
        correlationWindow: 30, 
        zScoreThreshold: 2.0 
      };
      const invalidParams = { 
        period: 20, 
        threshold: 0.5, 
        correlationWindow: 15, // period未満
        zScoreThreshold: 0.5 
      };
      
      expect(engine.validateCombination(validParams, 'MUTUAL_INFORMATION')).toBe(true);
      expect(engine.validateCombination(invalidParams, 'MUTUAL_INFORMATION')).toBe(false);
    });

    test('MULTI_INDICATOR戦略の制約が正しく動作する', () => {
      const validParams = { 
        macdFastPeriod: 12, 
        macdSlowPeriod: 26, 
        macdSignalPeriod: 9,
        emaShortPeriod: 10,
        emaLongPeriod: 20,
        rsiPeriod: 14,
        adxPeriod: 14,
        volumeMAPeriod: 20
      };
      const invalidParams = { 
        macdFastPeriod: 26, 
        macdSlowPeriod: 12, // fast > slow
        macdSignalPeriod: 9,
        emaShortPeriod: 10,
        emaLongPeriod: 20,
        rsiPeriod: 14,
        adxPeriod: 14,
        volumeMAPeriod: 20
      };
      
      expect(engine.validateCombination(validParams, 'MULTI_INDICATOR')).toBe(true);
      expect(engine.validateCombination(invalidParams, 'MULTI_INDICATOR')).toBe(false);
    });

    test('GENERIC戦略の制約が正しく動作する', () => {
      const validParams = { period: 20, threshold: 2.5 };
      const invalidParams = { period: 3, threshold: 0.05 };
      
      expect(engine.validateCombination(validParams, 'GENERIC')).toBe(true);
      expect(engine.validateCombination(invalidParams, 'GENERIC')).toBe(false);
    });
  });

  describe('汎用制約の自動生成', () => {
    test('整数パラメータの制約が正しく生成される', () => {
      const sampleParams = { period: 20, window: 10 };
      const constraints = engine.generateGenericConstraints(sampleParams);
      
      expect(constraints.parameters.period).toBeDefined();
      expect(constraints.parameters.window).toBeDefined();
      expect(constraints.parameters.period.type).toBe('integer');
      expect(constraints.parameters.window.type).toBe('integer');
      expect(constraints.parameters.period.min).toBe(2); // Math.max(1, Math.floor(20 * 0.1))
      expect(constraints.parameters.period.max).toBe(200); // Math.ceil(20 * 10)
    });

    test('浮動小数点パラメータの制約が正しく生成される', () => {
      const sampleParams = { threshold: 2.5, ratio: 0.8 };
      const constraints = engine.generateGenericConstraints(sampleParams);
      
      expect(constraints.parameters.threshold).toBeDefined();
      expect(constraints.parameters.ratio).toBeDefined();
      expect(constraints.parameters.threshold.type).toBe('float');
      expect(constraints.parameters.ratio.type).toBe('float');
      expect(constraints.parameters.threshold.min).toBe(0.25); // 2.5 * 0.1
      expect(constraints.parameters.threshold.max).toBe(25); // 2.5 * 10
    });

    test('非数値パラメータが無視される', () => {
      const sampleParams = { 
        period: 20, 
        strategy: 'test', 
        enabled: true, 
        ohlcvInterval: '5m',
        amount: 100
      };
      const constraints = engine.generateGenericConstraints(sampleParams);
      
      expect(constraints.parameters.period).toBeDefined();
      expect(constraints.parameters.strategy).toBeUndefined();
      expect(constraints.parameters.enabled).toBeUndefined();
      expect(constraints.parameters.ohlcvInterval).toBeUndefined();
      expect(constraints.parameters.amount).toBeUndefined();
    });
  });

  describe('フォールバック機能', () => {
    test('未知の戦略でもGENERIC制約が取得できる', () => {
      const constraints = engine.getStrategyConstraints('UNKNOWN_STRATEGY');
      expect(constraints).toBeDefined();
      expect(constraints).toEqual(engine.constraints.GENERIC);
    });

    test('null戦略でもGENERIC制約が取得できる', () => {
      const constraints = engine.getStrategyConstraints(null);
      expect(constraints).toBeDefined();
      expect(constraints).toEqual(engine.constraints.GENERIC);
    });

    test('空文字列戦略でもGENERIC制約が取得できる', () => {
      const constraints = engine.getStrategyConstraints('');
      expect(constraints).toBeDefined();
      expect(constraints).toEqual(engine.constraints.GENERIC);
    });
  });

  describe('品質メトリクス計算の改善', () => {
    test('有効なパラメータセットで品質メトリクスが計算される', () => {
      const parameterSet = [
        { shortPeriod: 5, longPeriod: 20 },
        { shortPeriod: 10, longPeriod: 30 },
        { shortPeriod: 15, longPeriod: 40 }
      ];
      
      const quality = engine.calculateParameterQuality(parameterSet, 'MA_CROSS');
      
      expect(quality.validity).toBeGreaterThan(0);
      expect(quality.diversity).toBeGreaterThan(0);
      expect(quality.coverage).toBeGreaterThan(0);
      expect(quality.efficiency).toBeGreaterThan(0);
    });

    test('GENERIC戦略でも品質メトリクスが計算される', () => {
      const parameterSet = [
        { period: 10, threshold: 1.0 },
        { period: 20, threshold: 2.0 },
        { period: 30, threshold: 3.0 }
      ];
      
      const quality = engine.calculateParameterQuality(parameterSet, 'GENERIC');
      
      expect(quality.validity).toBeGreaterThan(0);
      expect(quality.diversity).toBeGreaterThan(0);
      expect(quality.coverage).toBeGreaterThan(0);
      expect(quality.efficiency).toBeGreaterThan(0);
    });

    test('空のパラメータセットで0.0%が返される', () => {
      const quality = engine.calculateParameterQuality([], 'MA_CROSS');
      
      expect(quality.validity).toBe(0);
      expect(quality.diversity).toBe(0);
      expect(quality.coverage).toBe(0);
      expect(quality.efficiency).toBe(0);
    });
  });

  describe('パラメータ生成の改善', () => {
    test('新しい戦略で有効なパラメータが生成される', () => {
      const combinations = engine.generateValidCombinations('MEAN_REVERSION', 10);
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeGreaterThan(0);
      
      combinations.forEach(combo => {
        expect(engine.validateCombination(combo, 'MEAN_REVERSION')).toBe(true);
      });
    });

    test('GENERIC戦略で有効なパラメータが生成される', () => {
      const combinations = engine.generateValidCombinations('GENERIC', 5);
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeGreaterThan(0);
      
      combinations.forEach(combo => {
        expect(engine.validateCombination(combo, 'GENERIC')).toBe(true);
      });
    });

    test('制約が厳しい場合でもエラーにならない', () => {
      // 制約を一時的に厳しくして連続失敗を発生させる
      const originalConstraints = engine.constraints.GENERIC;
      engine.constraints.GENERIC = {
        parameters: { period: { min: 50, max: 51, type: 'integer' } },
        constraints: ['period == 50.5'] // 不可能な制約
      };
      
      expect(() => {
        engine.generateValidCombinations('GENERIC', 10);
      }).not.toThrow();
      
      // 元に戻す
      engine.constraints.GENERIC = originalConstraints;
    });
  });
});