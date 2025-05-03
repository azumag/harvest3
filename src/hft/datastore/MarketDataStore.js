const EventEmitter = require('events');
const Logger = require('../utils/Logger'); // ロギングユーティリティを使用

class MarketDataStore extends EventEmitter {
  constructor() {
    super();
    this.data = {}; // 通貨ペアごとのデータを保持
    this.logger = new Logger('MarketDataStore');
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
    console.log(`Received order book for ${pair}: ${JSON.stringify(orderBookData)}`);
    const pairData = this.getOrCreatePairData(pair);
    // TODO: depth_whole と depth_diff の適用ロジックを実装
    // 現状は単純な上書き（depth_whole を想定）
    if (orderBookData.bids && orderBookData.asks) {
      pairData.orderBook = {
        bids: orderBookData.bids,
        asks: orderBookData.asks,
      };
      // TODO: イベント通知
    } else {
       this.logger.warn(`Invalid order book data for pair ${pair}`);
    }
    // イベント通知
    this.emit('orderBookUpdate', pair, pairData.orderBook);
  }

  /**
   * ティッカーデータを更新します。
   * @param {string} pair - 通貨ペア
   * @param {object} data - ティッカーデータ
   */
  updateTicker(pair, data) {
    // データ受信をログに出力
    console.log(`Received ticker for ${pair}: ${JSON.stringify(data)}`);
    
    this.tickers[pair] = data;
    this.emit('tickerUpdate', pair, data);
  }

  /**
   * 約定履歴データを追加します。
   * @param {string} pair - 通貨ペア
   * @param {Array<object>} transactions - 約定履歴の配列
   */
  addTransactions(pair, transactions) {
    const pairData = this.getOrCreatePairData(pair);
    // TODO: 履歴の蓄積ロジック（例: 最新N件を保持）
    pairData.transactions.push(...transactions);
    // イベント通知
    this.emit('transactionsUpdate', pair, pairData.transactions);
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

}

module.exports = MarketDataStore;