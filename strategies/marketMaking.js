const ccxt = require('ccxt'); // ccxtが必要な場合はインポート

const { updateFilledTrades } = require('../src/utils.js');
const { getOrderPairs, saveOrderPairs, getCurrentOrderPair, setCurrentOrderPair } = require('../src/redisDatabase.js');

/**
 * 保存された orderPairs 配列から activeOrders オブジェクトを再構築する
 * @param {Array<Object>} orderPairs - 保存された注文ペアの配列
 * @returns {Object} 再構築された activeOrders オブジェクト { buy: order|null, sell: order|null }
 */
function rebuildActiveOrders(orderPairs) {
  let activeBuy = null;
  let activeSell = null;

  // orderPairs を走査して、最新の未約定の買い注文と売り注文を見つける
  // ここでは単純に配列の最後に見つかった未約定注文を最新とする
  for (const pair of orderPairs) {
    if (pair.buyOrder && !pair.buyFilled) {
      activeBuy = pair.buyOrder; // 上書きしていく
    }
    if (pair.sellOrder && !pair.sellFilled) {
      activeSell = pair.sellOrder; // 上書きしていく
    }
  }

  console.log(`[MM Restore] Active orders rebuilt: Buy=${activeBuy?.id || 'None'}, Sell=${activeSell?.id || 'None'}`);
  return { buy: activeBuy, sell: activeSell };
}

/**
 * レンジ相場向け受動的マーケットメイキング戦略クラス
 */
class MarketMakingStrategy {
  /**
   * コンストラクタ
   * @param {Object} exchange - ccxtの取引所オブジェクト
   * @param {String} symbol - 通貨ペア
   * @param {Object} options - 戦略オプション
   */
  constructor(exchange, symbol, options = {}) {
    this.exchange = exchange;
    this.symbol = symbol;
    this.market = this.exchange.markets[this.symbol];
    if (!this.market) {
      throw new Error(`マーケットデータが取得できませんでした: ${this.symbol}`);
    }

    // オプションのデフォルト値とマージ
    this.options = {
      rangePeriod: 300000, // レンジ判定期間（ミリ秒）
      rangeThreshold: 1.0, // レンジ判定閾値（%）
      spreadWidth: 0.5, // スプレッド幅（%）
      amount: undefined, // 取引量 (必須)
      targetQuote: 100, // 目標クォート価格 (JPY)
      pricePrecision: this.market.precision?.price || 8,
      amountPrecision: this.market.precision?.amount || 4,
      postOrderToDiscord: null,
      postErrorToDiscord: null,
      reorderInterval: 60000, // 再発注間隔（ミリ秒）
      maxPositionCount: 2, // 最大ポジション数
      adjustmentValue: 0, // 微調整値
      updateTradeRecord: null,
      tradeRecords: {},
      baseMinTradeAmount: this.market.limits?.amount?.min || 0.0001, // 取引所の最小取引量を使用
      priceHistoryUpdateInterval: 10000, // 価格履歴の更新間隔（ミリ秒）
      orderStatusCheckInterval: 30000, // 注文状態の直接確認間隔（ミリ秒）
      cancelThreshold: 0.01, // 1%の価格変動でキャンセル
      loopInterval: 1000, // メインループの間隔（ミリ秒）
      errorRetryInterval: 5000, // エラー発生時のリトライ間隔（ミリ秒）
      ...options,
    };

    // BTC/JPY 特有の最小取引量を設定 (必要であれば)
    // if (this.symbol === 'BTC/JPY') {
    //   this.options.baseMinTradeAmount = Math.max(this.options.baseMinTradeAmount, 0.0001);
    // } else {
    //   // 他のは0.001をデフォルトに
    //   this.options.baseMinTradeAmount = Math.max(this.options.baseMinTradeAmount, 0.001);
    // }

    if (this.options.amount === undefined) {
      throw new Error('取引量(amount)オプションは必須です。');
    }

    // 状態変数
    this.orderHistory = [];
    this.activeOrders = { buy: null, sell: null };
    this.orderPairs = [{
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      buyOrder: null,
      sellOrder: null,
      buyFilled: false,
      sellFilled: false,
      amount: 0
    }];
    this.priceHistory = [];
    this.lastPriceHistoryUpdate = 0;
    this.lastOrderStatusCheck = 0;
    this.lastOrderTime = 0;
    this.currentPositions = 0; // ポジション管理 (より正確な管理が必要な場合は別途実装)
    this.isRunning = false;

    this._validateOptions();
  }

  /**
   * オプションのバリデーション
   * @private
   */
  _validateOptions() {
    if (typeof this.options.amount !== 'number' || this.options.amount <= 0) {
      throw new Error('取引量(amount)は正の数値である必要があります。');
    }
    // 他のオプションのバリデーションもここに追加可能
  }

  /**
   * Discordに注文情報を投稿する (オプション)
   * @private
   * @param {String} message - 投稿メッセージ
   */
  async _postOrder(message) {
    if (this.options.postOrderToDiscord) {
      try {
        await this.options.postOrderToDiscord(`[MM] ${this.exchange.id} - ${this.symbol}: ${message}`);
      } catch (error) {
        console.error(`${this.symbol}: Discordへの注文投稿中にエラー:`, error);
      }
    }
  }

  /**
   * Discordにエラー情報を投稿する (オプション)
   * @private
   * @param {String} message - 投稿メッセージ
   * @param {Error} [error=null] - エラーオブジェクト
   */
  async _postError(message, error = null) {
    const errorMessage = error ? `${message} - ${error.message}` : message;
    console.error(`[MM Error] ${this.exchange.id} - ${this.symbol}: ${errorMessage}`, error || '');
    if (this.options.postErrorToDiscord) {
      try {
        await this.options.postErrorToDiscord(`[MM Error] ${this.exchange.id} - ${this.symbol}: ${errorMessage}`);
      } catch (discordError) {
        console.error('Discordへのエラー投稿中にエラー:', discordError);
      }
    }
  }

  /**
   * 取引記録を更新する (オプション)
   * @private
   * @param {String} side - 'buy' または 'sell'
   * @param {Number} price - 価格
   * @param {Number} amount - 量
   */
  _updateTradeRecord(side, price, amount, orderId, orderType) {
    if (this.options.updateTradeRecord) {
      try {
        this.options.updateTradeRecord(this.exchange.id, this.symbol, amount, price, side, orderId, orderType);
      } catch (error) {
        console.error(`${this.symbol}: 取引記録の更新中にエラー:`, error);
      }
    }
    // ポジション数の簡易更新 (より正確な管理が必要な場合あり)
    if (side === 'buy') {
      this.currentPositions += amount;
    } else if (side === 'sell') {
      this.currentPositions -= amount;
    }
  }

  /**
   * 価格履歴を更新する
   * @private
   */
  async _updatePriceHistory() {
    const now = Date.now();
    if (now - this.lastPriceHistoryUpdate >= this.options.priceHistoryUpdateInterval) {
      try {
        const ticker = await this.exchange.fetchTicker(this.symbol);
        if (ticker && ticker.last) {
          this.priceHistory.push({ time: now, price: ticker.last });
          // 古い履歴を削除
          while (this.priceHistory.length > 0 && now - this.priceHistory[0].time > this.options.rangePeriod) {
            this.priceHistory.shift();
          }
          this.lastPriceHistoryUpdate = now;
        }
      } catch (error) {
        await this._postError('価格履歴の更新中にエラーが発生しました', error);
      }
    }
  }

  /**
   * レンジ相場かどうかを判定する
   * @private
   * @returns {Boolean} レンジ相場であればtrue
   */
  _isRangeMarket() {
    if (this.priceHistory.length < 2) {
      console.log(`${this.symbol}: 価格履歴が不足しています - ${this.priceHistory.length}件`);
      return false; // 価格履歴が少ない場合はレンジとみなさない（または別の判断）
    }
    const prices = this.priceHistory.map(item => item.price);
    const highPrice = Math.max(...prices);
    const lowPrice = Math.min(...prices);
    // ゼロ除算を避ける
    if (lowPrice <= 0) return false;
    const priceRange = ((highPrice - lowPrice) / lowPrice) * 100;
    const isRange = priceRange <= this.options.rangeThreshold;

    if (isRange) {
      console.log(`${this.symbol}: レンジ相場を検出 - 価格変動: ${priceRange.toFixed(2)}% (閾値: ${this.options.rangeThreshold}%)`);
    } else {
      console.log(`${this.symbol}: レンジ相場ではありません - 価格変動: ${priceRange.toFixed(2)}% (閾値: ${this.options.rangeThreshold}%)`);
    }
    return isRange;
  }

  /**
   * 注文ステータスをチェックし、必要に応じて更新・キャンセルする
   * @private
   */
  async _checkAndUpdateOrders() {
    const now = Date.now();
    if (now - this.lastOrderStatusCheck >= this.options.orderStatusCheckInterval) {
      try {
        const openOrders = await this.exchange.fetchOpenOrders(this.symbol);
        const activeOrderIds = openOrders.map(order => order.id);
        const ticker = await this.exchange.fetchTicker(this.symbol);
        const currentPrice = ticker.last;

        console.log(`${this.symbol}: 注文状態チェック - アクティブな注文数: ${openOrders.length}, 現在価格: ${currentPrice}`);

        if (this.orderPairs.length > 0) {
          const pair = this.orderPairs[0];
          await this._checkSingleOrderStatus(pair, 'buy', activeOrderIds, currentPrice);
          await this._checkSingleOrderStatus(pair, 'sell', activeOrderIds, currentPrice);

          if (pair.buyFilled && pair.sellFilled) {
            console.log(`${this.symbol}: 注文ペア(${pair.id})が完了しました - 次回のクリーンアップ時に削除されます`);
          }
        }
        this.lastOrderStatusCheck = now;
      } catch (error) {
        await this._postError('注文状態の定期確認中にエラーが発生しました', error);
      }
    }
  }

  /**
   * 個別の注文ステータスを確認・処理する
   * @private
   * @param {Object} pair - 注文ペアオブジェクト
   * @param {String} side - 'buy' または 'sell'
   * @param {Array<String>} activeOrderIds - 現在アクティブな注文IDのリスト
   * @param {Number} currentPrice - 現在価格
   */
  async _checkSingleOrderStatus(pair, side, activeOrderIds, currentPrice) {
    const isBuySide = side === 'buy';
    const orderKey = isBuySide ? 'buyOrder' : 'sellOrder';
    const filledKey = isBuySide ? 'buyFilled' : 'sellFilled';
    const oppositeFilledKey = isBuySide ? 'sellFilled' : 'buyFilled';

    if (!pair[orderKey] || pair[filledKey]) {
      return; // 注文がないか、既に約定済み
    }

    const order = pair[orderKey];

    // 注文がアクティブリストにない場合 -> 約定 or キャンセル済み or 存在しない
    if (!activeOrderIds.includes(order.id)) {
      try {
        // fetchOrderが利用可能か確認
        if (this.exchange.has && this.exchange.has['fetchOrder']) {
            const orderStatus = await this.exchange.fetchOrder(order.id, this.symbol);
            if (orderStatus.status === 'closed' || orderStatus.status === 'filled') {
                console.log(`${this.symbol}: ${side}注文(${order.id})が約定しました (個別確認)`);
                pair[filledKey] = true;
                // 約定した場合、ポジション数を更新 (取引記録更新時に行われている場合は不要かも)
                // this._updatePositionOnFill(side, order.amount);
                await updateFilledTrades(this.exchange, this.symbol);
                
                return; // 約定したので以降の処理は不要
            }
            // closed/filled 以外 (canceledなど) の場合もアクティブではないのでリセットへ
        } else {
            // fetchOrder が使えない場合は、アクティブでない＝約定したとみなすか、エラーとするか要検討
            // ここでは一旦、約定した可能性が高いとしてマークする（より堅牢な確認が必要）
            // 約定扱いをやめ、下のキャンセル処理に進むように修正
            console.warn(`${this.symbol}: fetchOrderが利用不可のため、${side}注文(${order.id})の状態を確定できません。キャンセル扱いとして処理します。`);
            // pair[filledKey] = true; // 約定扱いはしない
            // return せずに下のキャンセル処理に進む
        }
      } catch (error) {
        // fetchOrderでエラーが発生した場合 (例: 注文が存在しない)
        // ネットワークエラー等の可能性もあるため、単純にキャンセル扱いにするのは危険かもしれない
        // ここではログを出力し、キャンセル扱いとする
        console.log(`${this.symbol}: ${side}注文(${order.id})のステータス確認中にエラー、または注文が存在しません: ${error.message}`);
      }

      // 約定していなかった場合 (キャンセルされたか、エラーで確認できなかった)
      console.log(`${this.symbol}: ${side}注文(${order.id})はアクティブではありません - キャンセルまたは不明として処理`);
      this._updateOrderHistory(order.id, true); // 処理済みキャンセルとしてマーク
      this._resetOrderState(pair, side);
      return;
    }

    // 注文がアクティブリストにある場合
    // 反対側の注文が約定済みかチェック
    if (pair[oppositeFilledKey]) {
      const priceDifference = Math.abs(order.price - currentPrice) / currentPrice;
      if (priceDifference >= this.options.cancelThreshold) {
        console.log(`${this.symbol}: ${side}注文(${order.id})は価格差が大きいためキャンセルします - 注文価格: ${order.price}, 現在価格: ${currentPrice}, 差: ${(priceDifference * 100).toFixed(2)}%`);
        try {
          await this.exchange.cancelOrder(order.id, this.symbol);
          this._updateOrderHistory(order.id, true); // キャンセル済みとしてマーク
          this._resetOrderState(pair, side);
        } catch (cancelError) {
          // キャンセル失敗時の処理 (APIエラー、既に約定など)
          // すでに約定していたケースを考慮し、再度ステータスを確認するなどの処理が必要な場合がある
          await this._postError(`${side}注文(${order.id})のキャンセル中にエラーが発生しました`, cancelError);
          // キャンセル失敗した場合でも、次のチェックで再度試行されるか、約定が確認される
        }
      } else {
        console.log(`${this.symbol}: ${side}注文(${order.id})は価格差が許容範囲内です - 注文価格: ${order.price}, 現在価格: ${currentPrice}, 差: ${(priceDifference * 100).toFixed(2)}%`);
      }
    }
    // 両方の注文がアクティブな場合は何もしない
  }


  /**
   * 注文履歴を更新する
   * @private
   * @param {String} orderId - 注文ID
   * @param {Boolean} processedCancel - キャンセル処理済みフラグ
   */
  _updateOrderHistory(orderId, processedCancel = false) {
    const index = this.orderHistory.findIndex(h => h.orderId === orderId);
    if (index !== -1) {
      this.orderHistory[index].processedCancel = processedCancel;
    }
  }

  /**
   * 注文ペアの状態をリセットする
   * @private
   * @param {Object} pair - 注文ペアオブジェクト
   * @param {String} side - 'buy' または 'sell'
   */
  _resetOrderState(pair, side) {
    if (side === 'buy') {
      pair.buyOrder = null;
      pair.buyFilled = false;
      if (this.activeOrders.buy && pair.buyOrder && this.activeOrders.buy.id === pair.buyOrder.id) { // nullチェック追加
        this.activeOrders.buy = null;
      }
    } else {
      pair.sellOrder = null;
      pair.sellFilled = false;
      if (this.activeOrders.sell && pair.sellOrder && this.activeOrders.sell.id === pair.sellOrder.id) { // nullチェック追加
        this.activeOrders.sell = null;
      }
    }
  }

  /**
   * 完了した注文ペアをクリーンアップする
   * @private
   */
  _cleanupCompletedPairs() {
    if (this.orderPairs.length > 0) {
      const pair = this.orderPairs[0];
      if (pair.buyFilled && pair.sellFilled) {
        console.log(`${this.symbol}: 完了した注文ペア(${pair.id})をクリーンアップします`);
        // 対応するアクティブ注文情報をクリア
        if (this.activeOrders.buy && pair.buyOrder && this.activeOrders.buy.id === pair.buyOrder.id) {
            this.activeOrders.buy = null;
        }
        if (this.activeOrders.sell && pair.sellOrder && this.activeOrders.sell.id === pair.sellOrder.id) {
            this.activeOrders.sell = null;
        }
        
        // 新しい空のペアを作成
        const newPair = {
          id: Date.now().toString() + Math.random().toString(16).slice(2),
          buyOrder: null,
          sellOrder: null,
          buyFilled: false,
          sellFilled: false,
          amount: 0
        };
        
        // 配列を新しいペアで置き換え
        this.orderPairs = [newPair];
        console.log(`${this.symbol}: 完了したペアをクリーンアップし、新しいペアを作成しました。ID: ${newPair.id}`);
      }
    } else {
      // ペアがない場合は新しいペアを作成
      const newPair = {
        id: Date.now().toString() + Math.random().toString(16).slice(2),
        buyOrder: null,
        sellOrder: null,
        buyFilled: false,
        sellFilled: false,
        amount: 0
      };
      
      this.orderPairs = [newPair];
      console.log(`${this.symbol}: 注文ペアが存在しないため、新しいペアを作成しました。ID: ${newPair.id}`);
    }
  }

  /**
   * 注文を発注または更新するメインロジック
   * @private
   */
  async _placeOrUpdateOrders() {
    try {
      const orderBook = await this.exchange.fetchOrderBook(this.symbol);
      const bestBid = orderBook.bids.length > 0 ? orderBook.bids[0][0] : null;
      const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[0][0] : null;

      if (!bestBid || !bestAsk) {
        console.log(`${this.symbol}: 注文ブックが空、または不完全です`);
        return;
      }

      const midPrice = (bestBid + bestAsk) / 2;
      const halfSpread = (this.options.spreadWidth / 100) / 2;
      const buyPrice = midPrice * (1 - halfSpread) - this.options.adjustmentValue;
      const sellPrice = midPrice * (1 + halfSpread) + this.options.adjustmentValue;

      const formattedBuyPrice = parseFloat(buyPrice.toFixed(this.options.pricePrecision));
      const formattedSellPrice = parseFloat(sellPrice.toFixed(this.options.pricePrecision));

      const balance = await this.exchange.fetchBalance();
      const baseCurrency = this.market.base; // 例: BTC
      const quoteCurrency = this.market.quote; // 例: JPY
      const availableFunds = balance.free[quoteCurrency] ?? 0; // 買い注文用資金
      const availableAsset = balance.free[baseCurrency] ?? 0; // 売り注文用資産

      // 現在のポジション数を更新 (fetchBalanceの結果を元に再計算する方が正確かも)
      // this.currentPositions = availableAsset; // 例: 単純に利用可能資産をポジションとする場合

      const now = Date.now();

      // --- 注文ロジック ---
      // 既存の注文ペアの状態を分析
      // 配列の最初の要素のみを参照する
      const currentPair = this.orderPairs[0] || null;
      const noOrders = currentPair && !currentPair.buyOrder && !currentPair.sellOrder; // 未注文状態
      const noBuySellExists = currentPair && !currentPair.buyOrder && currentPair.sellOrder;
      const noSellBuyExists = currentPair && currentPair.buyOrder && !currentPair.sellOrder;

      const hasCompletedPair = currentPair && currentPair.buyFilled && currentPair.sellFilled; // クリーンアップ対象

      // クリーンアップが必要な場合は新規注文を見送る (メインループで先に実行されるはずだが念のため)
      if (hasCompletedPair) {
          console.log(`${this.symbol}: 完了したペアが存在するため、クリーンアップを優先し新規注文を見送ります。`);
          // await this._cleanupCompletedPairs(); // メインループで実行されるのでここでは不要
          return;
      }

      // 新規注文を発注する条件を判定
      if (noOrders) {
          // 1. 未約定の注文が全くない場合: 両方の注文を試みる
          console.log(`${this.symbol}: 未約定の注文がないため、新規の買い注文と売り注文を試みます。`);
          // 現在価格から targetQuote 円分の量を推定し売買に使う。量が最低単位以下なら最低単位を使う
          // 利用可能な資金の割合に基づいて取引量を計算
          let amount = this.options.targetQuote / midPrice;
          // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用kj
          amount = Math.max(amount, this.options.baseMinTradeAmount)
          // 精度を考慮して、最小精度以上の値を確保
          let tradeAmount= parseFloat(amount.toFixed(this.options.amountPrecision));
          // 最小精度を下回らないようにする
          tradeAmount = Math.max(tradeAmount, this.options.baseMinTradeAmount);

          if (availableFunds >= formattedBuyPrice * tradeAmount) {
              await this._executePlaceOrder('buy', formattedBuyPrice, tradeAmount, now);
              this.lastOrderTime = now; // 注文試行時に更新
          } else {
              console.log(`${this.symbol}: 新規Buyの条件未達(資金不足): 資金=${availableFunds}/${formattedBuyPrice * tradeAmount}`);
          }
          if (availableAsset >= tradeAmount) {
              await this._executePlaceOrder('sell', formattedSellPrice, tradeAmount, now);
              this.lastOrderTime = now; // 注文試行時に更新
          } else {
              console.log(`${this.symbol}: 新規Sellの条件未達(資産不足): 資産=${availableAsset}/${tradeAmount}`);
          }
      } else if (noBuySellExists) {
          // 2. 買い注文がなく、未約定の売り注文がある場合: 買い注文のみを試みる
          console.log(`${this.symbol}: 新規の買い注文を試みます。`);

          // 買う時に売り注文が先に出ている場合、その売りの分だけ買う
          let tradeAmount = 0;
          const currentPair = this.orderPairs[0];
          if (currentPair && currentPair.sellOrder && !currentPair.buyOrder) {
            tradeAmount = currentPair.amount;
            console.log(`${this.symbol}: 先行する売り注文ペア(${currentPair.id})に基づいて買い注文量を調整: ${tradeAmount}`);
          } else {
            console.log(`${this.symbol}: ERROR: 適切な売り注文ペアが見つかりません。`);
            throw new Error(`${this.symbol}: 適切な売り注文ペアが見つかりません。`);
          }

          if (availableFunds >= formattedBuyPrice * tradeAmount) {
              await this._executePlaceOrder('buy', formattedBuyPrice, tradeAmount, now);
              this.lastOrderTime = now;
          } else {
              console.log(`${this.symbol}: 新規Buyの条件未達(資金不足): 資金=${availableFunds}/${formattedBuyPrice * tradeAmount}`);
          }
      } else if (noSellBuyExists) {
          // 3. 売り注文がなく、未約定の買い注文がある場合: 売り注文のみを試みる
          console.log(`${this.symbol}: 未約定の売り注文がないため、新規の売り注文のみを試みます。`);

          // 売る時に買い注文が先に出ている場合、その買いの分だけ売る
          let tradeAmount = 0;
          const currentPair = this.orderPairs[0];
          if (currentPair && currentPair.buyOrder && !currentPair.sellOrder) {
            tradeAmount = currentPair.amount;
            console.log(`${this.symbol}: 先行する買い注文ペア(${currentPair.id})に基づいて売り量を調整: ${tradeAmount}`);
          } else {
            console.log(`${this.symbol}: 適切な買い注文ペアが見つかりません。デフォルト設定を使用します。`);
            throw new Error(`${this.symbol}: 適切な買い注文ペアが見つかりません。`);
          }

          if (availableAsset >= tradeAmount) {
              await this._executePlaceOrder('sell', formattedSellPrice, tradeAmount, now);
              this.lastOrderTime = now;
          } else {
              console.log(`${this.symbol}: 新規Sellの条件未達(資産不足): 資産=${availableAsset}/${tradeAmount}`);
          }
      } else {
          // 4. 両方の未約定注文が存在する場合: 何もしない
          console.log(`${this.symbol}: 買い注文と売り注文が両方ペンディング中のため、新規注文は行いません。`);
      }

    } catch (error) {
      await this._postError('注文発注/更新処理中にエラーが発生しました', error);
    }
  }

  /**
   * 実際に注文を発注する内部メソッド
   * @private
   * @param {String} side - 'buy' または 'sell'
   * @param {Number} price - 価格
   * @param {Number} amount - 量
   * @param {Number} timestamp - 発注時刻
   */
  async _executePlaceOrder(side, price, amount, timestamp) {
    try {
      let order;
      // 既存のペアを使用するか、新しいペアを作成
      let currentPair = this.orderPairs[0];
      
      // 現在のペアが完了している場合は新しいペアを作成
      if (currentPair && currentPair.buyFilled && currentPair.sellFilled) {
        currentPair = {
          id: Date.now().toString() + Math.random().toString(16).slice(2), // よりユニークなID
          buyOrder: null,
          sellOrder: null,
          buyFilled: false,
          sellFilled: false,
          amount: amount // このペアでの取引量
        };
        this.orderPairs = [currentPair]; // 配列を1つの要素に置き換え
      } else if (!currentPair) {
        currentPair = {
          id: Date.now().toString() + Math.random().toString(16).slice(2), // よりユニークなID
          buyOrder: null,
          sellOrder: null,
          buyFilled: false,
          sellFilled: false,
          amount: amount // このペアでの取引量
        };
        this.orderPairs = [currentPair]; // 配列を1つの要素に置き換え
      }

      if (side === 'buy') {
        console.log(`${this.symbol}: -- 買い注文を発注します - 価格: ${price}, 数量: ${amount}`);
        order = await this.exchange.createLimitBuyOrder(this.symbol, amount, price);
        this.activeOrders.buy = order;
        currentPair.buyOrder = order;
        console.log(`${this.symbol}: -- 買い注文成功: ID ${order.id}, ペアID: ${currentPair.id}`);
      } else { // side === 'sell'
        console.log(`${this.symbol}: -- 売り注文を発注します - 価格: ${price}, 数量: ${amount}`);
        order = await this.exchange.createLimitSellOrder(this.symbol, amount, price);
        this.activeOrders.sell = order;
        currentPair.sellOrder = order;
        console.log(`${this.symbol}: -- 売り注文成功: ID ${order.id}, ペアID: ${currentPair.id}`);
      }

      this._updateTradeRecord(side, price, amount, order.id, 'limit'); // 取引記録更新
      this.orderHistory.push({
        time: timestamp,
        type: side,
        price: price,
        amount: amount,
        orderId: order.id,
        pairId: currentPair.id // どのペアに属するか記録
      });

      // 既存のペアを探し、片方の注文がすでにあればそこに追加、なければ新しいペアとして追加
      // すでに現在のペアに注文を追加済みなので、この処理は不要になります
      console.log(`${this.symbol}: 注文ペア(${currentPair.id})に${side}注文(${order.id})を追加しました。`);
      // 取引量を更新（常に最新の注文の量に合わせる）
      currentPair.amount = amount;


      await this._postOrder(`${side}注文発注: 価格 ${price}, 量 ${amount}, ID ${order.id}`);

    } catch (error) {
      await this._postError(`${side}注文の発注中にエラーが発生しました`, error);
      // エラー発生時に activeOrders をクリアすべきか検討
      if (side === 'buy') this.activeOrders.buy = null;
      else this.activeOrders.sell = null;
    }
  }


  /**
   * 戦略のメインループを開始する
   */
  async start() {
    if (this.isRunning) {
      console.log(`${this.symbol}: 戦略は既に実行中です。`);
      return;
    }
    this.isRunning = true;
    console.log(`${this.symbol}: レンジ相場向け受動的マーケットメイキング戦略を開始`);
    await this._postOrder(`戦略開始 - レンジ期間: ${this.options.rangePeriod}ms, 閾値: ${this.options.rangeThreshold}%, スプレッド: ${this.options.spreadWidth}%, 取引量: ${this.options.amount}`);

    // 0. 注文ペア復元
    // もしペアがDBに保存されている場合は復元する
    console.log(`${this.symbol}: DBから注文ペアを復元中...`);
    const restoredPair = await getCurrentOrderPair(this.exchange.id, this.symbol, 'MARKET_MAKING');
    this.orderPairs = restoredPair ? [restoredPair] : this.orderPairs;
    console.log(`${this.symbol}: ${this.orderPairs.length}個の注文ペアを復元しました。`);

    // activeOrdersの状態も復元する
    this.activeOrders = rebuildActiveOrders(this.orderPairs);

    while (this.isRunning) {
      try {
        const now = Date.now();

        // 1. 価格履歴の更新
        await this._updatePriceHistory();

        // 2. レンジ相場の判定
        const isRange = this._isRangeMarket();

        // 3. 注文ステータスの確認と更新
        await this._checkAndUpdateOrders();

        // 4. 完了した注文ペアのクリーンアップ
        await this._cleanupCompletedPairs(); // 注文発注前にクリーンアップ

        // 5. 注文の発注/更新ロジック
        // レンジ相場であるか、または最後の注文から一定時間経過した場合
        if (isRange || (now - this.lastOrderTime >= this.options.reorderInterval)) {
          await this._placeOrUpdateOrders();
        } else {
          console.log(`${this.symbol}: 注文条件未達: レンジ相場(${isRange}), 最終注文からの経過時間(${now - this.lastOrderTime}ms / ${this.options.reorderInterval}ms)`);
        }

        // 6. 注文ペア状態の保存
        // DBに保存する
        // 常に配列の最初の要素を保存
        if (this.orderPairs.length > 0) {
          await setCurrentOrderPair(this.exchange.id, this.symbol, 'MARKET_MAKING', this.orderPairs[0]);
        } else {
          console.log(`${this.symbol}: 注文ペアが存在しないため、保存をスキップします。`);
        }

        // ループの待機
        await new Promise(resolve => setTimeout(resolve, this.options.loopInterval));

      } catch (error) {
        await this._postError('メインループで予期せぬエラーが発生しました', error);
        // エラー発生後、少し待ってからループを継続
        await new Promise(resolve => setTimeout(resolve, this.options.errorRetryInterval));
      }
    }
    console.log(`${this.symbol}: マーケットメイキング戦略が停止しました`);
  }

  /**
   * 戦略を停止する
   */
  stop() {
    console.log(`${this.symbol}: マーケットメイキング戦略の停止を要求`);
    this.isRunning = false;
    // 必要であれば、アクティブな注文をキャンセルする処理を追加
    // await this.cancelAllOrders();
  }

  /**
   * 全てのアクティブな注文をキャンセルする (オプション)
   */
  async cancelAllOrders() {
      console.log(`${this.symbol}: 全てのアクティブな注文をキャンセルします`);
      try {
          const openOrders = await this.exchange.fetchOpenOrders(this.symbol);
          if (openOrders.length > 0) {
              console.log(`${this.symbol}: ${openOrders.length}件の注文をキャンセル中...`);
              await Promise.all(openOrders.map(order =>
                  this.exchange.cancelOrder(order.id, this.symbol)
                      .then(() => console.log(`${this.symbol}: 注文 ${order.id} をキャンセルしました。`))
                      .catch(err => this._postError(`注文 ${order.id} のキャンセルに失敗しました`, err))
              ));
              console.log(`${this.symbol}: 全ての注文キャンセル処理が完了しました。`);
          } else {
              console.log(`${this.symbol}: キャンセル対象のアクティブな注文はありません。`);
          }
          // 内部状態もリセット
          this.activeOrders = { buy: null, sell: null };
          this.orderPairs = []; // ペアもクリア
      } catch (error) {
          await this._postError('全注文のキャンセル処理中にエラーが発生しました', error);
      }
  }

}

// --- 使用例 ---
// このファイルが直接実行された場合のサンプルコード (通常は strategyRunner などから呼び出す)
/*
async function runExample() {
  // ccxtのインスタンス化と設定 (APIキーなど)
  const exchangeId = 'bybit'; // 例: bybit
  const exchange = new ccxt[exchangeId]({
    apiKey: 'YOUR_API_KEY',
    secret: 'YOUR_SECRET',
    // 必要に応じて他のオプション (testnetなど)
    // 'options': { 'defaultType': 'spot' } // 現物取引の場合
  });

  // テストネットを使用する場合 (取引所がサポートしていれば)
  // exchange.setSandboxMode(true);

  const symbol = 'BTC/USDT'; // 取引するシンボル

  const strategyOptions = {
    amount: 0.001, // 1回の取引量
    rangePeriod: 300000, // 5分
    rangeThreshold: 0.5, // 0.5%
    spreadWidth: 0.1, // 0.1%
    reorderInterval: 60000, // 1分
    // Discord通知関数 (ダミー)
    postOrderToDiscord: async (msg) => console.log(`[Discord Order] ${msg}`),
    postErrorToDiscord: async (msg) => console.error(`[Discord Error] ${msg}`),
    // 取引記録関数 (ダミー)
    updateTradeRecord: (exchangeId, symbol, amount, price, side) => {
      console.log(`[Trade Record] ${exchangeId} ${symbol} ${side} ${amount} @ ${price}`);
    },
    tradeRecords: {} // 初期取引記録 (空)
  };

  try {
    const strategy = new MarketMakingStrategy(exchange, symbol, strategyOptions);
    await strategy.start(); // 戦略を開始

    // Ctrl+Cなどで停止できるようにする
    process.on('SIGINT', async () => {
      console.log("SIGINT受信、戦略を停止します...");
      strategy.stop();
      // 必要であれば、全ての注文をキャンセル
      // await strategy.cancelAllOrders();
      process.exit(0);
    });

  } catch (error) {
    console.error("戦略の初期化または実行中にエラーが発生しました:", error);
    process.exit(1);
  }
}

// このファイルが直接実行された場合に runExample を実行
if (require.main === module) {
  runExample();
}
*/

// モジュールとしてエクスポート
module.exports = {
  MarketMakingStrategy,
  // 元の関数も残す場合 (互換性のため)
  passiveMarketMaking: async (exchange, symbol, rangePeriod, rangeThreshold, spreadWidth, amount, options) => {
      const strategyOptions = {
          ...options, // 元のoptionsを展開
          rangePeriod,
          rangeThreshold,
          spreadWidth,
          amount,
      };
      const strategy = new MarketMakingStrategy(exchange, symbol, strategyOptions);
      // passiveMarketMakingは実行し続ける想定だったため、startを呼び出す
      // エラーハンドリングや停止処理は呼び出し元で行う必要がある
      try {
          await strategy.start();
          // 注意: start()は無限ループのため、この関数は通常戻らない
          // 必要であれば、strategy.stop()を呼び出すメカニズムが必要
      } catch (error) {
          console.error(`${symbol}: passiveMarketMaking実行中にエラー`, error);
          if (strategyOptions.postErrorToDiscord) {
              await strategyOptions.postErrorToDiscord(`[MM] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
          }
          // エラーオブジェクトを返すか、例外を再スローするかは設計による
          return {
              strategy: 'Passive Market Making',
              symbol,
              error: error.message
          };
      }
  }
};
