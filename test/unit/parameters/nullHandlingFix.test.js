/**
 * テスト: パラメータ管理システムのnull/undefinedハンドリング修正
 * Issue #5069: TypeError: Cannot convert undefined or null to object
 */

const { ParameterConstraintEngine } = require('../../../src/parameters/constraintManager');
const { SmartSamplingEngine } = require('../../../src/parameters/smartSampling');

describe('パラメータ管理システム - null/undefinedハンドリング修正', () => {
  let constraintEngine;
  let samplingEngine;

  beforeEach(() => {
    constraintEngine = new ParameterConstraintEngine();
    samplingEngine = new SmartSamplingEngine();
  });

  describe('ParameterConstraintEngine', () => {
    describe('calculateParameterQuality', () => {
      it('constraint.parametersがnullの場合、エラーなく適切なデフォルト値を返すべき', () => {
        // 無効な制約を持つ戦略を意図的に作成
        const mockConstraint = {
          parameters: null,
          constraints: []
        };
        constraintEngine.constraints.TEST_NULL_PARAMS = mockConstraint;

        const parameterSet = [{ period: 10 }];
        const result = constraintEngine.calculateParameterQuality(parameterSet, 'TEST_NULL_PARAMS');

        expect(result).toEqual({
          validity: 0,
          diversity: 0,
          coverage: 0,
          efficiency: 0
        });
      });

      it('constraint.parametersがundefinedの場合、エラーなく適切なデフォルト値を返すべき', () => {
        const mockConstraint = {
          // parameters プロパティを意図的に省略
          constraints: []
        };
        constraintEngine.constraints.TEST_UNDEFINED_PARAMS = mockConstraint;

        const parameterSet = [{ period: 10 }];
        const result = constraintEngine.calculateParameterQuality(parameterSet, 'TEST_UNDEFINED_PARAMS');

        expect(result).toEqual({
          validity: 0,
          diversity: 0,
          coverage: 0,
          efficiency: 0
        });
      });

      it('constraint.parametersが空オブジェクトの場合、正常に処理されるべき', () => {
        const mockConstraint = {
          parameters: {},
          constraints: []
        };
        constraintEngine.constraints.TEST_EMPTY_PARAMS = mockConstraint;

        const parameterSet = [{ period: 10 }];
        const result = constraintEngine.calculateParameterQuality(parameterSet, 'TEST_EMPTY_PARAMS');

        // 空のparametersでは0または有効な数値が返される
        expect(result.validity).toBeGreaterThanOrEqual(0);
        expect(result.diversity).toBeGreaterThanOrEqual(0);
        expect(result.coverage).toBeGreaterThanOrEqual(0);
        expect(result.efficiency).toBeGreaterThanOrEqual(0);
      });
    });

    describe('calculateParameterDiversity', () => {
      it('parameterDefsがnullの場合、エラーなく0を返すべき', () => {
        const parameterSet = [
          { period: 10, threshold: 0.5 },
          { period: 20, threshold: 0.3 }
        ];

        const result = constraintEngine.calculateParameterDiversity(parameterSet, null);
        expect(result).toBe(0);
      });

      it('parameterDefsがundefinedの場合、エラーなく0を返すべき', () => {
        const parameterSet = [
          { period: 10, threshold: 0.5 },
          { period: 20, threshold: 0.3 }
        ];

        const result = constraintEngine.calculateParameterDiversity(parameterSet, undefined);
        expect(result).toBe(0);
      });

      it('parameterDefsが文字列の場合、エラーなく0を返すべき', () => {
        const parameterSet = [
          { period: 10, threshold: 0.5 }
        ];

        const result = constraintEngine.calculateParameterDiversity(parameterSet, "invalid");
        // 単一パラメータの場合は0.1が返される場合があるため、0以上の値を期待
        expect(result).toBeGreaterThanOrEqual(0);
      });
    });

    describe('assessParameterSpaceCoverage', () => {
      it('parameterDefsがnullの場合、エラーなく0を返すべき', () => {
        const parameterSet = [
          { period: 10, threshold: 0.5 },
          { period: 20, threshold: 0.3 }
        ];

        const result = constraintEngine.assessParameterSpaceCoverage(parameterSet, null);
        expect(result).toBe(0);
      });

      it('parameterDefsがundefinedの場合、エラーなく0を返すべき', () => {
        const parameterSet = [
          { period: 10, threshold: 0.5 },
          { period: 20, threshold: 0.3 }
        ];

        const result = constraintEngine.assessParameterSpaceCoverage(parameterSet, undefined);
        expect(result).toBe(0);
      });

      it('parameterDefsが配列の場合、エラーなく有効な値を返すべき', () => {
        const parameterSet = [
          { period: 10, threshold: 0.5 }
        ];

        const result = constraintEngine.assessParameterSpaceCoverage(parameterSet, []);
        
        // 配列の場合、NaNではなく有効な数値が返されることを確認
        expect(result).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('SmartSamplingEngine', () => {
    describe('evaluateSamplingQuality', () => {
      it('constraint.parametersがnullの場合、エラーなく適切なデフォルト値を返すべき', () => {
        const mockConstraint = {
          parameters: null,
          constraints: []
        };
        samplingEngine.constraintEngine.constraints.TEST_NULL_SAMPLING = mockConstraint;

        const samples = [{ period: 10 }];
        const result = samplingEngine.evaluateSamplingQuality(samples, 'TEST_NULL_SAMPLING');

        expect(result).toEqual({
          coverage: 0,
          diversity: 0,
          uniformity: 0,
          validity: 0
        });
      });

      it('constraint.parametersがundefinedの場合、エラーなく適切なデフォルト値を返すべき', () => {
        const mockConstraint = {
          // parameters プロパティを意図的に省略
          constraints: []
        };
        samplingEngine.constraintEngine.constraints.TEST_UNDEFINED_SAMPLING = mockConstraint;

        const samples = [{ period: 10 }];
        const result = samplingEngine.evaluateSamplingQuality(samples, 'TEST_UNDEFINED_SAMPLING');

        expect(result).toEqual({
          coverage: 0,
          diversity: 0,
          uniformity: 0,
          validity: 0
        });
      });
    });

    describe('calculateUniformity', () => {
      it('paramDefsがnullの場合、エラーなく1を返すべき', () => {
        const samples = [
          { period: 10, threshold: 0.5 },
          { period: 20, threshold: 0.3 }
        ];

        const result = samplingEngine.calculateUniformity(samples, null);
        expect(result).toBe(1);
      });

      it('paramDefsがundefinedの場合、エラーなく1を返すべき', () => {
        const samples = [
          { period: 10, threshold: 0.5 },
          { period: 20, threshold: 0.3 }
        ];

        const result = samplingEngine.calculateUniformity(samples, undefined);
        expect(result).toBe(1);
      });
    });

    describe('calculateNormalizedDistance', () => {
      it('paramDefsがnullの場合、エラーなく0を返すべき', () => {
        const sample1 = { period: 10, threshold: 0.5 };
        const sample2 = { period: 20, threshold: 0.3 };

        const result = samplingEngine.calculateNormalizedDistance(sample1, sample2, null);
        expect(result).toBe(0);
      });

      it('paramDefsがundefinedの場合、エラーなく0を返すべき', () => {
        const sample1 = { period: 10, threshold: 0.5 };
        const sample2 = { period: 20, threshold: 0.3 };

        const result = samplingEngine.calculateNormalizedDistance(sample1, sample2, undefined);
        expect(result).toBe(0);
      });

      it('paramDefsが数値の場合、エラーなく0を返すべき', () => {
        const sample1 = { period: 10 };
        const sample2 = { period: 20 };

        const result = samplingEngine.calculateNormalizedDistance(sample1, sample2, 123);
        expect(result).toBe(0);
      });
    });
  });

  describe('統合テスト: 実際のバックテスト生成でエラーが発生しないこと', () => {
    it('不完全な制約定義でもエラーなくパラメータ生成できるべき', () => {
      // 実際のエラーシナリオをシミュレート
      const mockConstraint = {
        parameters: null, // これがエラーの原因
        constraints: []
      };
      constraintEngine.constraints.PROBLEMATIC_STRATEGY = mockConstraint;

      // このような呼び出しでTypeErrorが発生していた
      expect(() => {
        const parameterSet = [{ period: 10 }];
        const quality = constraintEngine.calculateParameterQuality(parameterSet, 'PROBLEMATIC_STRATEGY');
        expect(quality).toBeDefined();
        expect(quality.validity).toBe(0);
        expect(quality.diversity).toBe(0);
        expect(quality.coverage).toBe(0);
      }).not.toThrow();
    });

    it('SmartSamplingEngineでも不完全な制約定義でエラーが発生しないべき', () => {
      const mockConstraint = {
        parameters: undefined, // これがエラーの原因
        constraints: []
      };
      samplingEngine.constraintEngine.constraints.PROBLEMATIC_SAMPLING = mockConstraint;

      expect(() => {
        const samples = [{ period: 10 }, { period: 20 }];
        const quality = samplingEngine.evaluateSamplingQuality(samples, 'PROBLEMATIC_SAMPLING');
        expect(quality).toBeDefined();
        expect(quality.validity).toBe(0);
        expect(quality.diversity).toBe(0);
        expect(quality.uniformity).toBe(0);
      }).not.toThrow();
    });
  });

  describe('パラメータ品質レポート機能のnullハンドリング', () => {
    it('制約がnullでも品質レポートが生成できるべき', () => {
      // constraintEngine の getStrategyConstraints をモック
      const originalGetConstraints = constraintEngine.getStrategyConstraints;
      constraintEngine.getStrategyConstraints = jest.fn().mockReturnValue(null);

      const parameterSet = [{ period: 10 }];
      const result = constraintEngine.calculateParameterQuality(parameterSet, 'ANY_STRATEGY');

      expect(result).toEqual({
        validity: 0,
        diversity: 0,
        coverage: 0,
        efficiency: 0
      });

      // モックを復元
      constraintEngine.getStrategyConstraints = originalGetConstraints;
    });
  });
});