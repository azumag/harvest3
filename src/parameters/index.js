/**
 * インテリジェントパラメータ管理システム
 * 統合インターフェース
 */

const { ParameterConstraintEngine } = require('./constraintManager');
const { AdaptiveParameterManager } = require('./adaptiveRanges');
const { SmartSamplingEngine } = require('./smartSampling');

/**
 * インテリジェントパラメータマネージャー
 * 全ての機能を統合した高レベルインターフェース
 */
class IntelligentParameterManager {
  constructor(strategyType, options = {}) {
    this.strategyType = strategyType;
    this.options = options;
    
    this.constraintEngine = new ParameterConstraintEngine();
    this.samplingEngine = new SmartSamplingEngine();
    
    // 履歴データがある場合は適応的マネージャーを初期化
    this.adaptiveManager = options.historicalResults 
      ? new AdaptiveParameterManager(strategyType, options.historicalResults)
      : null;
  }

  /**
   * インテリジェントなパラメータ組み合わせを生成
   * @param {Object} options 生成オプション
   * @returns {Array} パラメータ組み合わせ配列
   */
  generateIntelligentParameterCombinations(options = {}) {
    const {
      count = 50,
      method = 'hybrid',
      useAdaptive = true,
      qualityThreshold = 0.7
    } = { ...this.options, ...options };

    let combinations = [];

    switch (method) {
      case 'constraint_aware':
        combinations = this.constraintEngine.generateValidCombinations(
          this.strategyType, 
          count
        );
        break;

      case 'latin_hypercube':
        combinations = this.samplingEngine.latinHypercubeSampling(
          this.strategyType, 
          count, 
          options
        );
        break;

      case 'adaptive':
        if (this.adaptiveManager) {
          combinations = this.adaptiveManager.generateSmartSamples(count, options);
        } else {
          combinations = this.constraintEngine.generateValidCombinations(
            this.strategyType, 
            count
          );
        }
        break;

      case 'diversity':
        combinations = this.samplingEngine.diversityBasedSampling(
          this.strategyType, 
          count, 
          options.minDistance || 0.1
        );
        break;

      case 'hybrid':
      default:
        const promisingRegions = this.adaptiveManager 
          ? this.adaptiveManager.identifyPromisingRegions()
          : [];
        
        combinations = this.samplingEngine.hybridSampling(
          this.strategyType, 
          count, 
          { ...options, promisingRegions }
        );
        break;
    }

    // 品質フィルタリング
    if (qualityThreshold > 0) {
      combinations = this.filterByQuality(combinations, qualityThreshold);
    }

    return combinations;
  }

  /**
   * レガシーインターフェース: グリッドサーチパラメータ生成
   * 既存のgenerateParameterCombinationsと互換性を保持
   * @param {Object} defaultConfig デフォルト設定
   * @param {Array} numericKeys 数値キー配列
   * @param {number} n 変動幅（デフォルト0.5）
   * @param {number} step ステップ数（デフォルト10）
   * @returns {Array} パラメータ組み合わせ配列
   */
  generateParameterCombinations(defaultConfig, numericKeys, n = 0.5, step = 10) {
    // インテリジェントな手法を使用
    const intelligentCount = Math.min(100, step * numericKeys.length * 2);
    
    const combinations = this.generateIntelligentParameterCombinations({
      count: intelligentCount,
      method: 'constraint_aware'
    });

    // レガシー形式に変換（デフォルト設定をベースに調整）
    const adjustedCombinations = combinations.map(combination => {
      const adjusted = { ...defaultConfig };
      for (const key of numericKeys) {
        if (combination[key] !== undefined) {
          adjusted[key] = combination[key];
        }
      }
      return adjusted;
    });

    return adjustedCombinations;
  }

  /**
   * レガシーインターフェース: ランダムパラメータ生成
   * 既存のgenerateRandomParameterCombinationsと互換性を保持
   * @param {Object} defaultConfig デフォルト設定
   * @param {Array} numericKeys 数値キー配列
   * @param {number} count 生成数
   * @param {number} n 変動幅（デフォルト0.1）
   * @returns {Array} パラメータ組み合わせ配列
   */
  generateRandomParameterCombinations(defaultConfig, numericKeys, count = 60, n = 0.1) {
    // インテリジェントなランダム生成を使用
    const combinations = this.generateIntelligentParameterCombinations({
      count,
      method: 'adaptive'
    });

    // レガシー形式に変換
    const adjustedCombinations = combinations.map(combination => {
      const adjusted = { ...defaultConfig };
      for (const key of numericKeys) {
        if (combination[key] !== undefined) {
          adjusted[key] = combination[key];
        }
      }
      return adjusted;
    });

    // デフォルト設定を最初に追加（レガシー互換性）
    if (adjustedCombinations.length > 0) {
      adjustedCombinations[0] = defaultConfig;
    } else {
      adjustedCombinations.push(defaultConfig);
    }

    return adjustedCombinations;
  }

  /**
   * 品質によるフィルタリング
   * @param {Array} combinations パラメータ組み合わせ
   * @param {number} threshold 品質閾値
   * @returns {Array} フィルタリング後の組み合わせ
   */
  filterByQuality(combinations, threshold) {
    const quality = this.constraintEngine.calculateParameterQuality(
      combinations, 
      this.strategyType
    );

    if (quality.validity >= threshold) {
      return combinations;
    }

    // 品質が低い場合は有効なもののみ抽出
    return combinations.filter(combination =>
      this.constraintEngine.validateCombination(combination, this.strategyType)
    );
  }

  /**
   * パラメータ最適化の分析レポートを生成
   * @param {Array} combinations パラメータ組み合わせ
   * @param {Array} results 最適化結果（オプション）
   * @returns {Object} 分析レポート
   */
  generateAnalysisReport(combinations, results = []) {
    const quality = this.constraintEngine.calculateParameterQuality(
      combinations, 
      this.strategyType
    );

    const samplingQuality = this.samplingEngine.evaluateSamplingQuality(
      combinations, 
      this.strategyType
    );

    const parameterImportance = this.adaptiveManager 
      ? this.adaptiveManager.analyzeParameterImportance()
      : {};

    const promisingRegions = this.adaptiveManager 
      ? this.adaptiveManager.identifyPromisingRegions()
      : [];

    return {
      parameterCount: combinations.length,
      quality: {
        ...quality,
        uniformity: samplingQuality.uniformity
      },
      parameterImportance,
      promisingRegions,
      constraints: this.constraintEngine.getStrategyConstraints(this.strategyType),
      recommendations: this.generateRecommendations(quality, parameterImportance)
    };
  }

  /**
   * 最適化推奨事項を生成
   * @param {Object} quality 品質指標
   * @param {Object} importance 重要度分析
   * @returns {Array} 推奨事項配列
   */
  generateRecommendations(quality, importance) {
    const recommendations = [];

    if (quality.validity < 0.8) {
      recommendations.push({
        type: 'warning',
        message: '無効なパラメータの割合が高すぎます。制約条件を確認してください。',
        action: 'constraint_review'
      });
    }

    if (quality.diversity < 0.5) {
      recommendations.push({
        type: 'improvement',
        message: 'パラメータの多様性が不足しています。サンプリング手法の変更を検討してください。',
        action: 'increase_diversity'
      });
    }

    if (quality.coverage < 0.6) {
      recommendations.push({
        type: 'improvement',
        message: 'パラメータ空間のカバー率が低いです。サンプル数の増加を検討してください。',
        action: 'increase_samples'
      });
    }

    // 重要度が高いパラメータの推奨
    for (const [param, info] of Object.entries(importance)) {
      if (info.overallImportance > 0.8) {
        recommendations.push({
          type: 'focus',
          message: `${param}は高い重要度を持っています。このパラメータに重点的に最適化してください。`,
          action: 'focus_parameter',
          parameter: param
        });
      }
    }

    return recommendations;
  }

  /**
   * 戦略タイプを自動検出
   * @param {Object} config 設定オブジェクト
   * @param {Array} numericKeys 数値キー配列
   * @returns {string|null} 検出された戦略タイプ
   */
  static detectStrategyType(config, numericKeys) {
    // パラメータパターンから戦略を推定
    const keySet = new Set(numericKeys);

    if (keySet.has('shortPeriod') && keySet.has('longPeriod')) {
      return 'MA_CROSS';
    }

    if (keySet.has('fastPeriod') && keySet.has('slowPeriod') && keySet.has('signalPeriod')) {
      return 'MACD';
    }

    if (keySet.has('period') && keySet.has('oversoldThreshold') && keySet.has('overboughtThreshold')) {
      return 'RSI';
    }

    if (keySet.has('period') && keySet.has('standardDeviation')) {
      return 'BOLLINGER_BANDS';
    }

    return null;
  }
}

/**
 * ファクトリー関数: 既存コードとの互換性を保つ
 * @param {Object} defaultConfig デフォルト設定
 * @param {Array} numericKeys 数値キー配列
 * @param {Object} options オプション
 * @returns {IntelligentParameterManager} パラメータマネージャー
 */
function createIntelligentParameterManager(defaultConfig, numericKeys, options = {}) {
  const strategyType = options.strategyType || 
    IntelligentParameterManager.detectStrategyType(defaultConfig, numericKeys);
  
  return new IntelligentParameterManager(strategyType, options);
}

module.exports = {
  IntelligentParameterManager,
  createIntelligentParameterManager,
  ParameterConstraintEngine,
  AdaptiveParameterManager,
  SmartSamplingEngine
};