/**
 * 市場ボラティリティ分析モジュール
 * 動的urgency調整システムの構成要素
 */

class VolatilityAnalyzer {
  constructor(options = {}) {
    this.atrPeriod = options.atrPeriod || 14;
    this.volatilityPeriod = options.volatilityPeriod || 20;
    this.cacheTimeout = options.cacheTimeout || 60000; // 1分間キャッシュ
    this.cache = new Map();
  }

  /**
   * ATR（Average True Range）を計算
   * @param {Array} ohlcvData - OHLCV データ配列
   * @param {number} period - 計算期間（デフォルト14）
   * @returns {number} ATR値
   */
  calculateATR(ohlcvData, period = this.atrPeriod) {
    if (!ohlcvData || ohlcvData.length < period + 1) {
      return 0;
    }

    const trueRanges = [];
    
    for (let i = 1; i < ohlcvData.length; i++) {
      const current = ohlcvData[i];
      const previous = ohlcvData[i - 1];
      
      const high = current[2]; // High
      const low = current[3];  // Low
      const prevClose = previous[4]; // Previous Close
      
      // True Range = max(high-low, abs(high-prevClose), abs(low-prevClose))
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    // ATR = 過去period期間のTrue Rangeの平均
    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
  }

  /**
   * 価格変動率の標準偏差を計算
   * @param {Array} ohlcvData - OHLCV データ配列
   * @param {number} period - 計算期間（デフォルト20）
   * @returns {number} 価格ボラティリティ
   */
  calculatePriceVolatility(ohlcvData, period = this.volatilityPeriod) {
    if (!ohlcvData || ohlcvData.length < period + 1) {
      return 0;
    }

    const returns = [];
    
    // 日次リターンを計算
    for (let i = 1; i < ohlcvData.length; i++) {
      const currentClose = ohlcvData[i][4];
      const prevClose = ohlcvData[i - 1][4];
      
      if (prevClose > 0) {
        const returnRate = (currentClose - prevClose) / prevClose;
        returns.push(returnRate);
      }
    }

    if (returns.length < period) {
      return 0;
    }

    // 最近period期間のリターンを使用
    const recentReturns = returns.slice(-period);
    
    // 平均リターンを計算
    const meanReturn = recentReturns.reduce((sum, ret) => sum + ret, 0) / recentReturns.length;
    
    // 標準偏差を計算
    const variance = recentReturns.reduce((sum, ret) => {
      return sum + Math.pow(ret - meanReturn, 2);
    }, 0) / recentReturns.length;
    
    return Math.sqrt(variance);
  }

  /**
   * ボラティリティランクを計算（0-1の範囲）
   * @param {number} currentVol - 現在のボラティリティ
   * @param {Array} historicalVol - 過去のボラティリティデータ
   * @returns {number} ボラティリティランク（0-1）
   */
  getVolatilityRank(currentVol, historicalVol) {
    if (!historicalVol || historicalVol.length === 0) {
      return 0.5; // デフォルト中間値
    }

    // 現在値より小さい値の割合を計算
    const lowerCount = historicalVol.filter(vol => vol < currentVol).length;
    return lowerCount / historicalVol.length;
  }

  /**
   * シンボル別の総合ボラティリティスコアを計算
   * @param {string} symbol - 通貨ペア
   * @param {Array} ohlcvData - OHLCV データ
   * @returns {Promise<number>} ボラティリティスコア（0-1）
   */
  async calculateVolatilityScore(symbol, ohlcvData) {
    const cacheKey = `${symbol}_volatility_${Date.now()}`;
    
    // キャッシュチェック
    const cached = this.getCachedResult(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      if (!ohlcvData || ohlcvData.length < this.volatilityPeriod + 1) {
        console.warn(`[VolatilityAnalyzer] 不十分なデータ: ${symbol}`);
        return 0.5; // デフォルト値
      }

      // ATRベースのボラティリティ
      const atr = this.calculateATR(ohlcvData);
      const currentPrice = ohlcvData[ohlcvData.length - 1][4]; // 最新終値
      const atrPercent = currentPrice > 0 ? (atr / currentPrice) : 0;

      // 価格変動率ベースのボラティリティ
      const priceVol = this.calculatePriceVolatility(ohlcvData);

      // 過去データからの相対評価
      const historicalATRs = this.calculateHistoricalATRs(ohlcvData, 50); // 50期間の履歴
      const atrRank = this.getVolatilityRank(atrPercent, historicalATRs);

      const historicalPriceVols = this.calculateHistoricalPriceVols(ohlcvData, 50);
      const priceVolRank = this.getVolatilityRank(priceVol, historicalPriceVols);

      // 総合スコア（ATR 60%, 価格変動 40%）
      const compositeScore = (atrRank * 0.6) + (priceVolRank * 0.4);

      // キャッシュに保存
      this.setCachedResult(cacheKey, compositeScore);

      console.log(`[VolatilityAnalyzer] ${symbol}: ATR=${atrPercent.toFixed(4)}, PriceVol=${priceVol.toFixed(4)}, Score=${compositeScore.toFixed(3)}`);

      return Math.max(0, Math.min(1, compositeScore)); // 0-1範囲にクランプ

    } catch (error) {
      console.error(`[VolatilityAnalyzer] エラー: ${symbol} - ${error.message}`);
      return 0.5; // エラー時のデフォルト値
    }
  }

  /**
   * 過去のATR値を計算
   * @param {Array} ohlcvData - OHLCV データ
   * @param {number} lookbackPeriod - 遡り期間
   * @returns {Array} 過去のATR値配列
   */
  calculateHistoricalATRs(ohlcvData, lookbackPeriod) {
    const atrs = [];
    const minDataPoints = this.atrPeriod + lookbackPeriod;
    
    if (ohlcvData.length < minDataPoints) {
      return []; // データ不足
    }

    for (let i = this.atrPeriod; i < ohlcvData.length - lookbackPeriod; i++) {
      const sliceData = ohlcvData.slice(Math.max(0, i - this.atrPeriod), i + 1);
      const atr = this.calculateATR(sliceData);
      const price = ohlcvData[i][4];
      
      if (price > 0) {
        atrs.push(atr / price);
      }
    }

    return atrs;
  }

  /**
   * 過去の価格変動率を計算
   * @param {Array} ohlcvData - OHLCV データ
   * @param {number} lookbackPeriod - 遡り期間
   * @returns {Array} 過去の価格変動率配列
   */
  calculateHistoricalPriceVols(ohlcvData, lookbackPeriod) {
    const vols = [];
    const minDataPoints = this.volatilityPeriod + lookbackPeriod;
    
    if (ohlcvData.length < minDataPoints) {
      return []; // データ不足
    }

    for (let i = this.volatilityPeriod; i < ohlcvData.length - lookbackPeriod; i++) {
      const sliceData = ohlcvData.slice(Math.max(0, i - this.volatilityPeriod), i + 1);
      const vol = this.calculatePriceVolatility(sliceData);
      vols.push(vol);
    }

    return vols;
  }

  /**
   * キャッシュからの結果取得
   * @param {string} key - キャッシュキー
   * @returns {number|null} キャッシュされた値またはnull
   */
  getCachedResult(key) {
    const baseKey = key.split('_').slice(0, -1).join('_'); // タイムスタンプ部分を除去
    
    for (const [cachedKey, value] of this.cache.entries()) {
      if (cachedKey.startsWith(baseKey)) {
        const cachedTime = parseInt(cachedKey.split('_').pop());
        if (Date.now() - cachedTime < this.cacheTimeout) {
          return value;
        } else {
          this.cache.delete(cachedKey); // 期限切れを削除
        }
      }
    }
    
    return null;
  }

  /**
   * キャッシュに結果を保存
   * @param {string} key - キャッシュキー
   * @param {number} value - 保存する値
   */
  setCachedResult(key, value) {
    // 古いキャッシュを削除（メモリ節約）
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, value);
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { VolatilityAnalyzer };