/**
 * 戦略モジュールのエントリーポイント
 */

// 各戦略モジュールをインポート
const { calculateSMA, calculateEMA, calculateMACD, calculateRSI, calculateBollingerBands } = require('./indicators');
const { maStrategy, macdStrategy, rsiStrategy, bollingerBandsStrategy } = require('./trendFollowing');
const { meanReversionStrategy, oscillatorStrategy } = require('./meanReversion');
const { interExchangeArbitrage } = require('./arbitrage');
const { highFrequencyTrading, scalpingStrategy, orderCheckCancel } = require('./highFrequency');

// 戦略の種類を定義
const STRATEGY_TYPES = {
  TREND_FOLLOWING: 'trend_following',
  MEAN_REVERSION: 'mean_reversion',
  ARBITRAGE: 'arbitrage',
  HIGH_FREQUENCY: 'high_frequency'
};

// 戦略の詳細を定義
const STRATEGIES = {
  // トレンドフォロー戦略
  MA: {
    type: STRATEGY_TYPES.TREND_FOLLOWING,
    name: '移動平均線クロス',
    description: '短期と長期の移動平均線が交差する点を売買シグナルとするシンプルな戦略',
    function: maStrategy
  },
  MACD: {
    type: STRATEGY_TYPES.TREND_FOLLOWING,
    name: 'MACD',
    description: '2つの移動平均線の差と、その移動平均線を利用してトレンドの方向性や勢いを判断',
    function: macdStrategy
  },
  RSI: {
    type: STRATEGY_TYPES.TREND_FOLLOWING,
    name: 'RSI',
    description: '買われすぎや売られすぎの水準を判断し、反転を狙う指標',
    function: rsiStrategy
  },
  BOLLINGER_BANDS: {
    type: STRATEGY_TYPES.TREND_FOLLOWING,
    name: 'ボリンジャーバンド',
    description: '価格の変動幅を統計的に捉え、上限や下限に達した際に逆張りをする戦略や、バンド幅の拡大でトレンドの発生を予測する戦略',
    function: bollingerBandsStrategy
  },
  
  // 逆張り戦略
  MEAN_REVERSION: {
    type: STRATEGY_TYPES.MEAN_REVERSION,
    name: '平均回帰',
    description: '価格は長期的には平均値に戻るという考えに基づき、大きく乖離した際に逆張りをする戦略',
    function: meanReversionStrategy
  },
  OSCILLATOR: {
    type: STRATEGY_TYPES.MEAN_REVERSION,
    name: 'オシレーター系指標',
    description: 'RSIやストキャスティクスなどのオシレーター系指標が買われすぎや売られすぎの水準を示す際に、反転を狙う',
    function: oscillatorStrategy
  },
  
  // アービトラージ戦略
  INTER_EXCHANGE_ARBITRAGE: {
    type: STRATEGY_TYPES.ARBITRAGE,
    name: '価格差取引',
    description: '複数の取引所間でビットコインの価格差が生じた際に、安い取引所で買って高い取引所で売ることで利益を得る戦略',
    function: interExchangeArbitrage
  },
  
  // 高頻度取引戦略
  HFT: {
    type: STRATEGY_TYPES.HIGH_FREQUENCY,
    name: '高頻度取引',
    description: '極めて短い時間間隔で大量の取引を行い、小さな利益を積み重ねる戦略',
    function: highFrequencyTrading
  },
  SCALPING: {
    type: STRATEGY_TYPES.HIGH_FREQUENCY,
    name: 'スキャルピング',
    description: 'スプレッド（買値と売値の差）に基づいて取引を行う戦略',
    function: scalpingStrategy
  }
};

/**
 * 指定された戦略を実行する関数
 * @param {String} strategyKey - 実行する戦略のキー
 * @param {Object} params - 戦略に渡すパラメータ
 * @returns {Promise<Object>} - 戦略の実行結果
 */
async function executeStrategy(strategyKey, params) {
  const strategy = STRATEGIES[strategyKey];
  if (!strategy) {
    throw new Error(`指定された戦略が見つかりません: ${strategyKey}`);
  }
  
  return await strategy.function(...params);
}

/**
 * 利用可能な戦略の一覧を取得する関数
 * @param {String} type - 戦略タイプ（オプション）
 * @returns {Object} - 利用可能な戦略の一覧
 */
function getAvailableStrategies(type = null) {
  if (type) {
    const filteredStrategies = {};
    for (const [key, strategy] of Object.entries(STRATEGIES)) {
      if (strategy.type === type) {
        filteredStrategies[key] = {
          name: strategy.name,
          description: strategy.description
        };
      }
    }
    return filteredStrategies;
  }
  
  const availableStrategies = {};
  for (const [key, strategy] of Object.entries(STRATEGIES)) {
    availableStrategies[key] = {
      type: strategy.type,
      name: strategy.name,
      description: strategy.description
    };
  }
  return availableStrategies;
}

module.exports = {
  // 戦略タイプ
  STRATEGY_TYPES,
  
  // 戦略関数
  executeStrategy,
  getAvailableStrategies,
  
  // 指標計算関数
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands,
  
  // トレンドフォロー戦略
  maStrategy,
  macdStrategy,
  rsiStrategy,
  bollingerBandsStrategy,
  
  // 逆張り戦略
  meanReversionStrategy,
  oscillatorStrategy,
  
  // アービトラージ戦略
  interExchangeArbitrage,
  
  // 高頻度取引戦略
  highFrequencyTrading,
  scalpingStrategy,
  orderCheckCancel
};
