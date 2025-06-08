const EventEmitter = require('events');
const Logger = require('../utils/Logger'); // ロギングユーティリティを使用

class MarketDataStore extends EventEmitter {
  constructor() {
    super();
    this.data = {}; // 通貨ペアごとのデータを保持
    this.logger = new Logger('MarketDataStore');
    this.maxTransactionHistory = 1000; // 保持する約定履歴の最大数
    this.dataValidation = true; // データ検証の有効/無効
  }

  /**
   * 指定された通貨ペアのデータを初期化または取得します。
   * @param {string} pair - 通貨ペア (例: 'btc_jpy')
   * @returns {object} - 通貨ペアのデータオブジェクト
   */
  getOrCreatePairData(pair) {
    if (!this.data[pair]) {
      this.data[pair] = {
        orderBook: { bids: [], asks: [] },
        ticker: null,
        transactions: [],
        // その他の必要なデータ構造
      };
      this.logger.info(`Initialized data store for pair: ${pair}`);
    }
    return this.data[pair];
  }

  /**
   * 注文板データを更新します。
   * @param {string} pair - 通貨ペア
   * @param {object} orderBookData - 注文板データ (depth_whole または depth_diff)
   */
  updateOrderBook(pair, orderBookData) {
    this.logger.debug(`Received order book for ${pair}`);
    
    // データ検証を実行
    if (this.dataValidation && !this._validateOrderBookData(pair, orderBookData)) {
      return; // 検証に失敗した場合は更新しない
    }
    
    const pairData = this.getOrCreatePairData(pair);
    
    if (orderBookData.bids && orderBookData.asks) {
      pairData.orderBook = {
        bids: orderBookData.bids,
        asks: orderBookData.asks,
        timestamp: orderBookData.timestamp || Date.now(),
        sequenceId: orderBookData.sequenceId
      };
      this.emit('orderBookUpdate', pair, pairData.orderBook);
    } else {
      this.logger.warn(`Invalid order book data structure for pair ${pair}`);
    }
  }

  /**
   * ティッカーデータを更新します。
   * @param {string} pair - 通貨ペア
   * @param {object} data - ティッカーデータ
   */
  updateTicker(pair, data) {
    // データ受信をログに出力
    this.logger.debug(`Received ticker for ${pair}: ${JSON.stringify(data)}`);
    
    // データ検証を実行
    if (this.dataValidation && !this._validateTickerData(pair, data)) {
      return; // 検証に失敗した場合は更新しない
    }
    
    const pairData = this.getOrCreatePairData(pair);
    pairData.ticker = data;
    this.emit('tickerUpdate', pair, data);
  }

  /**
   * 約定履歴データを追加します。
   * @param {string} pair - 通貨ペア
   * @param {Array<object>} transactions - 約定履歴の配列
   */
  addTransactions(pair, transactions) {
    if (!Array.isArray(transactions)) {
      this.logger.warn(`Invalid transactions data for pair ${pair}: not an array`);
      return;
    }
    
    const pairData = this.getOrCreatePairData(pair);
    
    // 検証済みのトランザクションのみを追加
    const validTransactions = transactions.filter(tx => 
      !this.dataValidation || this._validateTransactionData(pair, tx)
    );
    
    if (validTransactions.length > 0) {
      pairData.transactions.push(...validTransactions);
      
      // 古いトランザクションを削除（メモリ管理）
      if (pairData.transactions.length > this.maxTransactionHistory) {
        pairData.transactions = pairData.transactions.slice(-this.maxTransactionHistory);
      }
      
      this.emit('transactionsUpdate', pair, validTransactions);
    }
  }

  /**
   * 指定された通貨ペアの現在の注文板データを取得します。
   * @param {string} pair - 通貨ペア
   * @returns {object | null} - 注文板データ、存在しない場合はnull
   */
  getOrderBook(pair) {
    return this.data[pair] ? this.data[pair].orderBook : null;
  }

  /**
   * 指定された通貨ペアの現在のティッカーデータを取得します。
   * @param {string} pair - 通貨ペア
   * @returns {object | null} - ティッカーデータ、存在しない場合はnull
   */
  getTicker(pair) {
    return this.data[pair] ? this.data[pair].ticker : null;
  }

  /**
   * 指定された通貨ペアの約定履歴を取得します。
   * @param {string} pair - 通貨ペア
   * @returns {Array<object>} - 約定履歴の配列、存在しない場合は空の配列
   */
  getTransactions(pair) {
    return this.data[pair] ? this.data[pair].transactions : [];
  }

  /**
   * ティッカーデータの妥当性を検証します。
   * @private
   * @param {string} pair - 通貨ペア
   * @param {object} data - ティッカーデータ
   * @returns {boolean} - 検証結果
   */
  _validateTickerData(pair, data) {
    // 必須フィールドのチェック
    if (!data.sell || !data.buy || !data.last || !data.timestamp) {
      this.logger.error(`❌ Invalid ticker data for ${pair}: missing required fields`);
      return false;
    }
    
    // 価格の妥当性チェック
    const sell = parseFloat(data.sell);
    const buy = parseFloat(data.buy);
    const last = parseFloat(data.last);
    
    if (sell <= 0 || buy <= 0 || last <= 0) {
      this.logger.error(`❌ Invalid price data for ${pair}: negative or zero prices`);
      return false;
    }
    
    // スプレッドの妥当性チェック
    const spread = (sell - buy) / buy;
    if (spread < 0) {
      this.logger.error(`❌ Invalid spread for ${pair}: sell price is lower than buy price`);
      return false;
    }
    
    if (spread > 0.1) { // 10%以上のスプレッドは警告
      this.logger.warn(`⚠️ Abnormal spread for ${pair}: ${(spread * 100).toFixed(2)}%`);
    }
    
    // タイムスタンプの妥当性チェック
    const timestamp = parseInt(data.timestamp);
    const now = Date.now() / 1000;
    const timeDiff = Math.abs(now - timestamp);
    
    if (timeDiff > 300) { // 5分以上の差があれば警告
      this.logger.warn(`⚠️ Stale ticker data for ${pair}: ${timeDiff}s old`);
    }
    
    return true;
  }

  /**
   * 注文板データの妥当性を検証します。
   * @private
   * @param {string} pair - 通貨ペア
   * @param {object} data - 注文板データ
   * @returns {boolean} - 検証結果
   */
  _validateOrderBookData(pair, data) {
    if (!data.bids || !data.asks) {
      this.logger.error(`❌ Invalid order book data for ${pair}: missing bids or asks`);
      return false;
    }
    
    if (!Array.isArray(data.bids) || !Array.isArray(data.asks)) {
      this.logger.error(`❌ Invalid order book data for ${pair}: bids/asks not arrays`);
      return false;
    }
    
    // 価格の順序チェック（bidsは降順、asksは昇順）
    if (data.bids.length > 1) {
      for (let i = 1; i < data.bids.length; i++) {
        if (parseFloat(data.bids[i][0]) >= parseFloat(data.bids[i-1][0])) {
          this.logger.warn(`⚠️ Invalid bid order for ${pair}`);
        }
      }
    }
    
    if (data.asks.length > 1) {
      for (let i = 1; i < data.asks.length; i++) {
        if (parseFloat(data.asks[i][0]) <= parseFloat(data.asks[i-1][0])) {
          this.logger.warn(`⚠️ Invalid ask order for ${pair}`);
        }
      }
    }
    
    // 最良気配のチェック
    if (data.bids.length > 0 && data.asks.length > 0) {
      const bestBid = parseFloat(data.bids[0][0]);
      const bestAsk = parseFloat(data.asks[0][0]);
      
      if (bestBid >= bestAsk) {
        this.logger.error(`❌ Invalid order book for ${pair}: bid >= ask`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * 約定データの妥当性を検証します。
   * @private
   * @param {string} pair - 通貨ペア
   * @param {object} tx - 約定データ
   * @returns {boolean} - 検証結果
   */
  _validateTransactionData(pair, tx) {
    if (!tx.transaction_id || !tx.side || !tx.price || !tx.amount || !tx.executed_at) {
      this.logger.warn(`⚠️ Invalid transaction data for ${pair}: missing required fields`);
      return false;
    }
    
    const price = parseFloat(tx.price);
    const amount = parseFloat(tx.amount);
    
    if (price <= 0 || amount <= 0) {
      this.logger.warn(`⚠️ Invalid transaction values for ${pair}`);
      return false;
    }
    
    if (tx.side !== 'buy' && tx.side !== 'sell') {
      this.logger.warn(`⚠️ Invalid transaction side for ${pair}: ${tx.side}`);
      return false;
    }
    
    return true;
  }

  /**
   * データストアの統計情報を取得します。
   * @returns {object} - 統計情報
   */
  getStats() {
    const stats = {
      pairs: Object.keys(this.data).length,
      totalTransactions: 0,
      dataByPair: {}
    };
    
    for (const [pair, data] of Object.entries(this.data)) {
      stats.totalTransactions += data.transactions.length;
      stats.dataByPair[pair] = {
        hasOrderBook: !!data.orderBook && (data.orderBook.bids.length > 0 || data.orderBook.asks.length > 0),
        hasTicker: !!data.ticker,
        transactionCount: data.transactions.length
      };
    }
    
    return stats;
  }

}

module.exports = MarketDataStore;