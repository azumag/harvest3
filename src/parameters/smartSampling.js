/**
 * スマートサンプリングシステム
 * 効率的なパラメータ空間探索のための高度なサンプリング手法
 */

const { ParameterConstraintEngine } = require('./constraintManager');

/**
 * スマートサンプリングエンジン
 */
class SmartSamplingEngine {
  constructor() {
    this.constraintEngine = new ParameterConstraintEngine();
  }

  /**
   * ラテン超方体サンプリング（Latin Hypercube Sampling）
   * @param {string} strategyType 戦略タイプ
   * @param {number} count サンプル数
   * @param {Object} options サンプリングオプション
   * @returns {Array} サンプル配列
   */
  latinHypercubeSampling(strategyType, count = 50, options = {}) {
    const constraint = this.constraintEngine.getStrategyConstraints(strategyType);
    if (!constraint) {
      return [];
    }

    const paramNames = Object.keys(constraint.parameters);
    const dimensions = paramNames.length;
    
    if (dimensions === 0) {
      return [];
    }

    // 各次元のサンプリング位置を生成
    const samplingPositions = this.generateLatinHypercube(count, dimensions);
    const samples = [];

    for (let i = 0; i < count; i++) {
      const sample = {};
      
      for (let j = 0; j < dimensions; j++) {
        const paramName = paramNames[j];
        const paramConfig = constraint.parameters[paramName];
        const position = samplingPositions[i][j];
        
        // 位置を実際のパラメータ値に変換
        let value;
        if (paramConfig.type === 'integer') {
          value = Math.floor(
            paramConfig.min + position * (paramConfig.max - paramConfig.min + 1)
          );
          value = Math.min(paramConfig.max, Math.max(paramConfig.min, value));
        } else {
          value = paramConfig.min + position * (paramConfig.max - paramConfig.min);
          if (paramConfig.step) {
            value = Math.round(value / paramConfig.step) * paramConfig.step;
          }
          value = Number(value.toFixed(2));
        }
        
        sample[paramName] = value;
      }

      // 制約チェック
      if (this.constraintEngine.validateCombination(sample, strategyType)) {
        samples.push(sample);
      }
    }

    return samples;
  }

  /**
   * ラテン超方体の位置を生成
   * @param {number} count サンプル数
   * @param {number} dimensions 次元数
   * @returns {Array} サンプリング位置配列
   */
  generateLatinHypercube(count, dimensions) {
    const positions = [];

    // 各次元でランダムな順列を生成
    const permutations = [];
    for (let d = 0; d < dimensions; d++) {
      const perm = [];
      for (let i = 0; i < count; i++) {
        perm.push(i);
      }
      this.shuffleArray(perm);
      permutations.push(perm);
    }

    // サンプリング位置を生成
    for (let i = 0; i < count; i++) {
      const position = [];
      for (let d = 0; d < dimensions; d++) {
        // [0,1]区間内での均等分布
        const stratumPosition = (permutations[d][i] + Math.random()) / count;
        position.push(stratumPosition);
      }
      positions.push(position);
    }

    return positions;
  }

  /**
   * 配列をシャッフル（Fisher-Yates アルゴリズム）
   * @param {Array} array シャッフル対象配列
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * 適応的グリッドサンプリング
   * @param {string} strategyType 戦略タイプ
   * @param {Array} promisingRegions 有望な領域
   * @param {number} count サンプル数
   * @returns {Array} サンプル配列
   */
  adaptiveGridSampling(strategyType, promisingRegions = [], count = 50) {
    const constraint = this.constraintEngine.getStrategyConstraints(strategyType);
    if (!constraint) {
      return [];
    }

    const samples = [];
    const focusRatio = 0.6; // 有望な領域への集中度
    const focusCount = Math.floor(count * focusRatio);
    const explorationCount = count - focusCount;

    // 有望な領域でのグリッドサンプリング
    if (promisingRegions.length > 0) {
      const focusSamples = this.generateFocusedGridSamples(
        strategyType, 
        promisingRegions, 
        focusCount
      );
      samples.push(...focusSamples);
    }

    // 全体でのランダムサンプリング（探索用）
    const explorationSamples = this.constraintEngine.generateValidCombinations(
      strategyType, 
      explorationCount
    );
    samples.push(...explorationSamples);

    return samples.slice(0, count);
  }

  /**
   * 有望な領域に焦点を当てたグリッドサンプリング
   * @param {string} strategyType 戦略タイプ
   * @param {Array} promisingRegions 有望な領域
   * @param {number} count サンプル数
   * @returns {Array} サンプル配列
   */
  generateFocusedGridSamples(strategyType, promisingRegions, count) {
    const constraint = this.constraintEngine.getStrategyConstraints(strategyType);
    const samples = [];
    
    const regionsPerSample = Math.ceil(count / promisingRegions.length);

    for (const region of promisingRegions) {
      const paramConfig = constraint.parameters[region.parameter];
      if (!paramConfig) {continue;}

      // 有望な領域での細かいグリッド生成
      const regionSamples = this.generateRegionGrid(
        region, 
        paramConfig, 
        regionsPerSample
      );

      for (const regionSample of regionSamples) {
        // 他のパラメータはランダムに設定
        const fullSample = this.constraintEngine.generateCandidate(constraint.parameters);
        fullSample[region.parameter] = regionSample;

        if (this.constraintEngine.validateCombination(fullSample, strategyType)) {
          samples.push(fullSample);
        }
      }
    }

    return samples;
  }

  /**
   * 領域内のグリッドを生成
   * @param {Object} region 領域定義
   * @param {Object} paramConfig パラメータ設定
   * @param {number} count グリッド数
   * @returns {Array} グリッド値配列
   */
  generateRegionGrid(region, paramConfig, count) {
    const gridValues = [];
    const radius = Math.min(region.radius, (paramConfig.max - paramConfig.min) / 4);
    
    const start = Math.max(paramConfig.min, region.center - radius);
    const end = Math.min(paramConfig.max, region.center + radius);
    
    if (paramConfig.type === 'integer') {
      const step = Math.max(1, Math.floor((end - start) / count));
      for (let value = start; value <= end; value += step) {
        gridValues.push(Math.round(value));
      }
    } else {
      const step = (end - start) / count;
      for (let i = 0; i < count; i++) {
        const value = start + i * step;
        gridValues.push(Number(value.toFixed(2)));
      }
    }

    return gridValues;
  }

  /**
   * 多様性を考慮したサンプリング
   * @param {string} strategyType 戦略タイプ
   * @param {number} count サンプル数
   * @param {number} minDistance 最小距離
   * @returns {Array} サンプル配列
   */
  diversityBasedSampling(strategyType, count = 50, minDistance = 0.1) {
    const constraint = this.constraintEngine.getStrategyConstraints(strategyType);
    if (!constraint) {
      return [];
    }

    const samples = [];
    const maxAttempts = count * 50;
    let attempts = 0;

    while (samples.length < count && attempts < maxAttempts) {
      const candidate = this.constraintEngine.generateCandidate(constraint.parameters);
      
      if (!this.constraintEngine.validateCombination(candidate, strategyType)) {
        attempts++;
        continue;
      }

      // 既存サンプルとの最小距離をチェック
      if (this.checkMinimumDistance(candidate, samples, constraint.parameters, minDistance)) {
        samples.push(candidate);
      }
      
      attempts++;
    }

    return samples;
  }

  /**
   * 最小距離条件をチェック
   * @param {Object} candidate 候補サンプル
   * @param {Array} existingSamples 既存サンプル
   * @param {Object} paramDefs パラメータ定義
   * @param {number} minDistance 最小距離
   * @returns {boolean} 距離条件を満たすかどうか
   */
  checkMinimumDistance(candidate, existingSamples, paramDefs, minDistance) {
    if (existingSamples.length === 0) {
      return true;
    }

    for (const existing of existingSamples) {
      const distance = this.calculateNormalizedDistance(candidate, existing, paramDefs);
      if (distance < minDistance) {
        return false;
      }
    }

    return true;
  }

  /**
   * 正規化されたユークリッド距離を計算
   * @param {Object} sample1 サンプル1
   * @param {Object} sample2 サンプル2
   * @param {Object} paramDefs パラメータ定義
   * @returns {number} 正規化距離
   */
  calculateNormalizedDistance(sample1, sample2, paramDefs) {
    let sumSquaredDiff = 0;
    let dimensionCount = 0;

    for (const [paramName, paramConfig] of Object.entries(paramDefs)) {
      const val1 = sample1[paramName];
      const val2 = sample2[paramName];
      
      if (val1 !== undefined && val2 !== undefined) {
        const range = paramConfig.max - paramConfig.min;
        const normalizedDiff = (val1 - val2) / range;
        sumSquaredDiff += normalizedDiff * normalizedDiff;
        dimensionCount++;
      }
    }

    return dimensionCount > 0 ? Math.sqrt(sumSquaredDiff / dimensionCount) : 0;
  }

  /**
   * ハイブリッドサンプリング
   * 複数の手法を組み合わせて最適なサンプリングを実行
   * @param {string} strategyType 戦略タイプ
   * @param {number} count サンプル数
   * @param {Object} options サンプリングオプション
   * @returns {Array} サンプル配列
   */
  hybridSampling(strategyType, count = 50, options = {}) {
    const {
      latinHypercubeRatio = 0.4,
      diversityRatio = 0.3,
      randomRatio = 0.3,
      promisingRegions = []
    } = options;

    const samples = [];
    
    // ラテン超方体サンプリング
    const lhsCount = Math.floor(count * latinHypercubeRatio);
    const lhsSamples = this.latinHypercubeSampling(strategyType, lhsCount);
    samples.push(...lhsSamples);

    // 多様性ベースサンプリング
    const diversityCount = Math.floor(count * diversityRatio);
    const diversitySamples = this.diversityBasedSampling(
      strategyType, 
      diversityCount, 
      0.15
    );
    samples.push(...diversitySamples);

    // 適応的グリッドサンプリング（ランダム部分を含む）
    const remainingCount = count - samples.length;
    const adaptiveSamples = this.adaptiveGridSampling(
      strategyType, 
      promisingRegions, 
      remainingCount
    );
    samples.push(...adaptiveSamples);

    // 重複除去とシャッフル
    const uniqueSamples = this.removeDuplicates(samples);
    this.shuffleArray(uniqueSamples);

    return uniqueSamples.slice(0, count);
  }

  /**
   * 重複サンプルを除去
   * @param {Array} samples サンプル配列
   * @returns {Array} 重複除去後のサンプル配列
   */
  removeDuplicates(samples) {
    const unique = [];
    const seen = new Set();

    for (const sample of samples) {
      const key = JSON.stringify(sample);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(sample);
      }
    }

    return unique;
  }

  /**
   * サンプリング品質を評価
   * @param {Array} samples サンプル配列
   * @param {string} strategyType 戦略タイプ
   * @returns {Object} 品質指標
   */
  evaluateSamplingQuality(samples, strategyType) {
    const constraint = this.constraintEngine.getStrategyConstraints(strategyType);
    if (!constraint || samples.length === 0) {
      return {
        coverage: 0,
        diversity: 0,
        uniformity: 0,
        validity: 0
      };
    }

    const quality = this.constraintEngine.calculateParameterQuality(samples, strategyType);
    const uniformity = this.calculateUniformity(samples, constraint.parameters);

    return {
      ...quality,
      uniformity
    };
  }

  /**
   * サンプルの均一性を計算
   * @param {Array} samples サンプル配列
   * @param {Object} paramDefs パラメータ定義
   * @returns {number} 均一性スコア (0-1)
   */
  calculateUniformity(samples, paramDefs) {
    if (samples.length < 2) {
      return 1;
    }

    const distances = [];
    
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const distance = this.calculateNormalizedDistance(
          samples[i], 
          samples[j], 
          paramDefs
        );
        distances.push(distance);
      }
    }

    if (distances.length === 0) {
      return 1;
    }

    // 距離の分散が小さいほど均一
    const meanDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const variance = distances.reduce((sum, d) => sum + Math.pow(d - meanDistance, 2), 0) / distances.length;
    
    // 正規化された均一性スコア
    return Math.max(0, 1 - variance / meanDistance);
  }
}

module.exports = {
  SmartSamplingEngine
};