/**
 * 相関計算とペアトレーディング機能
 * 効率的な統計的相関分析とペア選択機能を提供
 */

/**
 * ピアソン相関係数を計算
 * @param {Array} x 配列1
 * @param {Array} y 配列2
 * @returns {number} 相関係数 (-1 to 1)
 */
function calculatePearsonCorrelation(x, y) {
  if (!x || !y || x.length !== y.length || x.length < 2) {
    return 0;
  }

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * スピアマンランク相関係数を計算
 * @param {Array} x 配列1
 * @param {Array} y 配列2
 * @returns {number} スピアマン相関係数
 */
function calculateSpearmanCorrelation(x, y) {
  if (!x || !y || x.length !== y.length || x.length < 2) {
    return 0;
  }

  // ランクを計算
  const getRanks = (arr) => {
    const sorted = [...arr].map((val, idx) => ({ val, idx }))
      .sort((a, b) => a.val - b.val);
    const ranks = new Array(arr.length);
    sorted.forEach((item, rank) => {
      ranks[item.idx] = rank + 1;
    });
    return ranks;
  };

  const ranksX = getRanks(x);
  const ranksY = getRanks(y);

  return calculatePearsonCorrelation(ranksX, ranksY);
}

/**
 * 移動平均からの乖離を計算
 * @param {Array} prices 価格配列
 * @param {number} window 移動平均期間
 * @returns {Array} 乖離値配列
 */
function calculateMADeviation(prices, window = 20) {
  if (!prices || prices.length < window) {
    return [];
  }

  const result = [];
  for (let i = window - 1; i < prices.length; i++) {
    const ma = prices.slice(i - window + 1, i + 1).reduce((a, b) => a + b) / window;
    result.push((prices[i] - ma) / ma);
  }
  return result;
}

/**
 * 価格スプレッドを計算
 * @param {Array} prices1 価格配列1
 * @param {Array} prices2 価格配列2
 * @param {boolean} logarithmic 対数スプレッドを使用するか
 * @returns {Array} スプレッド配列
 */
function calculateSpread(prices1, prices2, logarithmic = true) {
  if (!prices1 || !prices2 || prices1.length !== prices2.length) {
    return [];
  }

  if (logarithmic) {
    return prices1.map((p1, i) => Math.log(p1) - Math.log(prices2[i]));
  } else {
    return prices1.map((p1, i) => p1 - prices2[i]);
  }
}

/**
 * スプレッドのZ-scoreを計算
 * @param {Array} spread スプレッド配列
 * @param {number} window 計算期間
 * @returns {Array} Z-score配列
 */
function calculateZScore(spread, window = 20) {
  if (!spread || spread.length < window) {
    return [];
  }

  const result = [];
  for (let i = window - 1; i < spread.length; i++) {
    const slice = spread.slice(i - window + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b) / window;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / window;
    const std = Math.sqrt(variance);

    result.push(std === 0 ? 0 : (spread[i] - mean) / std);
  }
  return result;
}

/**
 * 半減期を計算（平均回帰の速さを測定）
 * @param {Array} spread スプレッド配列
 * @returns {number} 半減期（期間数）
 */
function calculateHalfLife(spread) {
  if (!spread || spread.length < 10) {
    return null;
  }

  // 回帰分析で自己相関を計算
  const y = spread.slice(1);
  const x = spread.slice(0, -1);

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // 半減期 = -ln(2) / ln(slope + 1)
  return slope >= 0 ? null : -Math.log(2) / Math.log(1 + slope);
}

/**
 * 動的ペア選択クラス
 */
class DynamicPairSelector {
  constructor() {
    this.correlationHistory = new Map();
    this.profitableCorrelations = new Map();
    this.performanceWindow = 30; // 30日間のパフォーマンス履歴
  }

  /**
   * 相関履歴を記録
   * @param {string} targetSymbol ターゲットシンボル
   * @param {string} refSymbol 参照シンボル
   * @param {number} correlation 相関値
   * @param {number} profit 利益（任意）
   */
  recordCorrelation(targetSymbol, refSymbol, correlation, profit = 0) {
    const key = `${targetSymbol}_${refSymbol}`;

    if (!this.correlationHistory.has(key)) {
      this.correlationHistory.set(key, []);
    }

    if (!this.profitableCorrelations.has(targetSymbol)) {
      this.profitableCorrelations.set(targetSymbol, []);
    }

    const timestamp = Date.now();
    this.correlationHistory.get(key).push({
      correlation,
      profit,
      timestamp
    });

    // 古いデータを削除（30日以上前）
    const cutoff = timestamp - (this.performanceWindow * 24 * 60 * 60 * 1000);
    this.correlationHistory.set(key,
      this.correlationHistory.get(key).filter(record => record.timestamp > cutoff)
    );

    // 収益性データを更新
    this.updateProfitability(targetSymbol, refSymbol);
  }

  /**
   * 収益性データを更新
   * @param {string} targetSymbol ターゲットシンボル
   * @param {string} refSymbol 参照シンボル
   */
  updateProfitability(targetSymbol, refSymbol) {
    const key = `${targetSymbol}_${refSymbol}`;
    const history = this.correlationHistory.get(key) || [];

    if (history.length === 0) {
      return;
    }

    const avgCorrelation = history.reduce((sum, record) => sum + record.correlation, 0) / history.length;
    const totalProfit = history.reduce((sum, record) => sum + record.profit, 0);
    const profitability = totalProfit / history.length;

    const profitableList = this.profitableCorrelations.get(targetSymbol) || [];
    const existingIndex = profitableList.findIndex(item => item.refSymbol === refSymbol);

    const newEntry = {
      refSymbol,
      avgCorrelation,
      profitability,
      count: history.length
    };

    if (existingIndex >= 0) {
      profitableList[existingIndex] = newEntry;
    } else {
      profitableList.push(newEntry);
    }

    this.profitableCorrelations.set(targetSymbol, profitableList);
  }

  /**
   * 最適な参照ペアを選択
   * @param {string} targetSymbol ターゲットシンボル
   * @param {Array} availableSymbols 利用可能なシンボル配列
   * @param {number} maxPairs 最大ペア数
   * @returns {Array} 選択された参照ペア
   */
  selectReferencePairs(targetSymbol, availableSymbols, maxPairs = 5) {
    const profitableList = this.profitableCorrelations.get(targetSymbol) || [];

    if (profitableList.length === 0) {
      // 履歴がない場合は主要通貨ペアを返す
      const majorPairs = ['BTC/USDT', 'ETH/USDT', 'BTC/JPY', 'ETH/JPY'];
      return majorPairs
        .filter(pair => pair !== targetSymbol && availableSymbols.includes(pair))
        .slice(0, maxPairs);
    }

    // 収益性と相関の強さでソート
    return profitableList
      .filter(item => availableSymbols.includes(item.refSymbol))
      .sort((a, b) => {
        // 複合スコア：収益性 + 相関の絶対値 + データ数の信頼性
        const scoreA = a.profitability + Math.abs(a.avgCorrelation) * 0.5 + Math.min(a.count / 100, 0.3);
        const scoreB = b.profitability + Math.abs(b.avgCorrelation) * 0.5 + Math.min(b.count / 100, 0.3);
        return scoreB - scoreA;
      })
      .slice(0, maxPairs)
      .map(item => item.refSymbol);
  }

  /**
   * 相関の統計情報を取得
   * @param {string} targetSymbol ターゲットシンボル
   * @returns {Object} 統計情報
   */
  getCorrelationStats(targetSymbol) {
    const profitableList = this.profitableCorrelations.get(targetSymbol) || [];

    if (profitableList.length === 0) {
      return null;
    }

    const totalProfitability = profitableList.reduce((sum, item) => sum + item.profitability, 0);
    const avgProfitability = totalProfitability / profitableList.length;
    const avgCorrelation = profitableList.reduce((sum, item) => sum + Math.abs(item.avgCorrelation), 0) / profitableList.length;

    return {
      pairCount: profitableList.length,
      avgProfitability,
      avgCorrelation,
      bestPair: profitableList[0]
    };
  }
}

/**
 * 統計的ペアトレーディングクラス
 */
class StatisticalPairTrading {
  constructor(options = {}) {
    this.lookbackPeriod = options.lookbackPeriod || 30;
    this.entryZScore = options.entryZScore || 2.0;
    this.exitZScore = options.exitZScore || 0.5;
    this.minCorrelation = options.minCorrelation || 0.7;
    this.maxPairs = options.maxPairs || 10;
  }

  /**
   * 取引ペアを発見
   * @param {Object} symbolsData シンボルデータ {symbol: priceArray}
   * @returns {Array} 取引ペア配列
   */
  async findTradingPairs(symbolsData) {
    const symbols = Object.keys(symbolsData);
    const pairs = [];

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const symbol1 = symbols[i];
        const symbol2 = symbols[j];
        const prices1 = symbolsData[symbol1];
        const prices2 = symbolsData[symbol2];

        if (!prices1 || !prices2 || prices1.length < this.lookbackPeriod || prices2.length < this.lookbackPeriod) {
          continue;
        }

        const correlation = calculatePearsonCorrelation(prices1, prices2);

        if (Math.abs(correlation) >= this.minCorrelation) {
          const spread = calculateSpread(prices1, prices2);
          const halfLife = calculateHalfLife(spread);

          pairs.push({
            symbol1,
            symbol2,
            correlation,
            halfLife,
            spread,
            isCointegrated: halfLife !== null && halfLife < this.lookbackPeriod
          });
        }
      }
    }

    return pairs
      .filter(pair => pair.isCointegrated)
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
      .slice(0, this.maxPairs);
  }

  /**
   * ペアトレードシグナルを生成
   * @param {Object} pair トレーディングペア
   * @param {Array} currentPrices1 現在の価格配列1
   * @param {Array} currentPrices2 現在の価格配列2
   * @returns {Object|null} トレードシグナル
   */
  generatePairTradeSignal(pair, currentPrices1, currentPrices2) {
    if (!currentPrices1 || !currentPrices2 || currentPrices1.length < this.lookbackPeriod) {
      return null;
    }

    const spread = calculateSpread(currentPrices1, currentPrices2);
    const zScores = calculateZScore(spread, this.lookbackPeriod);

    if (zScores.length === 0) {
      return null;
    }

    const currentZScore = zScores[zScores.length - 1];

    if (Math.abs(currentZScore) > this.entryZScore) {
      return {
        long: currentZScore > 0 ? pair.symbol2 : pair.symbol1,
        short: currentZScore > 0 ? pair.symbol1 : pair.symbol2,
        confidence: Math.min(Math.abs(currentZScore) / 3, 1),
        zScore: currentZScore,
        spread: spread[spread.length - 1],
        entryType: 'mean_reversion'
      };
    }

    return null;
  }

  /**
   * ペアトレードのエグジットシグナルを生成
   * @param {Object} pair トレーディングペア
   * @param {Array} currentPrices1 現在の価格配列1
   * @param {Array} currentPrices2 現在の価格配列2
   * @param {Object} position 現在のポジション
   * @returns {boolean} エグジットするかどうか
   */
  generateExitSignal(pair, currentPrices1, currentPrices2, position) {
    const spread = calculateSpread(currentPrices1, currentPrices2);
    const zScores = calculateZScore(spread, this.lookbackPeriod);

    if (zScores.length === 0) {
      return false;
    }

    const currentZScore = zScores[zScores.length - 1];
    return Math.abs(currentZScore) <= this.exitZScore;
  }
}

module.exports = {
  calculatePearsonCorrelation,
  calculateSpearmanCorrelation,
  calculateMADeviation,
  calculateSpread,
  calculateZScore,
  calculateHalfLife,
  DynamicPairSelector,
  StatisticalPairTrading
};