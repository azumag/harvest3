/**
 * 時間帯分析モジュール
 * 動的urgency調整システムの構成要素
 */

class TimezoneAnalyzer {
  constructor(options = {}) {
    this.timezone = options.timezone || 'Asia/Tokyo';
    this.cacheTimeout = options.cacheTimeout || 300000; // 5分間キャッシュ
    this.cache = new Map();
    
    // 市場活発時間の定義（JST基準）
    this.marketHours = {
      // 日本市場時間
      japan: {
        open: 9,
        close: 15,
        active: true
      },
      // 欧州市場時間（JST換算）
      europe: {
        open: 16,
        close: 24,
        active: true
      },
      // 米国市場時間（JST換算）
      usa: {
        open: 22,
        close: 5, // 翌日
        active: true
      },
      // アジア市場時間
      asia: {
        open: 7,
        close: 17,
        active: true
      }
    };
  }

  /**
   * 市場活発度スコアを計算
   * @param {number} timestamp - タイムスタンプ（省略時は現在時刻）
   * @returns {number} 活発度スコア（0-1）
   */
  getMarketActivityScore(timestamp = Date.now()) {
    const cacheKey = `activity_${Math.floor(timestamp / this.cacheTimeout)}`;
    
    // キャッシュチェック
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const date = new Date(timestamp);
      const hour = date.getHours(); // JST時間
      const day = date.getDay(); // 0=日曜, 1=月曜, ..., 6=土曜
      
      // 平日/休日チェック
      const isWeekday = day >= 1 && day <= 5;
      let baseScore = isWeekday ? 1.0 : 0.3; // 平日は基本スコア1.0、週末は0.3

      // 時間帯別調整
      let timeMultiplier = 0.5; // デフォルト

      // 各市場の営業時間をチェック
      const marketScores = [];

      // 日本市場
      if (this.isMarketOpen(hour, this.marketHours.japan)) {
        marketScores.push(0.9); // 日本市場は高スコア
      }

      // 欧州市場
      if (this.isMarketOpen(hour, this.marketHours.europe)) {
        marketScores.push(0.8);
      }

      // 米国市場（翌日跨ぎを考慮）
      if (this.isMarketOpenOvernight(hour, this.marketHours.usa)) {
        marketScores.push(0.85);
      }

      // アジア市場
      if (this.isMarketOpen(hour, this.marketHours.asia)) {
        marketScores.push(0.7);
      }

      // 複数市場が重なる場合はボーナス
      if (marketScores.length > 0) {
        timeMultiplier = Math.max(...marketScores);
        if (marketScores.length > 1) {
          timeMultiplier += 0.1 * (marketScores.length - 1); // 重複ボーナス
        }
      }

      // 特定時間帯の調整
      if (hour >= 21 && hour <= 23) {
        // 21-23時: 欧米市場重複時間
        timeMultiplier = Math.max(timeMultiplier, 0.95);
      } else if (hour >= 9 && hour <= 11) {
        // 9-11時: 日本市場開始時間
        timeMultiplier = Math.max(timeMultiplier, 0.85);
      } else if (hour >= 1 && hour <= 5) {
        // 深夜1-5時: 流動性低下
        timeMultiplier = Math.min(timeMultiplier, 0.4);
      }

      const finalScore = Math.min(1.0, baseScore * timeMultiplier);
      
      this.cache.set(cacheKey, finalScore);
      
      console.log(`[TimezoneAnalyzer] 時刻=${hour}時, スコア=${finalScore.toFixed(3)}, 市場数=${marketScores.length}`);
      
      return finalScore;

    } catch (error) {
      console.error(`[TimezoneAnalyzer] 活発度計算エラー: ${error.message}`);
      return 0.5; // エラー時のデフォルト値
    }
  }

  /**
   * 流動性期待値を計算
   * @param {number} hour - 時間（0-23）
   * @param {string} market - 市場識別子
   * @returns {number} 流動性期待値（0-1）
   */
  getLiquidityExpectation(hour, market = 'crypto') {
    try {
      // 暗号通貨市場は24時間だが、時間帯による流動性変動あり
      if (market === 'crypto') {
        // 暗号通貨の流動性パターン
        const cryptoPattern = {
          0: 0.4, 1: 0.3, 2: 0.3, 3: 0.3, 4: 0.3, 5: 0.4,
          6: 0.5, 7: 0.6, 8: 0.7, 9: 0.8, 10: 0.8, 11: 0.8,
          12: 0.7, 13: 0.7, 14: 0.7, 15: 0.8, 16: 0.8, 17: 0.8,
          18: 0.7, 19: 0.7, 20: 0.8, 21: 0.9, 22: 0.9, 23: 0.8
        };
        
        return cryptoPattern[hour] || 0.5;
      }

      // デフォルト
      return 0.5;

    } catch (error) {
      console.error(`[TimezoneAnalyzer] 流動性計算エラー: ${error.message}`);
      return 0.5;
    }
  }

  /**
   * 時間帯別urgency調整係数を計算
   * @param {number} timestamp - タイムスタンプ（省略時は現在時刻）
   * @returns {number} 調整係数（負の値は慎重、正の値は積極的）
   */
  calculateTimezoneAdjustment(timestamp = Date.now()) {
    try {
      const activityScore = this.getMarketActivityScore(timestamp);
      const hour = new Date(timestamp).getHours();
      const liquidityExpectation = this.getLiquidityExpectation(hour);
      
      // 活発度と流動性の組み合わせ
      const combinedScore = (activityScore * 0.7) + (liquidityExpectation * 0.3);
      
      // スコアに基づく調整係数計算
      if (combinedScore > 0.8) {
        return 0.15; // 積極的
      } else if (combinedScore > 0.6) {
        return 0.05; // やや積極的
      } else if (combinedScore < 0.4) {
        return -0.2; // 慎重
      } else {
        return 0; // 中立
      }

    } catch (error) {
      console.error(`[TimezoneAnalyzer] 時間帯調整計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * 市場営業時間チェック（通常時間）
   * @param {number} hour - 現在時刻
   * @param {Object} marketHours - 市場時間設定
   * @returns {boolean} 営業時間内かどうか
   */
  isMarketOpen(hour, marketHours) {
    return hour >= marketHours.open && hour < marketHours.close;
  }

  /**
   * 市場営業時間チェック（日跨ぎ対応）
   * @param {number} hour - 現在時刻
   * @param {Object} marketHours - 市場時間設定
   * @returns {boolean} 営業時間内かどうか
   */
  isMarketOpenOvernight(hour, marketHours) {
    if (marketHours.close < marketHours.open) {
      // 翌日跨ぎの場合（22時-5時など）
      return hour >= marketHours.open || hour < marketHours.close;
    }
    return this.isMarketOpen(hour, marketHours);
  }

  /**
   * 時間帯分析レポートを生成
   * @param {number} timestamp - タイムスタンプ（省略時は現在時刻）
   * @returns {Object} 分析レポート
   */
  generateTimezoneReport(timestamp = Date.now()) {
    try {
      const date = new Date(timestamp);
      const hour = date.getHours();
      const day = date.getDay();
      
      const activityScore = this.getMarketActivityScore(timestamp);
      const liquidityExpectation = this.getLiquidityExpectation(hour);
      const adjustment = this.calculateTimezoneAdjustment(timestamp);
      
      // 営業中の市場を特定
      const activeMarkets = [];
      for (const [marketName, hours] of Object.entries(this.marketHours)) {
        if (marketName === 'usa' ? this.isMarketOpenOvernight(hour, hours) : this.isMarketOpen(hour, hours)) {
          activeMarkets.push(marketName);
        }
      }

      return {
        timestamp: date.toISOString(),
        localTime: {
          hour,
          day,
          isWeekday: day >= 1 && day <= 5
        },
        scores: {
          activity: {
            value: activityScore,
            level: activityScore > 0.8 ? 'HIGH' : activityScore > 0.6 ? 'MEDIUM' : 'LOW'
          },
          liquidity: {
            value: liquidityExpectation,
            level: liquidityExpectation > 0.7 ? 'HIGH' : liquidityExpectation > 0.5 ? 'MEDIUM' : 'LOW'
          }
        },
        activeMarkets,
        urgencyAdjustment: {
          value: adjustment,
          direction: adjustment > 0 ? 'AGGRESSIVE' : adjustment < 0 ? 'CONSERVATIVE' : 'NEUTRAL'
        }
      };

    } catch (error) {
      console.error(`[TimezoneAnalyzer] レポート生成エラー: ${error.message}`);
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

module.exports = { TimezoneAnalyzer };