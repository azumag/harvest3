const Logger = require('../utils/Logger'); // ロギングユーティリティを使用
// TODO: OrderProcessor, MarketDataStore, データベースマネージャーなどをインポート

class HFTStrategy {
  constructor(pair, config, dataStore, orderProcessor) {
    this.pair = pair;
    this.config = config; // 戦略パラメータなどを含む設定
    this.dataStore = dataStore; // MarketDataStore インスタンス
    this.orderProcessor = orderProcessor; // OrderProcessor インスタンス
    this.logger = new Logger(`HFTStrategy:${pair}`);

    this.previousPrice = null; // 前回の中間価格を保持
    this.priceThreshold = config.STRATEGY_PARAMS.priceThreshold; // 価格変動閾値
    // TODO: その他の戦略に必要な状態やパラメータ
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
        // TODO: transactions などの他のデータタイプに対応
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
        // TODO: 取引実行ロジックをここに実装
        // 例: 買い圧力/売り圧力の分析、注文処理の呼び出し
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
    // TODO: ティッカーデータに基づいた処理を実装
    this.logger.debug(`Received ticker data for ${this.pair}:`, tickerData);
  }

  /**
   * トランザクションデータを処理します。
   * @param {object} transactionsData - トランザクションデータ
   */
  async processTransactions(transactionsData) {
    // TODO: トランザクションデータに基づいた処理を実装
    this.logger.debug(`Received transactions data for ${this.pair}:`, transactionsData);
  }

  // TODO: その他の戦略に必要なメソッド (例: ポジション管理、リスク管理)
}

module.exports = HFTStrategy;