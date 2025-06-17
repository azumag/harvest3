/**
 * 相互情報量戦略 v2.0
 * 統計的ペアトレーディングと動的ペア選択を基盤とした改良版戦略
 * Issue #149: 実用的な実装への再設計
 */
const {
  calculateMutualInformation,
  calculateMutualInformationMatrix,
  calculateReturns,
  calculateSMA
} = require('./utils/indicators');

const {
  calculatePearsonCorrelation,
  calculateSpearmanCorrelation,
  calculateSpread,
  calculateZScore,
  calculateHalfLife,
  DynamicPairSelector,
  StatisticalPairTrading
} = require('./utils/correlation');

const { 
  fetchAndValidateOHLCVData, 
  handleStrategySignals, 
} = require('./utils/common');

const { addSignal, fetchTicker } = require('../database/manager');
const { postErrorToDiscord } = require('../common/notifications');

// グローバルインスタンス（状態管理用）
let globalPairSelector = null;
let globalPairTrading = null;

/**
 * 改良版相互情報量戦略
 * 動的ペア選択と統計的ペアトレーディングを組み合わせた実用的な実装
 */
async function mutualInformationStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
  const { 
    period = 30, 
    threshold = 0.7, 
    ohlcvInterval = '5m',
    useReturns = true,
    maxReferencePairs = 5,
    enablePairTrading = true,
    correlationWindow = 20,
    zScoreThreshold = 2.0,
    strategy_mode = 'enhanced' // 'legacy' | 'enhanced' | 'pair_trading'
  } = config;
  
  // グローバルインスタンスの初期化
  if (!globalPairSelector) {
    globalPairSelector = new DynamicPairSelector();
  }
  if (!globalPairTrading) {
    globalPairTrading = new StatisticalPairTrading({
      lookbackPeriod: period,
      entryZScore: zScoreThreshold,
      exitZScore: 0.5,
      minCorrelation: threshold
    });
  }
  
  let { referenceSymbols = ['BTC/USDT'] } = config;

  // 動的ペア選択の使用
  if (strategy_mode === 'enhanced' && options.referenceSymbols) {
    const selectedPairs = globalPairSelector.selectReferencePairs(
      symbol, 
      options.referenceSymbols, 
      maxReferencePairs
    );
    referenceSymbols = selectedPairs.length > 0 ? selectedPairs : referenceSymbols;
  } else if (options.referenceSymbols && Array.isArray(options.referenceSymbols)) {
    referenceSymbols = options.referenceSymbols;
  } else if (referenceSymbols === 'all' && options.referenceSymbols) {
    referenceSymbols = options.referenceSymbols;
  }

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
        // 参照シンボルに対応する取引所を見つける
        let refExchange = exchange; // デフォルトは現在の取引所
        
        if (options.allExchangeSymbolPairs) {
          const symbolPair = options.allExchangeSymbolPairs.find(pair => pair.symbol === refSymbol);
          if (symbolPair && symbolPair.exchangeId !== exchange.id) {
            // 異なる取引所の場合、適切な取引所インスタンスを取得
            // configは引数で受け取ったものを使用
            if (options.config && options.config.exchanges) {
              const refExchangeConfig = options.config.exchanges[symbolPair.exchangeId];
              if (refExchangeConfig) {
                refExchange = refExchangeConfig.instance;
              }
            }
          }
        }
        
        const refValidatedData = await fetchAndValidateOHLCVData(
          refExchange, 
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
            exchangeId: refExchange.id,
            closes: refValidatedData.closes
          });
          // console.log(`参照シンボル ${refSymbol} のデータを取引所 ${refExchange.id} から取得しました`);
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

    // 戦略モードに応じたシグナル計算
    let signalResult;
    
    if (strategy_mode === 'pair_trading' && enablePairTrading) {
      signalResult = await calculatePairTradingSignals(
        mainCloses,
        referenceData,
        period,
        threshold,
        exchange,
        symbol,
        strategyKey,
        options
      );
    } else if (strategy_mode === 'enhanced') {
      signalResult = await calculateEnhancedMutualInformationSignals(
        mainCloses,
        referenceData,
        period,
        threshold,
        exchange,
        symbol,
        strategyKey,
        useReturns,
        correlationWindow,
        options
      );
    } else {
      // レガシーモード
      signalResult = await calculateMutualInformationSignals(
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
    }

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
      options,
      options.config
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
 * 改良版相互情報量戦略のシグナルを計算する
 * @param {Array} mainCloses メインシンボルの終値配列
 * @param {Array} referenceData 参照シンボルのデータ配列
 * @param {number} period 分析期間
 * @param {number} threshold シグナル閾値
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @param {boolean} useReturns リターンを使用するかどうか
 * @param {number} correlationWindow 相関計算期間
 * @returns {Object} シグナル計算結果
 */
async function calculateEnhancedMutualInformationSignals(
  mainCloses, 
  referenceData, 
  period, 
  threshold, 
  exchange, 
  symbol, 
  strategyKey, 
  useReturns,
  correlationWindow,
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
  
  if (minLength < correlationWindow) {
    console.log(`改良版相互情報量戦略: データが不足しています ${symbol}, minLength: ${minLength}`);
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

  // 効率的な相関計算（ピアソン + スピアマン）
  const correlationScores = referenceDataForAnalysis.map(ref => {
    const pearson = calculatePearsonCorrelation(mainData, ref.data);
    const spearman = calculateSpearmanCorrelation(mainData, ref.data);
    const mutualInfo = calculateMutualInformation(mainData, ref.data);
    
    // 複合スコア：ピアソン相関 + スピアマン相関 + 相互情報量
    const compositeScore = (Math.abs(pearson) * 0.4 + Math.abs(spearman) * 0.3 + mutualInfo * 0.3);
    
    return {
      symbol: ref.symbol,
      pearson,
      spearman, 
      mutualInfo,
      compositeScore,
      direction: pearson > 0 ? 1 : -1
    };
  });

  // 信頼性の高い相関のみを使用
  const reliableCorrelations = correlationScores.filter(score => 
    score.compositeScore > threshold && Math.abs(score.pearson) > 0.3
  );

  if (reliableCorrelations.length === 0) {
    return {
      currentPrice: await getCurrentPrice(exchange, symbol, options),
      signalType: 'none',
      buySignal: false,
      sellSignal: false,
      reason: '信頼性の高い相関が見つかりません',
      strategyResults: {
        correlationScores,
        reliableCount: 0,
        mode: 'enhanced'
      }
    };
  }

  // 加重平均でシグナル強度を計算
  const totalWeight = reliableCorrelations.reduce((sum, score) => sum + score.compositeScore, 0);
  const weightedDirection = reliableCorrelations.reduce((sum, score) => 
    sum + (score.direction * score.compositeScore), 0) / totalWeight;

  // 現在の価格とトレンドを分析
  const currentPrice = await getCurrentPrice(exchange, symbol, options);
  const shortMA = calculateSMA(recentMainCloses, Math.min(5, recentMainCloses.length - 1));
  const currentTrend = shortMA[shortMA.length - 1] - shortMA[shortMA.length - 2];

  // シグナル生成（改良版）
  const signalStrength = Math.abs(weightedDirection);
  const trendAlignment = (weightedDirection * currentTrend) > 0;
  
  let signalType = 'none';
  let buySignal = false;
  let sellSignal = false;
  
  // 強い信号かつトレンドと一致する場合のみエントリー
  if (signalStrength > 0.6 && trendAlignment) {
    if (weightedDirection > 0 && currentTrend > 0) {
      buySignal = true;
      signalType = 'buy';
    } else if (weightedDirection < 0 && currentTrend < 0) {
      sellSignal = true;
      signalType = 'sell';
    }
  }
  
  // 相関履歴を記録（動的ペア選択のため）
  reliableCorrelations.forEach(score => {
    globalPairSelector.recordCorrelation(
      symbol, 
      score.symbol, 
      score.pearson,
      0 // 利益は後で更新される
    );
  });

  return {
    currentPrice,
    weightedDirection,
    signalStrength,
    currentTrend,
    signalType,
    buySignal,
    sellSignal,
    trendAlignment,
    strategyResults: {
      correlationScores,
      reliableCorrelations,
      threshold,
      mode: 'enhanced',
      analysisType: useReturns ? 'returns' : 'prices'
    }
  };
}

/**
 * 統計的ペアトレーディングシグナルを計算する
 */
async function calculatePairTradingSignals(
  mainCloses, 
  referenceData, 
  period, 
  threshold, 
  exchange, 
  symbol, 
  strategyKey,
  options = {}
) {
  // ペアトレーディング用のデータ準備
  const symbolsData = { [symbol]: mainCloses };
  referenceData.forEach(ref => {
    symbolsData[ref.symbol] = ref.closes;
  });

  // 取引ペアの発見
  const tradingPairs = await globalPairTrading.findTradingPairs(symbolsData);
  
  if (tradingPairs.length === 0) {
    return {
      currentPrice: await getCurrentPrice(exchange, symbol, options),
      signalType: 'none',
      buySignal: false,
      sellSignal: false,
      reason: '適切なペアトレーディング機会が見つかりません',
      strategyResults: {
        mode: 'pair_trading',
        pairsFound: 0
      }
    };
  }

  // 最も有望なペアを選択
  const bestPair = tradingPairs[0];
  const pairSignal = globalPairTrading.generatePairTradeSignal(
    bestPair,
    symbolsData[bestPair.symbol1],
    symbolsData[bestPair.symbol2]
  );

  if (!pairSignal) {
    return {
      currentPrice: await getCurrentPrice(exchange, symbol, options),
      signalType: 'none',
      buySignal: false,
      sellSignal: false,
      reason: 'ペアトレーディングシグナルが生成されませんでした',
      strategyResults: {
        mode: 'pair_trading',
        bestPair,
        pairsFound: tradingPairs.length
      }
    };
  }

  // シンボルがロングまたはショートの対象かチェック
  const isLong = pairSignal.long === symbol;
  const isShort = pairSignal.short === symbol;
  
  if (!isLong && !isShort) {
    return {
      currentPrice: await getCurrentPrice(exchange, symbol, options),
      signalType: 'none',
      buySignal: false,
      sellSignal: false,
      reason: '現在のシンボルはペアトレーディング対象外',
      strategyResults: {
        mode: 'pair_trading',
        bestPair,
        pairSignal
      }
    };
  }

  return {
    currentPrice: await getCurrentPrice(exchange, symbol, options),
    signalType: isLong ? 'buy' : 'sell',
    buySignal: isLong,
    sellSignal: isShort,
    confidence: pairSignal.confidence,
    zScore: pairSignal.zScore,
    strategyResults: {
      mode: 'pair_trading',
      bestPair,
      pairSignal,
      entryType: pairSignal.entryType
    }
  };
}

/**
 * レガシー相互情報量戦略のシグナルを計算する（下位互換性のため）
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

  // レガシーシグナル生成ロジック
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
    analysisType: useReturns ? 'returns' : 'prices',
    mode: 'legacy'
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
 * 改良版相互情報量戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatMutualInformationLogInfo(signalResult) {
  const { currentPrice, strategyResults } = signalResult;
  const { mode } = strategyResults;
  
  if (mode === 'enhanced') {
    const { weightedDirection, signalStrength, currentTrend, reliableCorrelations } = signalResult;
    const { threshold, analysisType } = strategyResults;
    
    const correlationInfo = reliableCorrelations ? reliableCorrelations.map(score => 
      `${score.symbol}:${score.compositeScore.toFixed(3)}`
    ).join(', ') : 'なし';
    
    const logMessage = `重み方向: ${weightedDirection?.toFixed(4) || 'N/A'}, 信号強度: ${signalStrength?.toFixed(4) || 'N/A'}, トレンド: ${currentTrend?.toFixed(6) || 'N/A'}, 分析: ${analysisType || 'N/A'}, 相関: [${correlationInfo}]`;
    
    return {
      buy: logMessage,
      sell: logMessage,
      none: logMessage,
      orderInfo: { weightedDirection, signalStrength, currentTrend, threshold },
      result: { 
        weightedDirection, 
        signalStrength,
        currentTrend, 
        currentPrice, 
        threshold, 
        analysisType,
        mode: 'enhanced',
        reliableCorrelations: strategyResults.reliableCorrelations 
      }
    };
  } else if (mode === 'pair_trading') {
    const { confidence, zScore, bestPair } = signalResult;
    const pairInfo = bestPair ? `${bestPair.symbol1}/${bestPair.symbol2}` : 'なし';
    
    const logMessage = `ペア: ${pairInfo}, 信頼度: ${confidence?.toFixed(4) || 'N/A'}, Z-score: ${zScore?.toFixed(4) || 'N/A'}, モード: ペアトレーディング`;
    
    return {
      buy: logMessage,
      sell: logMessage,
      none: logMessage,
      orderInfo: { confidence, zScore, pairInfo },
      result: { 
        confidence,
        zScore,
        currentPrice, 
        pairInfo,
        mode: 'pair_trading',
        bestPair: strategyResults.bestPair
      }
    };
  } else {
    // レガシーモード
    const { avgMutualInfo, currentTrend } = signalResult;
    const { threshold, analysisType, mutualInfoScores } = strategyResults;
    
    const referenceInfo = mutualInfoScores ? mutualInfoScores.map(score => 
      `${score.symbol}:${score.mutualInfo.toFixed(3)}`
    ).join(', ') : 'なし';
    
    const logMessage = `相互情報量: ${avgMutualInfo?.toFixed(4) || 'N/A'}, トレンド: ${currentTrend?.toFixed(6) || 'N/A'}, 分析: ${analysisType}, 参照: [${referenceInfo}] (レガシー)`;
    
    return {
      buy: logMessage,
      sell: logMessage,
      none: logMessage,
      orderInfo: { avgMutualInfo, currentTrend, threshold },
      result: { 
        avgMutualInfo, 
        currentTrend, 
        currentPrice, 
        threshold, 
        analysisType,
        mode: 'legacy',
        mutualInfoScores: strategyResults.mutualInfoScores 
      }
    };
  }
}

/**
 * 現在の価格を取得するヘルパー関数
 */
async function getCurrentPrice(exchange, symbol, options) {
  try {
    const ticker = await fetchTicker(exchange, symbol, options);
    return ticker.last;
  } catch (error) {
    console.warn(`価格取得に失敗: ${symbol}`, error.message);
    return null;
  }
}

module.exports = {
  mutualInformationStrategy,
  calculateMutualInformationSignals,
  calculateEnhancedMutualInformationSignals,
  calculatePairTradingSignals,
  formatMutualInformationLogInfo,
  // ユーティリティクラスのエクスポート
  DynamicPairSelector,
  StatisticalPairTrading
};