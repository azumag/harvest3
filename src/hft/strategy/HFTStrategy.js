const Logger = require('../utils/Logger'); // ロギングユーティリティを使用
const { addTradeMongoDB } = require('../../database/manager');
const { sleep } = require('../../common/utils');

class HFTStrategy {
  constructor(pair, config, dataStore, orderProcessor) {
    this.pair = pair;
    this.config = config; // 戦略パラメータなどを含む設定
    this.dataStore = dataStore; // MarketDataStore インスタンス
    this.orderProcessor = orderProcessor; // OrderProcessor インスタンス
    this.logger = new Logger(`HFTStrategy:${pair}`);

    this.previousPrice = null; // 前回の中間価格を保持
    this.priceThreshold = config.STRATEGY_PARAMS.priceThreshold; // 価格変動閾値
    
    // 戦略状態管理
    this.positions = new Map(); // アクティブなポジション
    this.lastTradeTime = 0;
    this.tradeCount = 0;
    this.dailyPnL = 0;
    
    // リスク管理パラメータ
    this.maxPositionSize = config.STRATEGY_PARAMS.maxPositionSize || 0.1;
    this.minTradeInterval = config.STRATEGY_PARAMS.minTradeInterval || 1000; // 1秒
    this.maxDailyTrades = config.STRATEGY_PARAMS.maxDailyTrades || 100;
    this.stopLossPercent = config.STRATEGY_PARAMS.stopLossPercent || 0.02; // 2%
    
    // テクニカル指標管理
    this.priceHistory = [];
    this.volumeHistory = [];
    this.maxHistoryLength = 100;
  }

  /**
   * マーケットデータストアからの更新を受け取り、戦略ロジックを実行します。
   * @param {string} dataType - 更新されたデータの種類 (例: 'orderBook', 'ticker')
   * @param {object} data - 更新されたデータ
   */
  async processMarketData(dataType, data) {
    // デバッグ用ログ
    this.logger.debug(`Processing ${dataType} data for ${this.pair}`);

    try {
      switch (dataType) {
      case 'orderBook':
        await this.processOrderBook(data);
        break;
      case 'ticker':
        await this.processTicker(data);
        break;
      case 'transactions':
        await this.processTransactions(data);
        break;
      default:
        this.logger.warn(`Unknown data type received: ${dataType}`);
      }
    } catch (error) {
      this.logger.error(`Error processing market data for ${this.pair}:`, error);
    }
  }

  /**
   * 注文板データを処理し、取引判断を行います。
   * 計画の「3.5 HFT戦略ロジック」の例を参考に実装します。
   * @param {object} orderBookData - 注文板データ
   */
  async processOrderBook(orderBookData) {
    if (!orderBookData || !orderBookData.bids || orderBookData.bids.length === 0 || !orderBookData.asks || orderBookData.asks.length === 0) {
      this.logger.debug(`Received incomplete order book data for ${this.pair}`);
      return;
    }

    // 最良価格を取得
    const bestBid = parseFloat(orderBookData.bids[0][0]);
    const bestAsk = parseFloat(orderBookData.asks[0][0]);

    // 中間価格を計算
    const midPrice = (bestBid + bestAsk) / 2;

    if (this.previousPrice !== null) {
      // 価格変動を計算
      const priceChange = ((midPrice - this.previousPrice) / this.previousPrice) * 100;

      this.logger.debug(`💹 ${this.pair.toUpperCase()} | Mid: ¥${midPrice.toLocaleString()} | Change: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(4)}%`);

      // 取引判断
      if (Math.abs(priceChange) >= this.priceThreshold) {
        this.logger.info(`🎯 ${this.pair.toUpperCase()} | Threshold triggered! Change: ${priceChange >= 0 ? '📈+' : '📉'}${priceChange.toFixed(4)}%`);
        
        // 取引実行ロジック
        await this.executeTradingLogic({
          midPrice,
          priceChange,
          bestBid,
          bestAsk,
          orderBookData
        });
      }
    }

    // 価格を記録
    this.previousPrice = midPrice;
  }

  /**
   * ティッカーデータを処理します。
   * @param {object} tickerData - ティッカーデータ
   */
  async processTicker(tickerData) {
    try {
      if (!tickerData || !tickerData.last) {
        return;
      }
      
      const price = parseFloat(tickerData.last);
      const volume = parseFloat(tickerData.baseVolume) || 0;
      const timestamp = Date.now();
      
      // 価格履歴を更新
      this.priceHistory.push({ price, timestamp });
      this.volumeHistory.push({ volume, timestamp });
      
      // 履歴の長さを制限
      if (this.priceHistory.length > this.maxHistoryLength) {
        this.priceHistory.shift();
      }
      if (this.volumeHistory.length > this.maxHistoryLength) {
        this.volumeHistory.shift();
      }
      
      // ボラティリティ分析
      const volatility = this.calculateVolatility();
      const volumeProfile = this.analyzeVolumeProfile();
      
      this.logger.debug(`📈 ${this.pair.toUpperCase()} | Price: ¥${price.toLocaleString()} | Vol: ${volume.toFixed(2)} | Volatility: ${(volatility * 100).toFixed(2)}%`);
      
      // 高ボラティリティ時のリスク管理
      if (volatility > 0.05) { // 5%以上のボラティリティ
        this.logger.warn(`High volatility detected: ${(volatility * 100).toFixed(2)}%`);
        await this.adjustRiskParameters(volatility);
      }
      
    } catch (error) {
      this.logger.error(`Error processing ticker data for ${this.pair}:`, error);
    }
  }

  /**
   * トランザクションデータを処理します。
   * @param {object} transactionsData - トランザクションデータ
   */
  async processTransactions(transactionsData) {
    try {
      if (!transactionsData || !Array.isArray(transactionsData.transactions)) {
        return;
      }
      
      // 最新の取引を分析
      const recentTrades = transactionsData.transactions
        .filter(tx => Date.now() - tx.executed_at < 60000) // 直近1分以内
        .sort((a, b) => b.executed_at - a.executed_at);
      
      if (recentTrades.length === 0) {
        return;
      }
      
      // 出来高分析
      const volumeWeightedPrice = this.calculateVWAP(recentTrades);
      const buyPressure = this.calculateBuyPressure(recentTrades);
      const tradingMomentum = this.calculateMomentum(recentTrades);
      
      this.logger.debug(`🔄 ${this.pair.toUpperCase()} | VWAP: ¥${volumeWeightedPrice.toFixed(2)} | Buy Pressure: ${(buyPressure * 100).toFixed(1)}% | Momentum: ${tradingMomentum.toFixed(3)}`);
      
      // 取引シグナルの生成
      const signal = this.generateTradingSignal({
        vwap: volumeWeightedPrice,
        buyPressure,
        momentum: tradingMomentum,
        recentTrades
      });
      
      if (signal && signal.strength > 0.7) {
        this.logger.info(`🚨 Strong trading signal detected: ${signal.direction} (strength: ${signal.strength.toFixed(2)})`);
        // 強いシグナルの場合、取引を検討
        await this.considerTradeExecution(signal);
      }
      
    } catch (error) {
      this.logger.error(`Error processing transactions data for ${this.pair}:`, error);
    }
  }

  /**
   * 取引実行ロジック
   */
  async executeTradingLogic(marketData) {
    try {
      // リスクチェック
      if (!this.canTrade()) {
        return;
      }
      
      const { midPrice, priceChange, bestBid, bestAsk } = marketData;
      
      // ポジションサイズを計算
      const positionSize = this.calculatePositionSize(marketData);
      
      if (priceChange > 0) {
        // 上昇トレンド: 売りポジションを検討 (リバーション)
        await this.considerSellOrder(bestBid, positionSize);
      } else {
        // 下落トレンド: 買いポジションを検討 (リバーション)
        await this.considerBuyOrder(bestAsk, positionSize);
      }
      
    } catch (error) {
      this.logger.error(`Error in trading logic execution:`, error);
    }
  }
  
  /**
   * 取引可能かどうかをチェック
   */
  canTrade() {
    const now = Date.now();
    
    // 最小取引間隔チェック
    if (now - this.lastTradeTime < this.minTradeInterval) {
      return false;
    }
    
    // 日次取引回数制限
    if (this.tradeCount >= this.maxDailyTrades) {
      this.logger.warn('Daily trade limit reached');
      return false;
    }
    
    return true;
  }
  
  /**
   * ポジションサイズを計算
   */
  calculatePositionSize(marketData) {
    // シンプルなポジションサイジング
    return this.maxPositionSize;
  }
  
  /**
   * 買い注文を検討
   */
  async considerBuyOrder(price, amount) {
    try {
      const result = await this.orderProcessor.placeBuyOrder(this.pair, price, amount);
      
      // ポジションを記録
      this.positions.set(result.id, {
        id: result.id,
        side: 'buy',
        price,
        amount,
        timestamp: Date.now()
      });
      
      this.lastTradeTime = Date.now();
      this.tradeCount++;
      
      this.logger.info(`👇 Buy order placed: ${amount} @ ¥${price}`);
      
    } catch (error) {
      this.logger.error('Error placing buy order:', error);
    }
  }
  
  /**
   * 売り注文を検討
   */
  async considerSellOrder(price, amount) {
    try {
      const result = await this.orderProcessor.placeSellOrder(this.pair, price, amount);
      
      // ポジションを記録
      this.positions.set(result.id, {
        id: result.id,
        side: 'sell',
        price,
        amount,
        timestamp: Date.now()
      });
      
      this.lastTradeTime = Date.now();
      this.tradeCount++;
      
      this.logger.info(`👆 Sell order placed: ${amount} @ ¥${price}`);
      
    } catch (error) {
      this.logger.error('Error placing sell order:', error);
    }
  }
  
  /**
   * ボラティリティを計算
   */
  calculateVolatility() {
    if (this.priceHistory.length < 2) {
      return 0;
    }
    
    const returns = [];
    for (let i = 1; i < this.priceHistory.length; i++) {
      const return_ = (this.priceHistory[i].price - this.priceHistory[i-1].price) / this.priceHistory[i-1].price;
      returns.push(return_);
    }
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * 出来高プロファイルを分析
   */
  analyzeVolumeProfile() {
    if (this.volumeHistory.length === 0) {
      return { avgVolume: 0, trend: 'neutral' };
    }
    
    const volumes = this.volumeHistory.map(v => v.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    
    // ボリュームトレンドを判定
    const recentAvg = volumes.slice(-10).reduce((sum, v) => sum + v, 0) / Math.min(10, volumes.length);
    const trend = recentAvg > avgVolume * 1.2 ? 'increasing' : 
                  recentAvg < avgVolume * 0.8 ? 'decreasing' : 'neutral';
    
    return { avgVolume, trend };
  }
  
  /**
   * VWAP(出来高加重平均価格)を計算
   */
  calculateVWAP(trades) {
    if (trades.length === 0) return 0;
    
    let totalVolume = 0;
    let totalValue = 0;
    
    trades.forEach(trade => {
      const price = parseFloat(trade.price);
      const amount = parseFloat(trade.amount);
      totalValue += price * amount;
      totalVolume += amount;
    });
    
    return totalVolume > 0 ? totalValue / totalVolume : 0;
  }
  
  /**
   * 買い圧力を計算
   */
  calculateBuyPressure(trades) {
    if (trades.length === 0) return 0.5;
    
    const buyTrades = trades.filter(trade => trade.side === 'buy');
    return buyTrades.length / trades.length;
  }
  
  /**
   * 取引モメンタムを計算
   */
  calculateMomentum(trades) {
    if (trades.length < 2) return 0;
    
    // 直近の価格変化率を計算
    const latestPrice = parseFloat(trades[0].price);
    const earlierPrice = parseFloat(trades[trades.length - 1].price);
    
    return (latestPrice - earlierPrice) / earlierPrice;
  }
  
  /**
   * 取引シグナルを生成
   */
  generateTradingSignal(data) {
    const { buyPressure, momentum } = data;
    
    // シンプルなシグナル生成ロジック
    let direction = 'neutral';
    let strength = 0;
    
    if (buyPressure > 0.6 && momentum > 0.01) {
      direction = 'buy';
      strength = Math.min(buyPressure + Math.abs(momentum), 1.0);
    } else if (buyPressure < 0.4 && momentum < -0.01) {
      direction = 'sell';
      strength = Math.min((1 - buyPressure) + Math.abs(momentum), 1.0);
    }
    
    return { direction, strength };
  }
  
  /**
   * 取引実行を検討
   */
  async considerTradeExecution(signal) {
    // シグナルに基づいた取引実行ロジック
    // 現在はログ出力のみ
    this.logger.info(`Considering trade execution: ${signal.direction} with strength ${signal.strength}`);
  }
  
  /**
   * リスクパラメータを調整
   */
  async adjustRiskParameters(volatility) {
    // 高ボラティリティ時のリスク管理
    const adjustmentFactor = Math.min(volatility / 0.05, 2.0); // 最大2倍まで調整
    this.adjustedTradeInterval = this.minTradeInterval * adjustmentFactor;
    
    this.logger.info(`Risk parameters adjusted for high volatility: interval ${this.adjustedTradeInterval}ms`);
  }
}

module.exports = HFTStrategy;