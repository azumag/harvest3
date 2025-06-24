/**
 * 機械学習ベースのurgency予測システム
 * 過去のデータから最適なurgency調整を学習し、予測精度を向上
 */

class MLUrgencyPredictor {
  constructor(options = {}) {
    this.enabled = options.enabled || false;
    this.modelType = options.modelType || 'adaptive_ensemble';
    this.trainingWindow = options.trainingWindow || 7 * 24 * 60 * 60 * 1000; // 7日
    this.minTrainingData = options.minTrainingData || 100;
    this.retrainInterval = options.retrainInterval || 24 * 60 * 60 * 1000; // 24時間
    
    // モデル状態
    this.models = new Map();
    this.featureStats = new Map();
    this.lastTrainingTime = 0;
    this.isTraining = false;
    
    // 特徴量定義
    this.features = [
      'volatilityScore', 'riskProximity', 'timeActivity', 'performanceScore',
      'priceChange1h', 'priceChange4h', 'priceChange24h',
      'volumeRatio', 'spreadRatio', 'marketCap',
      'orderBookDepth', 'recentTrades', 'liquidityScore'
    ];
    
    // アンサンブルモデル
    this.ensemble = {
      neuralNetwork: new SimpleNeuralNetwork(),
      decisionTree: new SimpleDecisionTree(),
      linearRegression: new WeightedLinearRegression(),
      adaptiveRules: new AdaptiveRuleEngine()
    };
    
    console.log('[MLUrgencyPredictor] 初期化完了');
  }

  /**
   * urgency予測（メイン関数）
   * @param {Object} marketContext - 市場コンテキスト
   * @param {string} baseUrgency - ベースurgency
   * @returns {Promise<Object>} 予測結果
   */
  async predictOptimalUrgency(marketContext, baseUrgency) {
    if (!this.enabled) {
      return { urgency: baseUrgency, confidence: 0, method: 'disabled' };
    }

    try {
      // 特徴量抽出
      const features = await this.extractFeatures(marketContext);
      
      // モデル再訓練チェック
      if (this.shouldRetrain()) {
        await this.retrainModels();
      }
      
      // アンサンブル予測
      const predictions = await this.generateEnsemblePredictions(features);
      
      // 最終予測統合
      const finalPrediction = this.integratePredictions(predictions, baseUrgency);
      
      return {
        urgency: finalPrediction.urgency,
        confidence: finalPrediction.confidence,
        method: 'ml_ensemble',
        predictions,
        features: features.normalized
      };

    } catch (error) {
      console.error('[MLUrgencyPredictor] 予測エラー:', error.message);
      return { urgency: baseUrgency, confidence: 0, method: 'fallback' };
    }
  }

  /**
   * 特徴量抽出
   * @param {Object} context - 市場コンテキスト
   * @returns {Object} 特徴量セット
   */
  async extractFeatures(context) {
    const { symbol, marketData, portfolioData, timeData, performanceData } = context;
    
    const raw = {
      // 基本要因
      volatilityScore: marketData?.volatilityScore || 0.5,
      riskProximity: portfolioData?.riskProximity || 0,
      timeActivity: timeData?.activityScore || 0.5,
      performanceScore: performanceData?.overallScore || 0.5,
      
      // 価格変動特徴
      priceChange1h: marketData?.priceChange1h || 0,
      priceChange4h: marketData?.priceChange4h || 0,
      priceChange24h: marketData?.priceChange24h || 0,
      
      // 市場構造特徴
      volumeRatio: marketData?.volumeRatio || 1,
      spreadRatio: marketData?.spreadRatio || 0.001,
      marketCap: marketData?.marketCap || 0,
      
      // 流動性特徴
      orderBookDepth: marketData?.orderBookDepth || 0.5,
      recentTrades: marketData?.recentTradeCount || 0,
      liquidityScore: marketData?.liquidityScore || 0.5
    };

    // 特徴量正規化
    const normalized = this.normalizeFeatures(raw);
    
    // 相互作用特徴量
    const interactions = this.createInteractionFeatures(normalized);
    
    return { raw, normalized, interactions };
  }

  /**
   * 特徴量正規化
   * @param {Object} rawFeatures - 生特徴量
   * @returns {Object} 正規化済み特徴量
   */
  normalizeFeatures(rawFeatures) {
    const normalized = {};
    
    for (const [feature, value] of Object.entries(rawFeatures)) {
      const stats = this.featureStats.get(feature) || {
        mean: 0, std: 1, min: value, max: value, count: 1
      };
      
      // Z-score正規化 + Min-Max正規化のハイブリッド
      const zScore = stats.std > 0 ? (value - stats.mean) / stats.std : 0;
      const minMax = stats.max > stats.min ? (value - stats.min) / (stats.max - stats.min) : 0.5;
      
      // ロバストな正規化（外れ値に強い）
      normalized[feature] = (zScore * 0.7) + (minMax * 0.3);
      
      // 統計情報更新
      this.updateFeatureStats(feature, value, stats);
    }
    
    return normalized;
  }

  /**
   * 相互作用特徴量生成
   * @param {Object} features - 正規化済み特徴量
   * @returns {Object} 相互作用特徴量
   */
  createInteractionFeatures(features) {
    const interactions = {};
    
    // 重要な特徴量ペアの相互作用
    const importantPairs = [
      ['volatilityScore', 'riskProximity'],
      ['timeActivity', 'liquidityScore'],
      ['performanceScore', 'volumeRatio'],
      ['priceChange1h', 'spreadRatio'],
      ['orderBookDepth', 'recentTrades']
    ];
    
    importantPairs.forEach(([feat1, feat2]) => {
      const val1 = features[feat1] || 0;
      const val2 = features[feat2] || 0;
      
      interactions[`${feat1}_x_${feat2}`] = val1 * val2;
      interactions[`${feat1}_plus_${feat2}`] = (val1 + val2) / 2;
      interactions[`${feat1}_diff_${feat2}`] = Math.abs(val1 - val2);
    });
    
    // 非線形変換
    Object.keys(features).forEach(feat => {
      const val = features[feat] || 0;
      interactions[`${feat}_squared`] = val * val;
      interactions[`${feat}_sqrt`] = Math.sqrt(Math.abs(val));
      interactions[`${feat}_tanh`] = Math.tanh(val);
    });
    
    return interactions;
  }

  /**
   * アンサンブル予測生成
   * @param {Object} features - 特徴量セット
   * @returns {Object} 各モデルの予測
   */
  async generateEnsemblePredictions(features) {
    const predictions = {};
    
    // 各モデルから予測を取得
    for (const [modelName, model] of Object.entries(this.ensemble)) {
      try {
        const prediction = await model.predict(features);
        predictions[modelName] = {
          urgencyAdjustment: prediction.adjustment,
          confidence: prediction.confidence,
          reasoning: prediction.reasoning
        };
      } catch (error) {
        console.warn(`[MLUrgency] ${modelName}予測エラー:`, error.message);
        predictions[modelName] = {
          urgencyAdjustment: 0,
          confidence: 0,
          reasoning: 'prediction_failed'
        };
      }
    }
    
    return predictions;
  }

  /**
   * 予測統合
   * @param {Object} predictions - 各モデルの予測
   * @param {string} baseUrgency - ベースurgency
   * @returns {Object} 統合された最終予測
   */
  integratePredictions(predictions, baseUrgency) {
    // 信頼度重み付き平均
    let totalWeight = 0;
    let weightedAdjustment = 0;
    let avgConfidence = 0;
    
    const modelWeights = {
      neuralNetwork: 0.3,
      decisionTree: 0.25,
      linearRegression: 0.25,
      adaptiveRules: 0.2
    };
    
    for (const [modelName, prediction] of Object.entries(predictions)) {
      const baseWeight = modelWeights[modelName] || 0.1;
      const weight = baseWeight * (prediction.confidence || 0.1);
      
      totalWeight += weight;
      weightedAdjustment += prediction.urgencyAdjustment * weight;
      avgConfidence += prediction.confidence;
    }
    
    const finalAdjustment = totalWeight > 0 ? weightedAdjustment / totalWeight : 0;
    const finalConfidence = avgConfidence / Object.keys(predictions).length;
    
    // urgency適用
    const finalUrgency = this.applyAdjustmentToUrgency(baseUrgency, finalAdjustment);
    
    return {
      urgency: finalUrgency,
      confidence: finalConfidence,
      adjustment: finalAdjustment,
      modelCount: Object.keys(predictions).length
    };
  }

  /**
   * urgencyレベル調整適用
   * @param {string} baseUrgency - ベースurgency
   * @param {number} adjustment - 調整値（-1 to 1）
   * @returns {string} 調整後urgency
   */
  applyAdjustmentToUrgency(baseUrgency, adjustment) {
    const urgencyLevels = ['low', 'medium', 'high'];
    const currentIndex = urgencyLevels.indexOf(baseUrgency);
    
    if (currentIndex === -1) return baseUrgency;
    
    // 調整の適用
    let newIndex = currentIndex;
    
    if (adjustment > 0.3) {
      newIndex = Math.min(urgencyLevels.length - 1, currentIndex + 1);
    } else if (adjustment < -0.3) {
      newIndex = Math.max(0, currentIndex - 1);
    }
    // -0.3 to 0.3の範囲では変更なし
    
    return urgencyLevels[newIndex];
  }

  /**
   * 再訓練が必要かチェック
   * @returns {boolean} 再訓練要否
   */
  shouldRetrain() {
    const timeSinceLastTraining = Date.now() - this.lastTrainingTime;
    return !this.isTraining && timeSinceLastTraining > this.retrainInterval;
  }

  /**
   * モデル再訓練
   */
  async retrainModels() {
    if (this.isTraining) return;
    
    try {
      this.isTraining = true;
      console.log('[MLUrgency] モデル再訓練開始');
      
      // 訓練データ収集
      const trainingData = await this.collectTrainingData();
      
      if (trainingData.length < this.minTrainingData) {
        console.log(`[MLUrgency] 訓練データ不足: ${trainingData.length}/${this.minTrainingData}`);
        return;
      }
      
      // 各モデルを並列訓練
      const trainingPromises = Object.entries(this.ensemble).map(async ([name, model]) => {
        try {
          await model.train(trainingData);
          console.log(`[MLUrgency] ${name}訓練完了`);
        } catch (error) {
          console.error(`[MLUrgency] ${name}訓練エラー:`, error.message);
        }
      });
      
      await Promise.all(trainingPromises);
      
      this.lastTrainingTime = Date.now();
      console.log('[MLUrgency] 全モデル再訓練完了');
      
    } catch (error) {
      console.error('[MLUrgency] 再訓練エラー:', error.message);
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * 訓練データ収集
   * @returns {Array} 訓練データセット
   */
  async collectTrainingData() {
    // 実装は監視システムからのデータ収集
    // パフォーマンス監視システムとの連携が必要
    return [];
  }

  /**
   * 特徴量統計更新
   * @param {string} feature - 特徴量名
   * @param {number} value - 新しい値
   * @param {Object} stats - 現在の統計
   */
  updateFeatureStats(feature, value, stats) {
    stats.count++;
    const delta = value - stats.mean;
    stats.mean += delta / stats.count;
    stats.std = Math.sqrt(((stats.count - 1) * Math.pow(stats.std, 2) + delta * (value - stats.mean)) / stats.count);
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
    
    this.featureStats.set(feature, stats);
  }
}

/**
 * シンプルニューラルネットワーク
 */
class SimpleNeuralNetwork {
  constructor() {
    this.weights = null;
    this.biases = null;
    this.architecture = [13, 8, 5, 1]; // 入力層、隠れ層x2、出力層
  }

  async predict(features) {
    if (!this.weights) {
      return { adjustment: 0, confidence: 0.1, reasoning: 'not_trained' };
    }

    try {
      const input = this.featuresToVector(features.normalized);
      const output = this.forwardPass(input);
      
      return {
        adjustment: Math.tanh(output[0]), // -1 to 1の範囲に正規化
        confidence: 0.8,
        reasoning: 'neural_network_prediction'
      };
    } catch (error) {
      return { adjustment: 0, confidence: 0, reasoning: 'prediction_error' };
    }
  }

  async train(trainingData) {
    // 簡易的な勾配降下法実装
    // 実際の実装では、より高度な最適化手法を使用
    console.log('[NN] 訓練開始');
  }

  featuresToVector(features) {
    // 特徴量をベクトルに変換
    return Object.values(features).slice(0, this.architecture[0]);
  }

  forwardPass(input) {
    // 前向き伝播の簡易実装
    return [0]; // プレースホルダー
  }
}

/**
 * シンプル決定木
 */
class SimpleDecisionTree {
  constructor() {
    this.tree = null;
    this.maxDepth = 5;
  }

  async predict(features) {
    if (!this.tree) {
      return { adjustment: 0, confidence: 0.1, reasoning: 'not_trained' };
    }

    try {
      const adjustment = this.traverseTree(features.normalized, this.tree);
      return {
        adjustment,
        confidence: 0.7,
        reasoning: 'decision_tree_path'
      };
    } catch (error) {
      return { adjustment: 0, confidence: 0, reasoning: 'tree_error' };
    }
  }

  async train(trainingData) {
    console.log('[DecisionTree] 訓練開始');
    // 決定木構築ロジック
  }

  traverseTree(features, node) {
    // 決定木探索ロジック
    return 0; // プレースホルダー
  }
}

/**
 * 重み付き線形回帰
 */
class WeightedLinearRegression {
  constructor() {
    this.coefficients = null;
    this.intercept = 0;
  }

  async predict(features) {
    if (!this.coefficients) {
      return { adjustment: 0, confidence: 0.1, reasoning: 'not_trained' };
    }

    try {
      const featureVector = Object.values(features.normalized);
      let prediction = this.intercept;
      
      for (let i = 0; i < featureVector.length && i < this.coefficients.length; i++) {
        prediction += featureVector[i] * this.coefficients[i];
      }
      
      return {
        adjustment: Math.tanh(prediction), // 正規化
        confidence: 0.6,
        reasoning: 'linear_regression'
      };
    } catch (error) {
      return { adjustment: 0, confidence: 0, reasoning: 'regression_error' };
    }
  }

  async train(trainingData) {
    console.log('[LinearRegression] 訓練開始');
    // 最小二乗法実装
  }
}

/**
 * 適応ルールエンジン
 */
class AdaptiveRuleEngine {
  constructor() {
    this.rules = new Map();
    this.ruleWeights = new Map();
  }

  async predict(features) {
    try {
      let totalWeight = 0;
      let weightedAdjustment = 0;
      
      for (const [ruleId, rule] of this.rules) {
        const weight = this.ruleWeights.get(ruleId) || 0.1;
        const activation = this.evaluateRule(rule, features.normalized);
        
        totalWeight += weight * activation.strength;
        weightedAdjustment += activation.adjustment * weight * activation.strength;
      }
      
      const finalAdjustment = totalWeight > 0 ? weightedAdjustment / totalWeight : 0;
      
      return {
        adjustment: finalAdjustment,
        confidence: Math.min(totalWeight, 1),
        reasoning: 'adaptive_rules'
      };
    } catch (error) {
      return { adjustment: 0, confidence: 0, reasoning: 'rule_error' };
    }
  }

  async train(trainingData) {
    console.log('[AdaptiveRules] ルール更新開始');
    // ルール重み調整ロジック
  }

  evaluateRule(rule, features) {
    // ルール評価ロジック
    return { strength: 0.5, adjustment: 0 };
  }
}

module.exports = { MLUrgencyPredictor };