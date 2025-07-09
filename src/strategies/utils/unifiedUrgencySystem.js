/**
 * 統合動的urgencyシステム
 * 全ての高度urgency機能を統合し、統一インターフェースを提供
 */

const { DynamicUrgencyCalculator } = require('./dynamicUrgencyCalculator');
const { UrgencyPerformanceMonitor } = require('./urgencyPerformanceMonitor');
const { MLUrgencyPredictor } = require('./mlUrgencyPredictor');
const { MultiTimeframeUrgencyAnalysis } = require('./multiTimeframeUrgencyAnalysis');
const { UrgencyABTestingSystem } = require('./urgencyABTestingSystem');

class UnifiedUrgencySystem {
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.mode = config.mode || 'production'; // development, testing, production

    // コンポーネント初期化
    this.dynamicCalculator = new DynamicUrgencyCalculator(config.dynamic || {});
    this.performanceMonitor = new UrgencyPerformanceMonitor(config.monitoring || {});
    this.mlPredictor = new MLUrgencyPredictor(config.ml || {});
    this.multiTimeframeAnalyzer = new MultiTimeframeUrgencyAnalysis(config.multiTimeframe || {});
    this.abTestingSystem = new UrgencyABTestingSystem(config.abTesting || {});

    // システム設定
    this.fallbackStrategy = config.fallbackStrategy || 'rule_based';
    this.maxCalculationTime = config.maxCalculationTime || 5000; // 5秒
    this.enableAutoOptimization = config.enableAutoOptimization !== false;
    this.enableRealTimeAdaptation = config.enableRealTimeAdaptation !== false;

    // パフォーマンス追跡
    this.systemMetrics = {
      totalRequests: 0,
      successfulCalculations: 0,
      fallbackUsage: 0,
      avgCalculationTime: 0,
      errorCount: 0,
      lastOptimization: 0
    };

    // 最適化設定
    this.optimizationInterval = config.optimizationInterval || 24 * 60 * 60 * 1000; // 24時間
    this.adaptationThreshold = config.adaptationThreshold || 0.05; // 5%改善で適応

    console.log('[UnifiedUrgencySystem] 統合システム初期化完了');
  }

  /**
   * メイン urgency 計算エントリーポイント
   * @param {Object} context - 取引コンテキスト
   * @returns {Promise<Object>} 最適化されたurgency結果
   */
  async calculateOptimalUrgency(context) {
    if (!this.enabled) {
      return { urgency: context.baseUrgency, method: 'disabled', confidence: 0 };
    }

    const startTime = Date.now();
    this.systemMetrics.totalRequests++;

    try {
      // A/Bテスト群決定（本番環境のみ）
      let testAssignment = null;
      if (this.mode === 'production' && this.abTestingSystem.enabled) {
        testAssignment = await this.assignABTestGroup(context);
        if (testAssignment && testAssignment.group !== 'unified') {
          return await this.executeTestGroupStrategy(testAssignment, context);
        }
      }

      // 統合urgency計算実行
      const result = await this.executeUnifiedCalculation(context);

      // パフォーマンス監視記録
      this.recordPerformanceData(context, result, startTime);

      // リアルタイム適応（有効時）
      if (this.enableRealTimeAdaptation) {
        await this.performRealTimeAdaptation(context, result);
      }

      this.systemMetrics.successfulCalculations++;
      this.systemMetrics.avgCalculationTime = this.updateAverage(
        this.systemMetrics.avgCalculationTime,
        Date.now() - startTime,
        this.systemMetrics.successfulCalculations
      );

      return result;

    } catch (error) {
      console.error('[UnifiedUrgency] 計算エラー:', error.message);
      this.systemMetrics.errorCount++;

      // フォールバック戦略実行
      return await this.executeFallbackStrategy(context, error);
    }
  }

  /**
   * A/Bテスト群割り当て
   * @param {Object} context - コンテキスト
   * @returns {Promise<Object>} テスト割り当て結果
   */
  async assignABTestGroup(context) {
    try {
      const strategies = {
        ruleBasedDynamic: this.dynamicCalculator,
        mlBased: this.mlPredictor,
        multiTimeframe: this.multiTimeframeAnalyzer
      };

      return await this.abTestingSystem.assignTestGroupAndUrgency(
        context.symbol,
        context.baseUrgency,
        context,
        strategies
      );
    } catch (error) {
      console.warn('[UnifiedUrgency] A/Bテスト割り当てエラー:', error.message);
      return null;
    }
  }

  /**
   * テスト群戦略実行
   * @param {Object} testAssignment - テスト割り当て
   * @param {Object} context - コンテキスト
   * @returns {Promise<Object>} テスト戦略結果
   */
  async executeTestGroupStrategy(testAssignment, context) {
    const result = {
      urgency: testAssignment.urgency,
      method: testAssignment.group,
      confidence: testAssignment.confidence,
      testId: testAssignment.testId,
      isTestGroup: true,
      metadata: testAssignment.metadata
    };

    console.log(`[UnifiedUrgency] A/Bテスト実行: ${testAssignment.group} (${context.symbol})`);
    return result;
  }

  /**
   * 統合urgency計算実行
   * @param {Object} context - コンテキスト
   * @returns {Promise<Object>} 統合計算結果
   */
  async executeUnifiedCalculation(context) {
    const calculations = {};
    const weights = await this.getDynamicWeights(context);

    // 並列計算実行（タイムアウト付き）
    const calculationPromises = [
      this.executeWithTimeout('ruleBased', () =>
        this.dynamicCalculator.calculateDynamicUrgency(context.symbol, context.baseUrgency, context)
      ),
      this.executeWithTimeout('ml', () =>
        this.mlPredictor.predictOptimalUrgency(context, context.baseUrgency)
      ),
      this.executeWithTimeout('multiTimeframe', () =>
        this.multiTimeframeAnalyzer.analyzeMultiTimeframeUrgency(
          context.exchange, context.symbol, context.baseUrgency, context
        )
      )
    ];

    const results = await Promise.allSettled(calculationPromises);

    // 結果処理
    results.forEach((result, index) => {
      const methods = ['ruleBased', 'ml', 'multiTimeframe'];
      const method = methods[index];

      if (result.status === 'fulfilled') {
        calculations[method] = result.value;
      } else {
        console.warn(`[UnifiedUrgency] ${method}計算失敗:`, result.reason.message);
        calculations[method] = { urgency: context.baseUrgency, confidence: 0, error: result.reason.message };
      }
    });

    // アンサンブル統合
    const integratedResult = this.integrateCalculationResults(calculations, weights, context);

    // 信頼度検証
    const validatedResult = this.validateResult(integratedResult, context);

    return validatedResult;
  }

  /**
   * タイムアウト付き実行
   * @param {string} method - メソッド名
   * @param {Function} calculationFunc - 計算関数
   * @returns {Promise} 計算結果
   */
  async executeWithTimeout(method, calculationFunc) {
    return Promise.race([
      calculationFunc(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${method} timeout`)), this.maxCalculationTime)
      )
    ]);
  }

  /**
   * 動的重み取得
   * @param {Object} context - コンテキスト
   * @returns {Promise<Object>} 重み設定
   */
  async getDynamicWeights(context) {
    // パフォーマンス履歴に基づく動的重み調整
    const performanceHistory = await this.performanceMonitor.generatePerformanceReport();

    if (!performanceHistory) {
      return { ruleBased: 0.4, ml: 0.3, multiTimeframe: 0.3 }; // デフォルト重み
    }

    // 各手法の成功率に基づく重み調整
    const weights = {};
    let totalWeight = 0;

    ['ruleBased', 'ml', 'multiTimeframe'].forEach(method => {
      const successRate = this.extractSuccessRate(performanceHistory, method);
      const confidence = this.extractConfidence(performanceHistory, method);
      weights[method] = Math.max(0.1, successRate * confidence);
      totalWeight += weights[method];
    });

    // 正規化
    Object.keys(weights).forEach(method => {
      weights[method] = weights[method] / totalWeight;
    });

    return weights;
  }

  /**
   * 計算結果統合
   * @param {Object} calculations - 各手法の計算結果
   * @param {Object} weights - 重み設定
   * @param {Object} context - コンテキスト
   * @returns {Object} 統合結果
   */
  integrateCalculationResults(calculations, weights, context) {
    const urgencyScores = { low: 0, medium: 1, high: 2 };
    const scoreToUrgency = { 0: 'low', 1: 'medium', 2: 'high' };

    let weightedScore = 0;
    let totalWeight = 0;
    let totalConfidence = 0;
    let validMethods = 0;
    const methodResults = {};

    // 各手法の結果を統合
    Object.entries(calculations).forEach(([method, result]) => {
      if (result && !result.error) {
        const urgencyScore = urgencyScores[result.urgency] || 1;
        const confidence = result.confidence || 0.5;
        const weight = weights[method] || 0.1;

        weightedScore += urgencyScore * weight * confidence;
        totalWeight += weight * confidence;
        totalConfidence += confidence;
        validMethods++;

        methodResults[method] = {
          urgency: result.urgency,
          confidence: confidence,
          weight: weight,
          contribution: urgencyScore * weight * confidence
        };
      }
    });

    // 最終urgency決定
    const finalScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 1;
    const finalUrgency = scoreToUrgency[Math.max(0, Math.min(2, finalScore))] || 'medium';
    const avgConfidence = validMethods > 0 ? totalConfidence / validMethods : 0.5;

    // 一致性チェック
    const consistency = this.calculateMethodConsistency(calculations);

    return {
      urgency: finalUrgency,
      confidence: avgConfidence * consistency, // 一致性で信頼度調整
      method: 'unified_ensemble',
      methodResults,
      consistency,
      validMethods,
      integrationDetails: {
        weightedScore: weightedScore / totalWeight,
        finalScore,
        weights,
        calculations
      }
    };
  }

  /**
   * 手法間一致性計算
   * @param {Object} calculations - 計算結果
   * @returns {number} 一致性スコア（0-1）
   */
  calculateMethodConsistency(calculations) {
    const urgencies = Object.values(calculations)
      .filter(calc => calc && !calc.error)
      .map(calc => calc.urgency);

    if (urgencies.length < 2) {
      return 0.5;
    }

    const urgencyCount = {};
    urgencies.forEach(urgency => {
      urgencyCount[urgency] = (urgencyCount[urgency] || 0) + 1;
    });

    const maxCount = Math.max(...Object.values(urgencyCount));
    return maxCount / urgencies.length; // 最多一致率
  }

  /**
   * 結果検証
   * @param {Object} result - 統合結果
   * @param {Object} context - コンテキスト
   * @returns {Object} 検証済み結果
   */
  validateResult(result, context) {
    // 信頼度閾値チェック
    const minConfidence = 0.3;
    if (result.confidence < minConfidence) {
      console.warn(`[UnifiedUrgency] 低信頼度警告: ${result.confidence.toFixed(3)} < ${minConfidence}`);
      result.urgency = context.baseUrgency; // フォールバック
      result.fallbackReason = 'low_confidence';
    }

    // 市場状況との整合性チェック
    const marketConsistency = this.checkMarketConsistency(result, context);
    if (!marketConsistency.isConsistent) {
      console.warn(`[UnifiedUrgency] 市場整合性警告: ${marketConsistency.reason}`);
      result.marketConsistencyWarning = marketConsistency.reason;
    }

    // 最終安全性チェック
    result.safetyChecked = true;
    result.validationTimestamp = Date.now();

    return result;
  }

  /**
   * 市場整合性チェック
   * @param {Object} result - 結果
   * @param {Object} context - コンテキスト
   * @returns {Object} 整合性結果
   */
  checkMarketConsistency(result, context) {
    // 高ボラティリティ時の低urgency警告
    if (context.marketCondition?.volatility > 0.8 && result.urgency === 'low') {
      return { isConsistent: false, reason: 'high_volatility_low_urgency' };
    }

    // 低ボラティリティ時の高urgency警告
    if (context.marketCondition?.volatility < 0.2 && result.urgency === 'high') {
      return { isConsistent: false, reason: 'low_volatility_high_urgency' };
    }

    // リスク限界接近時の高urgency警告
    if (context.portfolioRisk?.riskProximity > 0.8 && result.urgency === 'high') {
      return { isConsistent: false, reason: 'high_risk_high_urgency' };
    }

    return { isConsistent: true };
  }

  /**
   * フォールバック戦略実行
   * @param {Object} context - コンテキスト
   * @param {Error} error - エラー情報
   * @returns {Promise<Object>} フォールバック結果
   */
  async executeFallbackStrategy(context, error) {
    this.systemMetrics.fallbackUsage++;

    try {
      let fallbackResult;

      switch (this.fallbackStrategy) {
      case 'rule_based':
        fallbackResult = await this.dynamicCalculator.calculateDynamicUrgency(
          context.symbol, context.baseUrgency, context
        );
        break;

      case 'static':
        fallbackResult = context.baseUrgency;
        break;

      case 'conservative':
        fallbackResult = 'low'; // 保守的
        break;

      default:
        fallbackResult = context.baseUrgency;
      }

      return {
        urgency: fallbackResult,
        method: `fallback_${this.fallbackStrategy}`,
        confidence: 0.3,
        error: error.message,
        fallback: true
      };

    } catch (fallbackError) {
      console.error('[UnifiedUrgency] フォールバック失敗:', fallbackError.message);
      return {
        urgency: context.baseUrgency,
        method: 'emergency_static',
        confidence: 0.1,
        error: `Primary: ${error.message}, Fallback: ${fallbackError.message}`,
        fallback: true
      };
    }
  }

  /**
   * パフォーマンスデータ記録
   * @param {Object} context - コンテキスト
   * @param {Object} result - 結果
   * @param {number} startTime - 開始時刻
   */
  recordPerformanceData(context, result, startTime) {
    try {
      const performanceData = {
        symbol: context.symbol,
        baseUrgency: context.baseUrgency,
        finalUrgency: result.urgency,
        method: result.method,
        confidence: result.confidence,
        calculationTime: Date.now() - startTime,
        marketCondition: context.marketCondition,
        metadata: result.integrationDetails
      };

      this.performanceMonitor.recordCalculationPerformance(performanceData);
    } catch (error) {
      console.warn('[UnifiedUrgency] パフォーマンス記録エラー:', error.message);
    }
  }

  /**
   * リアルタイム適応実行
   * @param {Object} context - コンテキスト
   * @param {Object} result - 結果
   */
  async performRealTimeAdaptation(context, result) {
    try {
      // 低信頼度が続く場合の適応
      if (result.confidence < 0.4) {
        await this.adaptToLowConfidence(context, result);
      }

      // 一致性が低い場合の適応
      if (result.consistency < 0.5) {
        await this.adaptToLowConsistency(context, result);
      }

      // 定期最適化チェック
      if (Date.now() - this.systemMetrics.lastOptimization > this.optimizationInterval) {
        await this.performSystemOptimization();
      }
    } catch (error) {
      console.warn('[UnifiedUrgency] リアルタイム適応エラー:', error.message);
    }
  }

  /**
   * 低信頼度適応
   * @param {Object} context - コンテキスト
   * @param {Object} result - 結果
   */
  async adaptToLowConfidence(context, result) {
    console.log(`[UnifiedUrgency] 低信頼度適応開始: ${result.confidence.toFixed(3)}`);

    // 機械学習モデル再訓練トリガー
    if (this.mlPredictor.shouldRetrain()) {
      await this.mlPredictor.retrainModels();
    }

    // 重み調整
    await this.adjustMethodWeights('confidence_adaptation');
  }

  /**
   * 低一致性適応
   * @param {Object} context - コンテキスト
   * @param {Object} result - 結果
   */
  async adaptToLowConsistency(context, result) {
    console.log(`[UnifiedUrgency] 低一致性適応開始: ${result.consistency.toFixed(3)}`);

    // 不一致原因分析
    const inconsistencyAnalysis = this.analyzeInconsistency(result.integrationDetails.calculations);

    // 問題のある手法の重み削減
    await this.adjustMethodWeights('consistency_adaptation', inconsistencyAnalysis);
  }

  /**
   * システム最適化実行
   */
  async performSystemOptimization() {
    console.log('[UnifiedUrgency] システム最適化開始');

    try {
      // A/Bテスト結果に基づく最適化
      const abTestReport = this.abTestingSystem.generateABTestReport();
      if (abTestReport) {
        await this.optimizeFromABTestResults(abTestReport);
      }

      // パフォーマンス履歴に基づく最適化
      const performanceReport = this.performanceMonitor.generatePerformanceReport();
      if (performanceReport) {
        await this.optimizeFromPerformanceHistory(performanceReport);
      }

      this.systemMetrics.lastOptimization = Date.now();
      console.log('[UnifiedUrgency] システム最適化完了');

    } catch (error) {
      console.error('[UnifiedUrgency] システム最適化エラー:', error.message);
    }
  }

  /**
   * 注文実行結果フィードバック記録
   * @param {string} testId - テストID
   * @param {Object} executionResult - 実行結果
   */
  recordExecutionFeedback(testId, executionResult) {
    try {
      // A/Bテストシステムに結果記録
      if (testId && this.abTestingSystem.enabled) {
        this.abTestingSystem.recordTestResult(testId, executionResult);
      }

      // パフォーマンス監視システムに記録
      this.performanceMonitor.recordOrderExecution(
        executionResult.orderData,
        executionResult.urgencyData,
        executionResult
      );

    } catch (error) {
      console.error('[UnifiedUrgency] フィードバック記録エラー:', error.message);
    }
  }

  /**
   * システム状態レポート生成
   * @returns {Object} システム状態レポート
   */
  generateSystemReport() {
    try {
      return {
        timestamp: new Date().toISOString(),
        systemMetrics: this.systemMetrics,
        components: {
          dynamicCalculator: { enabled: this.dynamicCalculator.enabled },
          performanceMonitor: { enabled: this.performanceMonitor.enabled },
          mlPredictor: { enabled: this.mlPredictor.enabled },
          multiTimeframeAnalyzer: { enabled: this.multiTimeframeAnalyzer.enabled },
          abTestingSystem: { enabled: this.abTestingSystem.enabled }
        },
        configuration: {
          mode: this.mode,
          fallbackStrategy: this.fallbackStrategy,
          maxCalculationTime: this.maxCalculationTime,
          enableAutoOptimization: this.enableAutoOptimization,
          enableRealTimeAdaptation: this.enableRealTimeAdaptation
        },
        health: this.assessSystemHealth()
      };
    } catch (error) {
      console.error('[UnifiedUrgency] レポート生成エラー:', error.message);
      return { error: error.message };
    }
  }

  /**
   * システム健全性評価
   * @returns {Object} 健全性評価
   */
  assessSystemHealth() {
    const successRate = this.systemMetrics.totalRequests > 0
      ? this.systemMetrics.successfulCalculations / this.systemMetrics.totalRequests
      : 1;

    const errorRate = this.systemMetrics.totalRequests > 0
      ? this.systemMetrics.errorCount / this.systemMetrics.totalRequests
      : 0;

    const fallbackRate = this.systemMetrics.totalRequests > 0
      ? this.systemMetrics.fallbackUsage / this.systemMetrics.totalRequests
      : 0;

    let healthStatus = 'excellent';
    if (successRate < 0.9 || errorRate > 0.1 || fallbackRate > 0.2) {
      healthStatus = 'good';
    }
    if (successRate < 0.8 || errorRate > 0.2 || fallbackRate > 0.4) {
      healthStatus = 'fair';
    }
    if (successRate < 0.7 || errorRate > 0.3 || fallbackRate > 0.6) {
      healthStatus = 'poor';
    }

    return {
      status: healthStatus,
      successRate: (successRate * 100).toFixed(2) + '%',
      errorRate: (errorRate * 100).toFixed(2) + '%',
      fallbackRate: (fallbackRate * 100).toFixed(2) + '%',
      avgCalculationTime: this.systemMetrics.avgCalculationTime + 'ms'
    };
  }

  // ============ ヘルパーメソッド ============

  updateAverage(currentAvg, newValue, count) {
    return ((currentAvg * (count - 1)) + newValue) / count;
  }

  extractSuccessRate(performanceHistory, method) {
    // パフォーマンス履歴から成功率を抽出
    return 0.8; // プレースホルダー
  }

  extractConfidence(performanceHistory, method) {
    // パフォーマンス履歴から信頼度を抽出
    return 0.7; // プレースホルダー
  }

  analyzeInconsistency(calculations) {
    // 不一致分析ロジック
    return { problemMethods: [] };
  }

  async adjustMethodWeights(reason, analysis = {}) {
    console.log(`[UnifiedUrgency] 重み調整: ${reason}`);
    // 重み調整ロジック（実装省略）
  }

  async optimizeFromABTestResults(abTestReport) {
    // A/Bテスト結果からの最適化（実装省略）
  }

  async optimizeFromPerformanceHistory(performanceReport) {
    // パフォーマンス履歴からの最適化（実装省略）
  }

  /**
   * キャッシュクリア
   */
  clearCache() {
    this.dynamicCalculator.clearCache();
    this.performanceMonitor.clearCache();
    this.multiTimeframeAnalyzer.clearCache();
    this.abTestingSystem.clearCache();
  }
}

module.exports = { UnifiedUrgencySystem };