/**
 * 戦略実行基盤の共通化ライブラリ
 * 全戦略に共通する処理と基底クラスを提供
 */

const { 
  determineSignalType, 
  formatStrategyLogInfo, 
  handleStrategyError, 
  validateStrategyParams,
  validateOHLCVData,
  safeNumberConversion,
  safeArrayGet,
  executeWithRetry 
} = require('./utils');

const { 
  generateRedisKey, 
  safeRedisOperation,
  validateAndSanitizeData 
} = require('./database');

/**
 * 戦略基底クラス
 * 全戦略で共通する機能を提供
 */
class BaseStrategy {
  constructor(strategyName, exchange, symbol) {
    this.strategyName = strategyName;
    this.exchange = exchange;
    this.symbol = symbol;
    this.lastExecutionTime = null;
    this.executionCount = 0;
    this.errorCount = 0;
  }

  /**
   * 戦略実行のメインテンプレートメソッド
   * @param {Object} params - 戦略パラメータ
   * @param {Array} ohlcvData - OHLCV データ
   * @param {Object} additionalData - 追加データ
   * @returns {Promise<Object>} 実行結果
   */
  async execute(params, ohlcvData, additionalData = {}) {
    const startTime = Date.now();
    this.executionCount++;

    try {
      // 前処理：パラメータとデータの検証
      await this.preExecute(params, ohlcvData);
      
      // メイン処理：各戦略で実装される
      const result = await this.doExecute(params, ohlcvData, additionalData);
      
      // 後処理：結果の標準化とログ出力
      const standardizedResult = await this.postExecute(result, startTime);
      
      this.lastExecutionTime = Date.now();
      return standardizedResult;
      
    } catch (error) {
      this.errorCount++;
      await this.handleExecutionError(error);
      throw error;
    }
  }

  /**
   * 前処理：検証とセットアップ
   * @param {Object} params - 戦略パラメータ
   * @param {Array} ohlcvData - OHLCV データ
   */
  async preExecute(params, ohlcvData) {
    // パラメータ検証
    const requiredParams = this.getRequiredParams();
    validateStrategyParams(params, requiredParams, this.strategyName);
    
    // データ検証
    const minDataLength = this.getMinDataLength();
    validateOHLCVData(ohlcvData, minDataLength, this.strategyName);
  }

  /**
   * メイン処理：サブクラスで実装される抽象メソッド
   * @param {Object} params - 戦略パラメータ
   * @param {Array} ohlcvData - OHLCV データ
   * @param {Object} additionalData - 追加データ
   * @returns {Promise<Object>} 実行結果
   */
  async doExecute(params, ohlcvData, additionalData) {
    throw new Error('doExecute メソッドは子クラスで実装してください');
  }

  /**
   * 後処理：結果の標準化
   * @param {Object} result - 実行結果
   * @param {number} startTime - 開始時刻
   * @returns {Promise<Object>} 標準化された結果
   */
  async postExecute(result, startTime) {
    const executionTime = Date.now() - startTime;
    
    return {
      ...result,
      strategy: this.strategyName,
      exchange: this.exchange,
      symbol: this.symbol,
      timestamp: new Date().toISOString(),
      executionTime,
      executionCount: this.executionCount
    };
  }

  /**
   * エラーハンドリング
   * @param {Error} error - 発生したエラー
   */
  async handleExecutionError(error) {
    await handleStrategyError(error, this.strategyName, this.exchange, this.symbol, false);
  }

  /**
   * 必須パラメータの定義：サブクラスで実装
   * @returns {Array<string>} 必須パラメータ名の配列
   */
  getRequiredParams() {
    return [];
  }

  /**
   * 最小データ長の定義：サブクラスで実装
   * @returns {number} 必要な最小データ数
   */
  getMinDataLength() {
    return 1;
  }

  /**
   * 戦略の統計情報を取得
   * @returns {Object} 統計情報
   */
  getStats() {
    return {
      strategyName: this.strategyName,
      exchange: this.exchange,
      symbol: this.symbol,
      executionCount: this.executionCount,
      errorCount: this.errorCount,
      errorRate: this.executionCount > 0 ? (this.errorCount / this.executionCount) : 0,
      lastExecutionTime: this.lastExecutionTime
    };
  }
}

/**
 * シグナル生成の共通処理
 * @param {boolean} buyCondition - 買いシグナル条件
 * @param {boolean} sellCondition - 売りシグナル条件
 * @param {Object} signalData - シグナル関連データ
 * @returns {Object} 標準化されたシグナル結果
 */
function generateSignalResult(buyCondition, sellCondition, signalData = {}) {
  const signalType = determineSignalType(buyCondition, sellCondition);
  
  return {
    signal: signalType,
    hasBuySignal: buyCondition,
    hasSellSignal: sellCondition,
    confidence: signalData.confidence || 0.5,
    metadata: signalData.metadata || {},
    timestamp: new Date().toISOString()
  };
}

/**
 * テクニカル指標計算の共通インターフェース
 */
class IndicatorCalculator {
  /**
   * 単純移動平均 (SMA) の計算
   * @param {Array} prices - 価格配列
   * @param {number} period - 期間
   * @returns {Array} SMA値の配列
   */
  static calculateSMA(prices, period) {
    if (!Array.isArray(prices) || prices.length < period) {
      return [];
    }
    
    const sma = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val, 0);
      sma.push(sum / period);
    }
    return sma;
  }

  /**
   * 指数移動平均 (EMA) の計算
   * @param {Array} prices - 価格配列
   * @param {number} period - 期間
   * @returns {Array} EMA値の配列
   */
  static calculateEMA(prices, period) {
    if (!Array.isArray(prices) || prices.length === 0) {
      return [];
    }
    
    const multiplier = 2 / (period + 1);
    const ema = [prices[0]]; // 最初の値はそのまま使用
    
    for (let i = 1; i < prices.length; i++) {
      const emaValue = (prices[i] * multiplier) + (ema[i - 1] * (1 - multiplier));
      ema.push(emaValue);
    }
    
    return ema;
  }

  /**
   * RSI の計算
   * @param {Array} prices - 価格配列
   * @param {number} period - 期間（デフォルト14）
   * @returns {Array} RSI値の配列
   */
  static calculateRSI(prices, period = 14) {
    if (!Array.isArray(prices) || prices.length < period + 1) {
      return [];
    }
    
    const gains = [];
    const losses = [];
    
    // 価格変動の計算
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    // 最初のRSI計算
    let avgGain = gains.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    
    const rsi = [];
    
    for (let i = period; i < gains.length; i++) {
      if (avgLoss === 0) {
        rsi.push(100);
      } else {
        const rs = avgGain / avgLoss;
        rsi.push(100 - (100 / (1 + rs)));
      }
      
      // 次のイテレーションのための平均更新
      avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    }
    
    return rsi;
  }

  /**
   * ボリンジャーバンドの計算
   * @param {Array} prices - 価格配列
   * @param {number} period - 期間
   * @param {number} stdDev - 標準偏差の倍数
   * @returns {Object} { middle, upper, lower } の配列
   */
  static calculateBollingerBands(prices, period = 20, stdDev = 2) {
    const sma = this.calculateSMA(prices, period);
    const bands = { middle: [], upper: [], lower: [] };
    
    for (let i = 0; i < sma.length; i++) {
      const dataIndex = i + period - 1;
      const subset = prices.slice(dataIndex - period + 1, dataIndex + 1);
      
      // 標準偏差の計算
      const mean = sma[i];
      const variance = subset.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      const standardDeviation = Math.sqrt(variance);
      
      bands.middle.push(mean);
      bands.upper.push(mean + (standardDeviation * stdDev));
      bands.lower.push(mean - (standardDeviation * stdDev));
    }
    
    return bands;
  }
}

/**
 * 戦略パラメータの管理
 */
class StrategyParameterManager {
  constructor(manager, exchange, symbol) {
    this.manager = manager;
    this.exchange = exchange;
    this.symbol = symbol;
  }

  /**
   * パラメータの取得
   * @param {string} strategyKey - 戦略キー
   * @param {Object} defaults - デフォルト値
   * @returns {Promise<Object>} パラメータオブジェクト
   */
  async getParameters(strategyKey, defaults = {}) {
    try {
      const params = await this.manager.getStrategyParameters(this.exchange, this.symbol, strategyKey);
      return { ...defaults, ...params };
    } catch (error) {
      await handleStrategyError(error, '戦略パラメータ取得', this.exchange, this.symbol, false);
      return defaults;
    }
  }

  /**
   * パラメータの保存
   * @param {string} strategyKey - 戦略キー
   * @param {Object} params - 保存するパラメータ
   * @returns {Promise<boolean>} 成功/失敗
   */
  async saveParameters(strategyKey, params) {
    try {
      await this.manager.saveStrategyParameters(this.exchange, this.symbol, strategyKey, params);
      return true;
    } catch (error) {
      await handleStrategyError(error, '戦略パラメータ保存', this.exchange, this.symbol, false);
      return false;
    }
  }

  /**
   * パラメータの検証と正規化
   * @param {Object} params - 検証対象パラメータ
   * @param {Object} schema - 検証スキーマ
   * @returns {Object} 正規化されたパラメータ
   */
  validateParameters(params, schema) {
    return validateAndSanitizeData(params, schema, `${this.exchange}-${this.symbol}`);
  }
}

/**
 * 戦略の実行統計を追跡するクラス
 */
class StrategyMetrics {
  constructor() {
    this.metrics = new Map();
  }

  /**
   * 実行メトリクスの記録
   * @param {string} strategyId - 戦略ID
   * @param {Object} result - 実行結果
   */
  recordExecution(strategyId, result) {
    if (!this.metrics.has(strategyId)) {
      this.metrics.set(strategyId, {
        totalExecutions: 0,
        successCount: 0,
        errorCount: 0,
        totalExecutionTime: 0,
        lastExecution: null,
        signals: { buy: 0, sell: 0, none: 0 }
      });
    }

    const metric = this.metrics.get(strategyId);
    metric.totalExecutions++;
    metric.lastExecution = new Date().toISOString();

    if (result.error) {
      metric.errorCount++;
    } else {
      metric.successCount++;
      if (result.executionTime) {
        metric.totalExecutionTime += result.executionTime;
      }
      if (result.signal) {
        metric.signals[result.signal] = (metric.signals[result.signal] || 0) + 1;
      }
    }
  }

  /**
   * 戦略のメトリクス取得
   * @param {string} strategyId - 戦略ID
   * @returns {Object} メトリクス情報
   */
  getMetrics(strategyId) {
    const metric = this.metrics.get(strategyId);
    if (!metric) {
      return null;
    }

    return {
      ...metric,
      successRate: metric.totalExecutions > 0 ? metric.successCount / metric.totalExecutions : 0,
      averageExecutionTime: metric.successCount > 0 ? metric.totalExecutionTime / metric.successCount : 0
    };
  }

  /**
   * 全戦略のメトリクス取得
   * @returns {Object} 全戦略のメトリクス
   */
  getAllMetrics() {
    const result = {};
    for (const [strategyId, metric] of this.metrics) {
      result[strategyId] = this.getMetrics(strategyId);
    }
    return result;
  }
}

// シングルトンインスタンス
const strategyMetrics = new StrategyMetrics();

module.exports = {
  BaseStrategy,
  generateSignalResult,
  IndicatorCalculator,
  StrategyParameterManager,
  StrategyMetrics,
  strategyMetrics
};