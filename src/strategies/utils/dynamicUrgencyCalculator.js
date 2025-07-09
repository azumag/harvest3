/**
 * 動的Urgency計算エンジン
 * 市場状況・ポートフォリオ・戦略パフォーマンスに基づくurgency調整
 */

const { VolatilityAnalyzer } = require('./volatilityAnalyzer');
const { PortfolioRiskAnalyzer } = require('./portfolioRiskAnalyzer');
const { TimezoneAnalyzer } = require('./timezoneAnalyzer');
const { PerformanceAnalyzer } = require('./performanceAnalyzer');
const { fetchOHLCVData } = require('../../database/manager');

// Urgencyレベルの定義
const URGENCY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

class DynamicUrgencyCalculator {
  constructor(config = {}) {
    this.enabled = config.enabled !== false; // デフォルトで有効

    // 重み設定
    this.weights = {
      volatility: config.weights?.volatility || 0.3,
      portfolioRisk: config.weights?.portfolioRisk || 0.25,
      timezone: config.weights?.timezone || 0.2,
      performance: config.weights?.performance || 0.25
    };

    // 調整範囲制限
    this.adjustmentLimits = {
      min: config.adjustmentLimits?.min || -0.5,  // 最大50%ダウン調整
      max: config.adjustmentLimits?.max || 0.8    // 最大80%アップ調整
    };

    // 各分析モジュールの初期化
    this.volatilityAnalyzer = new VolatilityAnalyzer(config.volatility || {});
    this.portfolioRiskAnalyzer = new PortfolioRiskAnalyzer(config.portfolioRisk || {});
    this.timezoneAnalyzer = new TimezoneAnalyzer(config.timezone || {});
    this.performanceAnalyzer = new PerformanceAnalyzer(config.performance || {});

    // キャッシュ設定
    this.cacheTimeout = config.cacheDuration || 60000; // 1分間キャッシュ
    this.cache = new Map();

    console.log('[DynamicUrgencyCalculator] 初期化完了:', this.enabled ? '有効' : '無効');
  }

  /**
   * 動的urgency調整を計算
   * @param {string} symbol - 通貨ペア
   * @param {string} baseUrgency - ベースのurgency
   * @param {Object} context - コンテキスト情報
   * @returns {Promise<string>} 調整されたurgency
   */
  async calculateDynamicUrgency(symbol, baseUrgency, context = {}) {
    if (!this.enabled) {
      return baseUrgency; // 無効時はベース値をそのまま返す
    }

    const cacheKey = `urgency_${symbol}_${baseUrgency}_${context.strategyName || 'unknown'}_${Math.floor(Date.now() / this.cacheTimeout)}`;

    // キャッシュチェック
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      console.log(`[DynamicUrgency] キャッシュヒット: ${symbol} ${cached.final}`);
      return cached.final;
    }

    try {
      const startTime = Date.now();

      // 各要素の並列計算
      const [
        volatilityFactor,
        portfolioRiskFactor,
        timezoneFactor,
        performanceFactor
      ] = await Promise.all([
        this.calculateVolatilityFactor(symbol, context),
        this.calculatePortfolioRiskFactor(context),
        this.calculateTimezoneFactor(),
        this.calculatePerformanceFactor(context)
      ]);

      // 要素をまとめる
      const factors = {
        volatility: volatilityFactor,
        portfolioRisk: portfolioRiskFactor,
        timezone: timezoneFactor,
        performance: performanceFactor
      };

      // 重み付き統合
      const adjustmentFactor = this.combineFactors(factors);

      // 最終urgency決定
      const finalUrgency = this.applyAdjustment(baseUrgency, adjustmentFactor);

      const calculationTime = Date.now() - startTime;

      // 結果をキャッシュ
      const result = {
        base: baseUrgency,
        factors,
        adjustmentFactor,
        final: finalUrgency,
        calculationTime
      };

      this.cache.set(cacheKey, result);

      // ログ出力
      console.log(`[DynamicUrgency] ${symbol}: ${baseUrgency} → ${finalUrgency} (調整=${adjustmentFactor.toFixed(3)}, ${calculationTime}ms)`);
      console.log(`  要素: vol=${volatilityFactor.toFixed(3)}, risk=${portfolioRiskFactor.toFixed(3)}, time=${timezoneFactor.toFixed(3)}, perf=${performanceFactor.toFixed(3)}`);

      return finalUrgency;

    } catch (error) {
      console.error(`[DynamicUrgency] 計算エラー: ${symbol} - ${error.message}`);
      return baseUrgency; // エラー時はベース値を返す
    }
  }

  /**
   * ボラティリティ要素を計算
   * @param {string} symbol - 通貨ペア
   * @param {Object} context - コンテキスト
   * @returns {Promise<number>} ボラティリティ調整係数
   */
  async calculateVolatilityFactor(symbol, context) {
    try {
      // OHLCVデータを取得（50期間）
      const ohlcvData = await fetchOHLCVData(
        context.exchange || null,
        symbol,
        '1h', // 1時間足
        50,
        { backtest: false }
      );

      if (!ohlcvData || ohlcvData.length < 20) {
        console.warn(`[DynamicUrgency] OHLCV不足: ${symbol}`);
        return 0; // 中立
      }

      // ボラティリティスコアを計算（0-1）
      const volatilityScore = await this.volatilityAnalyzer.calculateVolatilityScore(symbol, ohlcvData);

      // スコアを調整係数に変換
      if (volatilityScore > 0.8) {
        return 0.5;  // 高ボラティリティ：積極的
      } else if (volatilityScore > 0.6) {
        return 0.2;  // やや高ボラティリティ：やや積極的
      } else if (volatilityScore < 0.2) {
        return -0.3; // 低ボラティリティ：慎重
      } else if (volatilityScore < 0.4) {
        return -0.1; // やや低ボラティリティ：やや慎重
      } else {
        return 0;    // 中程度：中立
      }

    } catch (error) {
      console.error(`[DynamicUrgency] ボラティリティ計算エラー: ${symbol} - ${error.message}`);
      return 0;
    }
  }

  /**
   * ポートフォリオリスク要素を計算
   * @param {Object} context - コンテキスト
   * @returns {Promise<number>} リスク調整係数
   */
  async calculatePortfolioRiskFactor(context) {
    try {
      const exchange = context.exchange?.id || 'bitbank';
      return await this.portfolioRiskAnalyzer.calculateRiskAdjustment(exchange);
    } catch (error) {
      console.error(`[DynamicUrgency] ポートフォリオリスク計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * 時間帯要素を計算
   * @returns {number} 時間帯調整係数
   */
  calculateTimezoneFactor() {
    try {
      return this.timezoneAnalyzer.calculateTimezoneAdjustment();
    } catch (error) {
      console.error(`[DynamicUrgency] 時間帯計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * パフォーマンス要素を計算
   * @param {Object} context - コンテキスト
   * @returns {Promise<number>} パフォーマンス調整係数
   */
  async calculatePerformanceFactor(context) {
    try {
      if (!context.strategyName) {
        return 0; // 戦略名がない場合は中立
      }

      const exchange = context.exchange?.id || 'bitbank';
      const performance = await this.performanceAnalyzer.getStrategyPerformance(context.strategyName, exchange);

      return this.performanceAnalyzer.calculatePerformanceAdjustment(performance);
    } catch (error) {
      console.error(`[DynamicUrgency] パフォーマンス計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * 各要素を重み付きで統合
   * @param {Object} factors - 要素別調整係数
   * @returns {number} 統合された調整係数
   */
  combineFactors(factors) {
    try {
      let weightedSum = 0;
      let totalWeight = 0;

      for (const [factorName, value] of Object.entries(factors)) {
        if (this.weights[factorName] && typeof value === 'number' && !isNaN(value)) {
          weightedSum += value * this.weights[factorName];
          totalWeight += this.weights[factorName];
        }
      }

      const combinedFactor = totalWeight > 0 ? weightedSum / totalWeight : 0;

      // 調整範囲制限を適用
      return Math.max(this.adjustmentLimits.min, Math.min(this.adjustmentLimits.max, combinedFactor));

    } catch (error) {
      console.error(`[DynamicUrgency] 要素統合エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * ベースurgencyに調整を適用
   * @param {string} baseUrgency - ベースのurgency
   * @param {number} adjustmentFactor - 調整係数
   * @returns {string} 調整されたurgency
   */
  applyAdjustment(baseUrgency, adjustmentFactor) {
    try {
      // 現在のurgencyを数値にマッピング
      const urgencyToNumber = {
        [URGENCY_LEVELS.LOW]: 0,
        [URGENCY_LEVELS.MEDIUM]: 1,
        [URGENCY_LEVELS.HIGH]: 2
      };

      const numberToUrgency = {
        0: URGENCY_LEVELS.LOW,
        1: URGENCY_LEVELS.MEDIUM,
        2: URGENCY_LEVELS.HIGH
      };

      const currentLevel = urgencyToNumber[baseUrgency] ?? 1; // デフォルトMEDIUM

      // 調整係数を適用
      let adjustedLevel = currentLevel;

      if (adjustmentFactor > 0.3) {
        // 大きな積極調整: 1レベル上げる
        adjustedLevel = Math.min(2, currentLevel + 1);
      } else if (adjustmentFactor > 0.1) {
        // 小さな積極調整: MEDIUMより上にのみ適用
        if (currentLevel === 0) {
          adjustedLevel = 1;
        }
      } else if (adjustmentFactor < -0.3) {
        // 大きな慎重調整: 1レベル下げる
        adjustedLevel = Math.max(0, currentLevel - 1);
      } else if (adjustmentFactor < -0.1) {
        // 小さな慎重調整: MEDIUMより下にのみ適用
        if (currentLevel === 2) {
          adjustedLevel = 1;
        }
      }

      return numberToUrgency[adjustedLevel] || baseUrgency;

    } catch (error) {
      console.error(`[DynamicUrgency] 調整適用エラー: ${error.message}`);
      return baseUrgency;
    }
  }

  /**
   * 総合分析レポートを生成
   * @param {string} symbol - 通貨ペア
   * @param {string} baseUrgency - ベースのurgency
   * @param {Object} context - コンテキスト
   * @returns {Promise<Object>} 分析レポート
   */
  async generateReport(symbol, baseUrgency, context = {}) {
    try {
      const [
        volatilityReport,
        portfolioReport,
        timezoneReport,
        performanceReport
      ] = await Promise.all([
        this.volatilityAnalyzer.calculateVolatilityScore(symbol, []).then(score => ({ score })),
        this.portfolioRiskAnalyzer.generateRiskReport(context.exchange?.id || 'bitbank'),
        this.timezoneAnalyzer.generateTimezoneReport(),
        context.strategyName ? this.performanceAnalyzer.generatePerformanceReport(context.strategyName, context.exchange?.id || 'bitbank') : null
      ]);

      const finalUrgency = await this.calculateDynamicUrgency(symbol, baseUrgency, context);

      return {
        symbol,
        baseUrgency,
        finalUrgency,
        enabled: this.enabled,
        analysis: {
          volatility: volatilityReport,
          portfolio: portfolioReport,
          timezone: timezoneReport,
          performance: performanceReport
        },
        weights: this.weights,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`[DynamicUrgency] レポート生成エラー: ${symbol} - ${error.message}`);
      return null;
    }
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.cache.clear();
    this.volatilityAnalyzer.clearCache();
    this.portfolioRiskAnalyzer.clearCache();
    this.timezoneAnalyzer.clearCache();
    this.performanceAnalyzer.clearCache();
  }
}

module.exports = { DynamicUrgencyCalculator, URGENCY_LEVELS };