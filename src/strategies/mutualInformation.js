/**
 * 相互情報量戦略
 * 通貨間・取引所間の相互情報量を基準とした取引戦略
 */
const {
  calculateMutualInformation,
  calculateMutualInformationMatrix,
  calculateReturns,
  calculateSMA
} = require('./utils/indicators');

const { 
  fetchAndValidateOHLCVData, 
  handleStrategySignals, 
} = require('./utils/common');

const { addSignal, fetchTicker } = require('../database/manager');
const { postErrorToDiscord } = require('../common/notifications');

/**
 * 相互情報量戦略
 * 複数の通貨ペアまたは取引所間の相互情報量を分析して売買シグナルを生成
 */
async function mutualInformationStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
  const { 
    period = 50, 
    threshold = 0.5, 
    referenceSymbols = ['BTC/USDT'], 
    ohlcvInterval = '5m',
    useReturns = true 
  } = config;

  try {
    // メインシンボルのOHLCVデータを取得
    const validatedData = await fetchAndValidateOHLCVData(
      exchange, 
      symbol, 
      ohlcvInterval, 
      period + 10, // 余裕を持ってデータを取得
      postErrorToDiscord,
      'Mutual Information',
      options
    );
    if (!validatedData) return;
    
    const { closes: mainCloses, ohlcv } = validatedData;
    
    if (options.backtest) {
      options.backtest.ohlcvData = ohlcv;
    }

    // 参照シンボルのデータを取得
    const referenceData = [];
    for (const refSymbol of referenceSymbols) {
      if (refSymbol === symbol) continue; // 同じシンボルはスキップ
      
      try {
        const refValidatedData = await fetchAndValidateOHLCVData(
          exchange, 
          refSymbol, 
          ohlcvInterval, 
          period + 10,
          postErrorToDiscord,
          'Mutual Information Ref',
          options
        );
        
        if (refValidatedData) {
          referenceData.push({
            symbol: refSymbol,
            closes: refValidatedData.closes
          });
        }
      } catch (error) {
        console.log(`参照シンボル ${refSymbol} のデータ取得に失敗: ${error.message}`);
      }
    }

    if (referenceData.length === 0) {
      console.log(`相互情報量戦略: 参照データが不足しています ${symbol}`);
      return {
        strategy: 'Mutual Information',
        symbol,
        signal: 'none',
        reason: '参照データ不足'
      };
    }

    // シグナル計算
    const signalResult = await calculateMutualInformationSignals(
      mainCloses,
      referenceData,
      period,
      threshold,
      exchange,
      symbol,
      strategyKey,
      useReturns,
      options
    );

    if (!signalResult) return;
    
    // シグナルによって売買
    return await handleStrategySignals(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      signalResult,
      'Mutual Information',
      strategyKey,
      formatMutualInformationLogInfo,
      options
    );
  } catch (error) {
    console.error(`相互情報量戦略でエラーが発生しました: ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[相互情報量戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Mutual Information',
      symbol,
      error: error.message
    };
  }
}

/**
 * 相互情報量戦略のシグナルを計算する
 * @param {Array} mainCloses メインシンボルの終値配列
 * @param {Array} referenceData 参照シンボルのデータ配列
 * @param {number} period 分析期間
 * @param {number} threshold シグナル閾値
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @param {boolean} useReturns リターンを使用するかどうか
 * @returns {Object} シグナル計算結果
 */
async function calculateMutualInformationSignals(
  mainCloses, 
  referenceData, 
  period, 
  threshold, 
  exchange, 
  symbol, 
  strategyKey, 
  useReturns,
  options = {}
) {
  // 最新のperiod分のデータを取得
  const recentMainCloses = mainCloses.slice(-period);
  
  // 参照データも同じ期間で切り取り
  const recentReferenceData = referenceData.map(ref => ({
    symbol: ref.symbol,
    closes: ref.closes.slice(-period)
  }));

  // データの長さを統一
  const minLength = Math.min(recentMainCloses.length, 
    ...recentReferenceData.map(ref => ref.closes.length));
  
  if (minLength < period / 2) {
    console.log(`相互情報量戦略: データが不足しています ${symbol}, minLength: ${minLength}`);
    return null;
  }

  // 分析用データの準備
  let mainData = recentMainCloses.slice(-minLength);
  let referenceDataForAnalysis = recentReferenceData.map(ref => ({
    symbol: ref.symbol,
    data: ref.closes.slice(-minLength)
  }));

  // リターンを使用する場合は価格変化率を計算
  if (useReturns) {
    mainData = calculateReturns(mainData);
    referenceDataForAnalysis = referenceDataForAnalysis.map(ref => ({
      symbol: ref.symbol,
      data: calculateReturns(ref.data)
    }));
  }

  // 相互情報量を計算
  const mutualInfoScores = referenceDataForAnalysis.map(ref => ({
    symbol: ref.symbol,
    mutualInfo: calculateMutualInformation(mainData, ref.data)
  }));

  // 平均相互情報量を計算
  const avgMutualInfo = mutualInfoScores.reduce((sum, score) => sum + score.mutualInfo, 0) / mutualInfoScores.length;
  
  // 現在の価格を取得
  const ticker = await fetchTicker(exchange, symbol, options);
  const currentPrice = ticker.last;

  // 最近の価格トレンドを分析（短期移動平均を使用）
  const shortMA = calculateSMA(recentMainCloses, Math.min(5, recentMainCloses.length - 1));
  const currentTrend = shortMA[shortMA.length - 1] - shortMA[shortMA.length - 2];

  // シグナル生成ロジック
  let buySignal = false;
  let sellSignal = false;
  let signalType = 'none';

  // 高い相互情報量（強い相関）が検出された場合
  if (avgMutualInfo > threshold) {
    // トレンドに従った取引を行う
    if (currentTrend > 0) {
      buySignal = true;
      signalType = 'buy';
    } else if (currentTrend < 0) {
      sellSignal = true;
      signalType = 'sell';
    }
  }
  // 低い相互情報量（弱い相関）が検出された場合
  else if (avgMutualInfo < threshold * 0.5) {
    // 逆張り戦略を適用
    if (currentTrend > 0) {
      sellSignal = true;
      signalType = 'sell';
    } else if (currentTrend < 0) {
      buySignal = true;
      signalType = 'buy';
    }
  }

  // 戦略固有の計算結果
  const strategyResults = {
    mutualInfoScores,
    avgMutualInfo,
    threshold,
    currentTrend,
    analysisType: useReturns ? 'returns' : 'prices'
  };

  return {
    currentPrice,
    avgMutualInfo,
    currentTrend,
    signalType,
    buySignal,
    sellSignal,
    strategyResults
  };
}

/**
 * 相互情報量戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatMutualInformationLogInfo(signalResult) {
  const { currentPrice, avgMutualInfo, currentTrend, strategyResults } = signalResult;
  const { threshold, analysisType } = strategyResults;
  
  return {
    buy: `相互情報量: ${avgMutualInfo.toFixed(4)}, トレンド: ${currentTrend.toFixed(6)}, 分析: ${analysisType}`,
    sell: `相互情報量: ${avgMutualInfo.toFixed(4)}, トレンド: ${currentTrend.toFixed(6)}, 分析: ${analysisType}`,
    none: `相互情報量: ${avgMutualInfo.toFixed(4)}, トレンド: ${currentTrend.toFixed(6)}, 分析: ${analysisType}`,
    orderInfo: { avgMutualInfo, currentTrend, threshold },
    result: { 
      avgMutualInfo, 
      currentTrend, 
      currentPrice, 
      threshold, 
      analysisType,
      mutualInfoScores: strategyResults.mutualInfoScores 
    }
  };
}

module.exports = {
  mutualInformationStrategy,
  calculateMutualInformationSignals,
  formatMutualInformationLogInfo
};