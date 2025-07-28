/**
 * 量子インスパイア緊急度最適化システムテスト
 *
 * 量子コンピューティング概念を応用した並列最適化の包括的テスト
 *
 * 作成者: worker-claude (統合テストエンジニア)
 * 日付: 2025-06-28
 */

const { QuantumInspiredUrgencyOptimizer } = require('../../../../src/strategies/utils/quantumInspiredUrgencyOptimizer');

describe('量子インスパイア緊急度最適化システム包括テスト', () => {
  let quantumOptimizer;
  let marketContext;
  let testParameters;

  beforeEach(() => {
    // 標準設定での量子最適化システム初期化
    quantumOptimizer = new QuantumInspiredUrgencyOptimizer({
      enabled: true,
      quantumStates: 512,  // テスト用に軽量化
      entanglementDepth: 6,
      coherenceTime: 5000
    });

    // 市場コンテキストのテストデータ
    marketContext = {
      volatility: 0.05,
      riskLevel: 'medium',
      activeMarkets: 3,
      recentPerformance: 0.02,
      optimalVolatilityWeight: 0.3,
      optimalRiskWeight: 0.4,
      timestamp: Date.now()
    };

    // 現在のパラメータ
    testParameters = {
      volatilityWeight: 0.25,
      riskWeight: 0.35,
      timezoneWeight: 0.2,
      performanceWeight: 0.2
    };
  });

  describe('🔴 Red Phase: 基本初期化テスト', () => {
    test('量子最適化システムが正しく初期化される', () => {
      expect(quantumOptimizer.enabled).toBe(true);
      expect(quantumOptimizer.quantumStates).toBe(512);
      expect(quantumOptimizer.entanglementDepth).toBe(6);
      expect(quantumOptimizer.quantumRegister).toBeDefined();
      expect(quantumOptimizer.measurementCache).toBeDefined();
    });

    test('無効化設定で初期化される', () => {
      const disabledOptimizer = new QuantumInspiredUrgencyOptimizer({
        enabled: false
      });

      expect(disabledOptimizer.enabled).toBe(false);
    });

    test('カスタム設定が適用される', () => {
      const customOptimizer = new QuantumInspiredUrgencyOptimizer({
        quantumStates: 256,
        entanglementDepth: 4,
        coherenceTime: 8000
      });

      expect(customOptimizer.quantumStates).toBe(256);
      expect(customOptimizer.entanglementDepth).toBe(4);
      expect(customOptimizer.coherenceTime).toBe(8000);
    });
  });

  describe('🟢 Green Phase: 基本最適化機能', () => {
    test('量子アニーリング最適化が実行される', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result).toBeDefined();
      expect(result.method).toBe('quantum_annealing');
      expect(result.parameters).toBeDefined();
      expect(result.optimization).toBeDefined();
      expect(result.optimization.totalImprovement).toBeGreaterThan(0);
    });

    test('無効化時にオリジナルパラメータを返す', async () => {
      const disabledOptimizer = new QuantumInspiredUrgencyOptimizer({
        enabled: false
      });

      const result = await disabledOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result.method).toBe('disabled');
      expect(result.parameters).toEqual(testParameters);
    });

    test('市場コンテキストに応じた最適化', async () => {
      const highVolatilityContext = {
        ...marketContext,
        volatility: 0.15,
        riskLevel: 'high'
      };

      const result = await quantumOptimizer.optimizeUrgencyParameters(
        highVolatilityContext,
        testParameters
      );

      expect(result.parameters.volatilityWeight).toBeDefined();
      expect(result.parameters.riskWeight).toBeDefined();
      expect(result.optimization.volatilityOptimization).toBeDefined();
    });
  });

  describe('🔵 Blue Phase: 高度な量子最適化機能', () => {
    test('量子もつれ最適化が実行される', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result.quantum).toBeDefined();
      expect(result.quantum.entanglement).toBeDefined();
      expect(result.quantum.coherenceMetrics).toBeDefined();
      expect(result.quantum.superposition).toBeDefined();
    });

    test('ハミルトニアン最適化による性能向上', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result.hamiltonian).toBeDefined();
      expect(result.hamiltonian.eigenvalues).toBeDefined();
      expect(result.hamiltonian.groundState).toBeDefined();
      expect(result.optimization.totalImprovement).toBeGreaterThan(0.05);
    });

    test('量子回路設計による並列処理', async () => {
      const startTime = Date.now();

      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      const executionTime = Date.now() - startTime;

      expect(result.circuit).toBeDefined();
      expect(result.circuit.gates).toBeDefined();
      expect(result.circuit.parallelization).toBeDefined();
      expect(executionTime).toBeLessThan(10000); // 10秒以内
    });

    test('アニーリングスケジュール最適化', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result.annealing).toBeDefined();
      expect(result.annealing.schedule).toBeDefined();
      expect(result.annealing.temperature).toBeDefined();
      expect(result.annealing.convergence).toBeDefined();
    });
  });

  describe('🎯 性能向上測定テスト', () => {
    test('最適化による性能改善の測定', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      // 最適化改善率の検証
      expect(result.optimization.totalImprovement).toBeGreaterThanOrEqual(0.05); // 最低5%改善
      expect(result.optimization.volatilityOptimization).toBeGreaterThan(0);
      expect(result.optimization.riskOptimization).toBeGreaterThan(0);

      // パラメータの妥当性チェック（重みパラメータのみ）
      const optimizedParams = result.parameters;
      const weights = ['volatilityWeight', 'riskWeight', 'timezoneWeight', 'performanceWeight'];
      const weightSum = weights.reduce((sum, w) => sum + (optimizedParams[w] || 0), 0);
      expect(weightSum).toBeCloseTo(1.0, 2); // 重みの合計が1に近い
    });

    test('複数回実行での一貫性確認', async () => {
      const results = [];

      for (let i = 0; i < 3; i++) {
        const result = await quantumOptimizer.optimizeUrgencyParameters(
          marketContext,
          testParameters
        );
        results.push(result);
      }

      // 結果の一貫性確認
      for (const result of results) {
        expect(result.optimization.totalImprovement).toBeGreaterThan(0);
        expect(result.quantum.coherenceMetrics.stability).toBeGreaterThan(0.7);
      }
    });

    test('極端な市場条件での堅牢性', async () => {
      const extremeMarketContext = {
        volatility: 0.3,   // 極高ボラティリティ
        riskLevel: 'extreme',
        activeMarkets: 10,
        recentPerformance: -0.1, // 負の性能
        optimalVolatilityWeight: 0.8,
        optimalRiskWeight: 0.1
      };

      const result = await quantumOptimizer.optimizeUrgencyParameters(
        extremeMarketContext,
        testParameters
      );

      expect(result.parameters).toBeDefined();
      expect(result.optimization.totalImprovement).toBeGreaterThan(0);
      expect(result.quantum.coherenceMetrics.stability).toBeGreaterThan(0.5);
    });
  });

  describe('🔬 量子力学的特性テスト', () => {
    test('量子重ね合わせの維持', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result.quantum.superposition.coherence).toBeGreaterThan(0.8);
      expect(result.quantum.superposition.entanglement).toBeDefined();
      expect(result.quantum.superposition.interferencePattern).toBeDefined();
    });

    test('量子もつれによる相関最適化', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      const entanglement = result.quantum.entanglement;
      expect(entanglement.correlationMatrix).toBeDefined();
      expect(entanglement.entanglementMeasure).toBeGreaterThan(0);
      expect(entanglement.vonNeumannEntropy).toBeGreaterThan(0);
    });

    test('デコヒーレンス時間の管理', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      const coherenceMetrics = result.quantum.coherenceMetrics;
      expect(coherenceMetrics.timeConstant).toBeLessThan(quantumOptimizer.coherenceTime);
      expect(coherenceMetrics.fidelity).toBeGreaterThan(0.9);
      expect(coherenceMetrics.purity).toBeGreaterThan(0.8);
    });
  });

  describe('⚡ パフォーマンステスト', () => {
    test('並列処理による高速化', async () => {
      const largeQuantumOptimizer = new QuantumInspiredUrgencyOptimizer({
        quantumStates: 2048,
        entanglementDepth: 10
      });

      const startTime = Date.now();

      const result = await largeQuantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      const executionTime = Date.now() - startTime;

      expect(result.circuit.parallelization.speedup).toBeGreaterThan(1.5);
      expect(executionTime).toBeLessThan(15000); // 15秒以内
    });

    test('メモリ効率性', async () => {
      const memoryBeforeOptimization = process.memoryUsage().heapUsed;

      await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      const memoryAfterOptimization = process.memoryUsage().heapUsed;
      const memoryIncrease = memoryAfterOptimization - memoryBeforeOptimization;

      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB以内
    });

    test('キャッシュシステムの効率性', async () => {
      // 同じパラメータで複数回実行
      const firstResult = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      const startTime = Date.now();
      const secondResult = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );
      const cacheTime = Date.now() - startTime;

      expect(cacheTime).toBeLessThan(2000); // キャッシュ利用で2秒以内 (CI環境対応)
      expect(quantumOptimizer.measurementCache.size).toBeGreaterThan(0);
    });
  });

  describe('🛡️ エラーハンドリングと堅牢性', () => {
    test('無効な市場コンテキストの処理', async () => {
      const invalidContext = {
        volatility: -1, // 無効な値
        riskLevel: 'invalid',
        activeMarkets: -5
      };

      const result = await quantumOptimizer.optimizeUrgencyParameters(
        invalidContext,
        testParameters
      );

      expect(result.parameters).toBeDefined();
      expect(result.error).toBeUndefined(); // エラーではなく修正された値で実行
    });

    test('量子デコヒーレンスの対処', async () => {
      // コヒーレンス時間を極端に短く設定
      const shortCoherenceOptimizer = new QuantumInspiredUrgencyOptimizer({
        coherenceTime: 100
      });

      const result = await shortCoherenceOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result.quantum.decoherenceHandling).toBeDefined();
      expect(result.quantum.errorCorrection).toBeDefined();
    });

    test('ノイズ耐性の確認', async () => {
      const noisyMarketContext = {
        ...marketContext,
        noise: 0.2, // 20%のノイズ
        uncertainty: 0.15
      };

      const result = await quantumOptimizer.optimizeUrgencyParameters(
        noisyMarketContext,
        testParameters
      );

      expect(result.quantum.noiseReduction).toBeDefined();
      expect(result.optimization.totalImprovement).toBeGreaterThan(0);
    });
  });

  describe('🔗 ベイジアン最適化との統合', () => {
    test('量子ベイジアンハイブリッド最適化', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      expect(result.hybrid).toBeDefined();
      expect(result.hybrid.bayesianIntegration).toBeDefined();
      expect(result.hybrid.quantumPrior).toBeDefined();
      expect(result.hybrid.acquisitionFunction).toBeDefined();
    });

    test('ガウス過程と量子回路の統合', async () => {
      const result = await quantumOptimizer.optimizeUrgencyParameters(
        marketContext,
        testParameters
      );

      const hybridResult = result.hybrid;
      expect(hybridResult.gaussianProcess).toBeDefined();
      expect(hybridResult.quantumKernel).toBeDefined();
      expect(hybridResult.uncertaintyQuantification).toBeDefined();
    });
  });
});