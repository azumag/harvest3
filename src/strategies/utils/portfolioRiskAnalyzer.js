/**
 * ポートフォリオリスク分析モジュール
 * 動的urgency調整システムの構成要素
 */

const { getStrategyPositionsRedis, getTradeSummary } = require('../../database/redisDatabase');

class PortfolioRiskAnalyzer {
  constructor(options = {}) {
    this.maxDrawdownThreshold = options.maxDrawdownThreshold || 0.15; // 15%
    this.concentrationThreshold = options.concentrationThreshold || 0.3; // 30%
    this.cacheTimeout = options.cacheTimeout || 30000; // 30秒キャッシュ
    this.cache = new Map();
  }

  /**
   * 現在のドローダウン率を計算
   * @param {string} exchange - 取引所ID
   * @returns {Promise<number>} ドローダウン率（0-1）
   */
  async getCurrentDrawdown(exchange = 'bitbank') {
    const cacheKey = `drawdown_${exchange}_${Math.floor(Date.now() / this.cacheTimeout)}`;
    
    // キャッシュチェック
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // 全戦略のサマリーを取得
      const strategies = ['RSI', 'MA', 'BOLLINGER_BANDS', 'MACD', 'MEAN_REVERSION', 'MULTI_INDICATOR'];
      let totalEquity = 0;
      let totalPnL = 0;
      let maxEquity = 0;

      for (const strategy of strategies) {
        try {
          const summary = await getTradeSummary(exchange, 'ALL', strategy);
          if (summary) {
            const currentEquity = parseFloat(summary.totalValue || 0);
            const pnl = parseFloat(summary.totalPnL || 0);
            
            totalEquity += currentEquity;
            totalPnL += pnl;
            
            // 過去の最高水準を推定（現在の損益がプラスなら、その分を加算した値を過去最高とする）
            maxEquity += currentEquity + Math.max(0, -pnl);
          }
        } catch (error) {
          console.warn(`[PortfolioRisk] サマリー取得エラー: ${strategy} - ${error.message}`);
        }
      }

      let drawdown = 0;
      if (maxEquity > 0 && totalEquity < maxEquity) {
        drawdown = (maxEquity - totalEquity) / maxEquity;
      }

      // 0-1範囲にクランプ
      drawdown = Math.max(0, Math.min(1, drawdown));

      this.cache.set(cacheKey, drawdown);
      console.log(`[PortfolioRisk] ドローダウン: ${(drawdown * 100).toFixed(2)}%`);

      return drawdown;

    } catch (error) {
      console.error(`[PortfolioRisk] ドローダウン計算エラー: ${error.message}`);
      return 0; // エラー時のデフォルト値
    }
  }

  /**
   * リスク限界接近度を計算
   * @param {string} exchange - 取引所ID
   * @returns {Promise<number>} リスク接近度（0-1、1に近いほど危険）
   */
  async getRiskProximity(exchange = 'bitbank') {
    try {
      const drawdown = await this.getCurrentDrawdown(exchange);
      const concentration = await this.getPositionConcentration(exchange);
      
      // ドローダウンとポジション集中度を組み合わせ
      const drawdownRisk = drawdown / this.maxDrawdownThreshold;
      const concentrationRisk = concentration / this.concentrationThreshold;
      
      // 最大値を取る（どちらかが高ければ高リスク）
      const riskProximity = Math.max(drawdownRisk, concentrationRisk);
      
      return Math.max(0, Math.min(1, riskProximity));

    } catch (error) {
      console.error(`[PortfolioRisk] リスク接近度計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * ポジション集中度を計算
   * @param {string} exchange - 取引所ID
   * @returns {Promise<number>} 集中度（0-1）
   */
  async getPositionConcentration(exchange = 'bitbank') {
    const cacheKey = `concentration_${exchange}_${Math.floor(Date.now() / this.cacheTimeout)}`;
    
    // キャッシュチェック
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const strategies = ['RSI', 'MA', 'BOLLINGER_BANDS', 'MACD', 'MEAN_REVERSION', 'MULTI_INDICATOR'];
      const symbolPositions = new Map();
      let totalPositionValue = 0;

      // 全戦略のポジションを取得
      for (const strategy of strategies) {
        try {
          const positions = await getStrategyPositionsRedis(exchange, strategy);
          
          for (const [positionKey, position] of positions) {
            if (position.status === 'open') {
              const symbol = position.symbol;
              const value = parseFloat(position.amount) * parseFloat(position.entryPrice);
              
              symbolPositions.set(symbol, (symbolPositions.get(symbol) || 0) + value);
              totalPositionValue += value;
            }
          }
        } catch (error) {
          console.warn(`[PortfolioRisk] ポジション取得エラー: ${strategy} - ${error.message}`);
        }
      }

      if (totalPositionValue === 0) {
        this.cache.set(cacheKey, 0);
        return 0;
      }

      // 最大シンボル集中度を計算
      let maxConcentration = 0;
      for (const [symbol, value] of symbolPositions) {
        const concentration = value / totalPositionValue;
        if (concentration > maxConcentration) {
          maxConcentration = concentration;
        }
      }

      this.cache.set(cacheKey, maxConcentration);
      console.log(`[PortfolioRisk] 最大ポジション集中度: ${(maxConcentration * 100).toFixed(2)}%`);

      return maxConcentration;

    } catch (error) {
      console.error(`[PortfolioRisk] ポジション集中度計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * リスク状況に基づくurgency調整係数を計算
   * @param {string} exchange - 取引所ID
   * @returns {Promise<number>} 調整係数（負の値は慎重、正の値は積極的）
   */
  async calculateRiskAdjustment(exchange = 'bitbank') {
    try {
      const riskProximity = await this.getRiskProximity(exchange);
      
      // リスク接近度に基づく調整
      if (riskProximity > 0.8) {
        return -0.4; // 大幅に慎重モード
      } else if (riskProximity > 0.6) {
        return -0.2; // 慎重モード
      } else if (riskProximity < 0.3) {
        return 0.2;  // 積極モード
      } else {
        return 0;    // 中立
      }

    } catch (error) {
      console.error(`[PortfolioRisk] リスク調整係数計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * 詳細なリスク分析レポートを生成
   * @param {string} exchange - 取引所ID
   * @returns {Promise<Object>} リスク分析レポート
   */
  async generateRiskReport(exchange = 'bitbank') {
    try {
      const drawdown = await this.getCurrentDrawdown(exchange);
      const concentration = await this.getPositionConcentration(exchange);
      const riskProximity = await this.getRiskProximity(exchange);
      const adjustment = await this.calculateRiskAdjustment(exchange);

      return {
        drawdown: {
          value: drawdown,
          percentage: (drawdown * 100).toFixed(2),
          threshold: (this.maxDrawdownThreshold * 100).toFixed(2),
          status: drawdown > this.maxDrawdownThreshold ? 'WARNING' : 'OK'
        },
        concentration: {
          value: concentration,
          percentage: (concentration * 100).toFixed(2),
          threshold: (this.concentrationThreshold * 100).toFixed(2),
          status: concentration > this.concentrationThreshold ? 'WARNING' : 'OK'
        },
        riskProximity: {
          value: riskProximity,
          level: riskProximity > 0.8 ? 'HIGH' : riskProximity > 0.6 ? 'MEDIUM' : 'LOW'
        },
        urgencyAdjustment: {
          value: adjustment,
          direction: adjustment > 0 ? 'AGGRESSIVE' : adjustment < 0 ? 'CONSERVATIVE' : 'NEUTRAL'
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`[PortfolioRisk] レポート生成エラー: ${error.message}`);
      return null;
    }
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { PortfolioRiskAnalyzer };