/**
 * Redisデータベースモジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const { client, initRedisClient } = require('./redisClient');

// 初期化関数
async function initialize() {
  await initRedisClient();
  console.log('Redisデータベースモジュールが初期化されました');
}

// 注文ペアの保存
async function saveOrderPairs(exchangeId, symbol, strategyKey, pair) {
  const key = `orderPair:${exchangeId}:${symbol}:${strategyKey}`;
  await client.set(key, JSON.stringify({ pair }));
}

// 注文ペアの取得
async function getOrderPairs(exchangeId, symbol, strategyKey) {
  const key = `orderPair:${exchangeId}:${symbol}:${strategyKey}`;
  const data = await client.get(key);
  
  if (data) {
    return JSON.parse(data).pair;
  }
  
  return [];
}

/**
 * 取引記録を追加/更新する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @param {String} side - 取引方向（'buy'または'sell'）
 * @param {Number} amount - 取引量
 * @param {Number} price - 取引価格
 * @param {Number} value - 取引価値（amount * price）
 * @param {String} orderId - 注文ID
 * @param {String} orderType - 注文タイプ（例: 'market', 'limit'）
 * @returns {Promise} 処理完了時に解決されるPromise
 */
async function addTrade(exchangeId, symbol, strategyKey, side, amount, price, value, orderId, orderType) {
  const now = Date.now();
  
  // 取引記録サマリキー
  const recordKey = `trade:orderSummary:${exchangeId}:${symbol}:${strategyKey}`;
  
  // インデックスセットに追加
  await client.sAdd('exchanges', exchangeId);
  await client.sAdd(`symbols:${exchangeId}`, symbol);
  await client.sAdd(`strategies:${exchangeId}:${symbol}`, strategyKey);
  
  // 注文IDをキーとしたインデックスを作成
  // この形式で、オーダーIDから取引所、通貨ペア、戦略キーの情報を取得可能に
  await client.set(`order:index:${orderId}`, `${exchangeId}:${symbol}:${strategyKey}`);
  
  // 注文詳細のインデックスを作成（検索高速化のため）
  const orderDetails = {
    orderId,
    amount,
    side,
    price,
    orderType,
    orderedAt: now,
    type: 'order',
    exchangeId,
    symbol,
    strategyKey
  };
  await client.set(`order:details:${orderId}`, JSON.stringify(orderDetails));
  
  // 取引記録が存在するか確認
  const exists = await client.exists(recordKey);
  
  if (!exists) {
    // 新しい取引記録を作成
    await client.hSet(recordKey, {
      buyAmount: 0,
      sellAmount: 0,
      totalBuyCost: 0,
      totalSellValue: 0,
      netPosition: 0,
      createdAt: now,
      updatedAt: now
    });
    
    // 時系列インデックスに追加
    await client.zAdd('trade:orderSummary:time', {
      score: now,
      value: `${exchangeId}:${symbol}:${strategyKey}`
    });
  }
  
  // 注文履歴を追加
  const orderHistoryKey = `trade:orderHistory:${exchangeId}:${symbol}:${strategyKey}`;
  const orderData = JSON.stringify({
    orderId,
    amount,
    side,
    price,
    orderType,
    orderedAt: now
  });
  
  await client.rPush(orderHistoryKey, orderData);
  
  // 時系列インデックスに追加
  await client.zAdd('trade:orderHistory:time', {
    score: now,
    value: `${exchangeId}:${symbol}:${strategyKey}:${now}`
  });
  
  // 取引記録を更新
  if (side === 'buy') {
    // 買い注文の場合
    await client.hIncrByFloat(recordKey, 'buyAmount', amount);
    await client.hIncrByFloat(recordKey, 'totalBuyCost', value);
    await client.hIncrByFloat(recordKey, 'netPosition', amount);
  } else if (side === 'sell') {
    // 売り注文の場合
    await client.hIncrByFloat(recordKey, 'sellAmount', amount);
    await client.hIncrByFloat(recordKey, 'totalSellValue', value);
    
    // 買い量から差し引く
    await client.hIncrByFloat(recordKey, 'netPosition', -amount);
  }
  
  // 更新日時を設定
  await client.hSet(recordKey, 'updatedAt', now);
  
  return true;
}

/**
 * 約定記録を追加/更新する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @param {String} side - 取引方向（'buy'または'sell'）
 * @param {Number} amount - 取引量
 * @param {Number} price - 取引価格
 * @param {Number} value - 取引価値（amount * price）
 * @param {String} orderId - 注文ID
 * @param {String} orderType - 注文タイプ（例: 'market', 'limit'）
 * @param {Number} fee - 取引手数料
 * @returns {Promise} 処理完了時に解決されるPromise
 */
async function addFilledTrade(exchangeId, symbol, strategyKey, side, amount, price, value, orderId, orderType, fee = value * 0.001) {
  const now = Date.now();
  
  // 約定記録サマリーキー
  const summaryKey = `trade:filledSummary:${exchangeId}:${symbol}:${strategyKey}`;
  
  // インデックスセットに追加
  await client.sAdd('exchanges', exchangeId);
  await client.sAdd(`symbols:${exchangeId}`, symbol);
  await client.sAdd(`strategies:${exchangeId}:${symbol}`, strategyKey);
  
  // 約定記録が存在するか確認
  const exists = await client.exists(summaryKey);
  
  if (!exists) {
    // 新しい約定サマリーを作成
    await client.hSet(summaryKey, {
      buyAmount: 0,
      sellAmount: 0,
      totalBuyCost: 0,
      totalSellValue: 0,
      netPosition: 0,
      totalFee: 0,
      realizedPnL: 0,
      createdAt: now,
      updatedAt: now
    });
    
    // 時系列インデックスに追加
    await client.zAdd('trade:filledSummary:time', {
      score: now,
      value: `${exchangeId}:${symbol}:${strategyKey}`
    });
  }
  
  // 約定履歴を追加
  const filledHistoryKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
  const filledData = JSON.stringify({
    orderId,
    amount,
    side,
    price,
    orderType,
    fee,
    filledAt: now
  });
  
  await client.rPush(filledHistoryKey, filledData);

  // オーダーIDをキーとしたインデックスを作成
  await client.set(`filledOrder:details:${orderId}`, filledData); 
  
  // 時系列インデックスに追加
  await client.zAdd('trade:filledHistory:time', {
    score: now,
    value: `${exchangeId}:${symbol}:${strategyKey}:${now}`
  });
  
  // 約定サマリーを更新
  if (side === 'buy') {
    // 買い注文の場合
    await client.hIncrByFloat(summaryKey, 'buyAmount', amount);
    await client.hIncrByFloat(summaryKey, 'totalBuyCost', value);
    await client.hIncrByFloat(summaryKey, 'netPosition', amount);
  } else if (side === 'sell') {
    // 売り注文の場合
    await client.hIncrByFloat(summaryKey, 'sellAmount', amount);
    await client.hIncrByFloat(summaryKey, 'totalSellValue', value);
    await client.hIncrByFloat(summaryKey, 'netPosition', -amount);
    
    // 実現損益を計算（売りの場合のみ更新）
    // 単純化のため、売った分の平均購入コストを計算
    const currentBuyAmount = parseFloat(await client.hGet(summaryKey, 'buyAmount') || 0);
    const currentBuyCost = parseFloat(await client.hGet(summaryKey, 'totalBuyCost') || 0);
    
    if (currentBuyAmount > 0) {
      const avgBuyCost = currentBuyCost / currentBuyAmount;
      const soldCost = amount * avgBuyCost;
      const profit = value - soldCost;
      await client.hIncrByFloat(summaryKey, 'realizedPnL', profit);
    }
  }
  
  // 手数料を加算
  await client.hIncrByFloat(summaryKey, 'totalFee', fee);
  
  // 更新日時を設定
  await client.hSet(summaryKey, 'updatedAt', now);
  await updateFilledSummaryTimestamp(exchangeId, symbol);
  
  return true;
}

/**
 * 取引記録をオブジェクトとして取得する関数
 * @returns {Promise<Object>} 取引記録オブジェクト
 */
async function getTradeRecordsAsObject() {
  const result = {};
  
  // 取引所一覧を取得
  const exchanges = await client.sMembers('exchanges');
  
  for (const exchangeId of exchanges) {
    result[exchangeId] = {};
    
    // 通貨ペア一覧を取得
    const symbols = await client.sMembers(`symbols:${exchangeId}`);
    
    for (const symbol of symbols) {
      result[exchangeId][symbol] = {};
      
      // 戦略一覧を取得
      const strategies = await client.sMembers(`strategies:${exchangeId}:${symbol}`);
      
      for (const strategyKey of strategies) {
        // 取引記録を取得
        const recordKey = `trade:filledSummary:${exchangeId}:${symbol}:${strategyKey}`;
        const record = await client.hGetAll(recordKey);
        
        if (Object.keys(record).length === 0) {
          continue;
        }
        
        // 取引履歴を取得
        // const historyKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
        // const historyData = await client.lRange(historyKey, 0, 99); // 最新100件
        
        // const trades = historyData.map(data => {
        //   const trade = JSON.parse(data);
        //   return {
        //     timestamp: trade.filledAt,
        //     side: trade.side,
        //     amount: trade.amount,
        //     price: trade.price,
        //     value: trade.amount * trade.price
        //   };
        // });
        
        // 結果オブジェクトに追加
        result[exchangeId][symbol][strategyKey] = {
          buyAmount: parseFloat(record.buyAmount || 0),
          sellAmount: parseFloat(record.sellAmount || 0),
          totalBuyCost: parseFloat(record.totalBuyCost || 0),
          totalSellValue: parseFloat(record.totalSellValue || 0),
          netPosition: parseFloat(record.netPosition || 0)
        };
      }
    }
  }
  
  return result;
}

/**
 * 指定されたexchange、symbol、戦略の組で最新のtradeHistoryのamountを取得
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Promise<Number>} 最新の取引量
 */
async function getLatestTradeAmount(exchangeId, symbol, strategyKey) {
  const historyKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
  
  // 最新の取引履歴を取得
  const latestData = await client.lRange(historyKey, 0, 0);
  
  if (latestData.length === 0) {
    return 0;
  }
  
  try {
    const trade = JSON.parse(latestData[0]);
    return trade.amount;
  } catch (error) {
    console.error('取引履歴のパースエラー:', error);
    return 0;
  }
}

/**
 * 取引履歴を取得する関数
 * @param {Object} filters - フィルター条件
 * @param {Number} limit - 取得件数
 * @param {Number} offset - オフセット
 * @returns {Promise<Object>} 取引履歴と合計件数
 */
async function getFilledHistory(filters = {}, limit = 100, offset = 0) {
  const { exchangeId, symbol, strategyKey, startDate, endDate } = filters;
  
  // デバッグログ: 関数呼び出しを記録
  console.log('getFilledHistory関数呼び出し:', {
    filters,
    limit,
    offset
  });
  
  // 時系列インデックスから取得
  let historyItems = [];
  let allTrades = []; // 全データを保持する変数をここで定義
  
  if (exchangeId && symbol && strategyKey) {
    // 特定の取引所、通貨ペア、戦略の履歴を取得
    const historyKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
    
    // デバッグログ: 使用しているRedisキーを記録
    console.log('使用しているRedisキー:', historyKey);
    
    // リストの長さを取得してログに出力
    const listLength = await client.lLen(historyKey);
    console.log(`Redisリストの長さ: ${listLength}, 要求オフセット: ${offset}, 要求リミット: ${limit}`);
    
    // 全データを取得してソート後にページングする
    // これにより、全体としての一貫したソート順が保たれる
    console.log('全データを取得してソート後にページング');
    
    // 全データを取得
    const allData = await client.lRange(historyKey, 0, -1);
    console.log(`全データ取得: ${allData.length}件`);
    
    // 全データをパースしてタイムスタンプでソート
    allTrades = allData.map(item => {
      const trade = JSON.parse(item);
      return {
        id: trade.orderId,
        timestamp: Number(trade.filledAt), // 数値に変換
        exchangeId,
        symbol,
        strategyKey,
        side: trade.side,
        amount: trade.amount,
        price: trade.price,
        value: trade.amount * trade.price,
        fee: trade.fee || (trade.amount * trade.price * 0.001)
      };
    });
    
    // 降順（新しい順）にソート
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`ソート完了: 最初のタイムスタンプ=${allTrades[0]?.timestamp}, 最後のタイムスタンプ=${allTrades[allTrades.length-1]?.timestamp}`);
    
    // ページングを適用
    historyItems = allTrades.slice(offset, offset + limit);
    console.log(`ページング適用: ${offset}から${offset + limit}まで, 結果=${historyItems.length}件`);
  } else {
    // 時系列インデックスから取得
    let scoreMin = '-inf';
    let scoreMax = '+inf';
    
    if (startDate) {
      scoreMin = startDate;
    }
    
    if (endDate) {
      scoreMax = endDate;
    }
    
    // 時系列インデックスから全てのアイテムを取得
    console.log('時系列インデックスから全データを取得');
    const allTimeRangeItems = await client.zRangeByScore('trade:filledHistory:time', scoreMin, scoreMax);
    console.log(`全時系列データ取得: ${allTimeRangeItems.length}件`);
    
    // 全てのアイテムを処理
    allTrades = []; // 既に定義されている変数を使用
    
    for (const item of allTimeRangeItems) {
      const [itemExchangeId, itemSymbol, itemStrategyKey, timestamp] = item.split(':');
      
      // フィルター条件に一致するか確認
      if (exchangeId && itemExchangeId !== exchangeId) continue;
      if (symbol && itemSymbol !== symbol) continue;
      if (strategyKey && itemStrategyKey !== strategyKey) continue;
      
      // 履歴キー
      const historyKey = `trade:filledHistory:${itemExchangeId}:${itemSymbol}:${itemStrategyKey}`;
      
      // インデックスを特定するのは難しいので、全て取得して検索
      const allHistory = await client.lRange(historyKey, 0, -1);
      
      for (const historyItem of allHistory) {
        const trade = JSON.parse(historyItem);
        
        // タイムスタンプが一致するものを探す
        if (trade.filledAt.toString() === timestamp) {
          allTrades.push({
            id: trade.orderId,
            timestamp: Number(trade.filledAt), // 数値に変換
            exchangeId: itemExchangeId,
            symbol: itemSymbol,
            strategyKey: itemStrategyKey,
            side: trade.side,
            amount: trade.amount,
            price: trade.price,
            value: trade.amount * trade.price,
            fee: trade.fee || (trade.amount * trade.price * 0.001)
          });
          break;
        }
      }
    }
    
    // 降順（新しい順）にソート
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`ソート完了: 全${allTrades.length}件, 最初のタイムスタンプ=${allTrades[0]?.timestamp}, 最後のタイムスタンプ=${allTrades[allTrades.length-1]?.timestamp}`);
    
    // ページングを適用
    historyItems = allTrades.slice(offset, offset + limit);
    console.log(`ページング適用: ${offset}から${offset + limit}まで, 結果=${historyItems.length}件`);
  }
  
  // 合計数を取得
  let totalCount = 0;
  
  if (exchangeId && symbol && strategyKey) {
    // 特定の取引所、通貨ペア、戦略の場合は、全データの長さを使用
    const historyKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
    totalCount = await client.lLen(historyKey);
  } else {
    // フィルター条件がある場合は、フィルタリング後の全データの長さを使用
    // この場合、allTradesの長さが実際のフィルタリング後の全データ数
    totalCount = allTrades ? allTrades.length : 0;
  }
  
  console.log(`合計数: ${totalCount}件`);
  
  return {
    history: historyItems,
    total: totalCount
  };
}

/**
 * 取引サマリーを取得する関数
 * @param {String} period - 期間（'daily', 'weekly', 'monthly', 'yearly', 'all'）
 * @returns {Promise<Object>} サマリー情報
 */
async function getTradeSummary(period = 'all') {
  // 現在の時刻（ミリ秒）
  const now = Date.now();
  
  // 期間に応じた開始時間を計算
  let startTime = 0;
  if (period === 'daily') {
    startTime = now - 24 * 60 * 60 * 1000; // 24時間前
  } else if (period === 'weekly') {
    startTime = now - 7 * 24 * 60 * 60 * 1000; // 7日前
  } else if (period === 'monthly') {
    startTime = now - 30 * 24 * 60 * 60 * 1000; // 30日前
  } else if (period === 'yearly') {
    startTime = now - 365 * 24 * 60 * 60 * 1000; // 365日前
  }
  
  // 時系列インデックスから期間内の取引を取得
  const timeRangeItems = await client.zRangeByScore('trade:filledHistory:time', startTime, '+inf');
  
  // 集計用の変数
  let totalBuyAmount = 0;
  let totalSellAmount = 0;
  let totalBuyCost = 0;
  let totalSellValue = 0;
  let totalFee = 0;
  
  // 取引所別、戦略別の集計
  const byExchangeData = {};
  const byStrategyData = {};
  
  // 各取引を処理
  for (const item of timeRangeItems) {
    const [exchangeId, symbol, strategyKey, timestamp] = item.split(':');
    
    // 履歴キー
    const historyKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
    
    // インデックスを特定するのは難しいので、全て取得して検索
    const allHistory = await client.lRange(historyKey, 0, -1);
    
    for (const historyItem of allHistory) {
      const trade = JSON.parse(historyItem);
      
      // タイムスタンプが一致するものを探す
      if (trade.filledAt.toString() === timestamp) {
        const amount = trade.amount;
        const value = trade.amount * trade.price;
        const fee = trade.fee || (value * 0.001); // 手数料がない場合は取引額の0.1%と仮定
        
        // 全体の集計
        if (trade.side === 'buy') {
          totalBuyAmount += amount;
          totalBuyCost += value;
        } else {
          totalSellAmount += amount;
          totalSellValue += value;
        }
        
        // 手数料を加算
        totalFee += fee;
        
        // 取引所別の集計
        if (!byExchangeData[exchangeId]) {
          byExchangeData[exchangeId] = {
            totalBuyAmount: 0,
            totalSellAmount: 0,
            totalBuyCost: 0,
            totalSellValue: 0,
            totalFee: 0
          };
        }
        
        if (trade.side === 'buy') {
          byExchangeData[exchangeId].totalBuyAmount += amount;
          byExchangeData[exchangeId].totalBuyCost += value;
        } else {
          byExchangeData[exchangeId].totalSellAmount += amount;
          byExchangeData[exchangeId].totalSellValue += value;
        }
        byExchangeData[exchangeId].totalFee += fee;
        
        // 戦略別の集計
        if (!byStrategyData[strategyKey]) {
          byStrategyData[strategyKey] = {
            totalBuyAmount: 0,
            totalSellAmount: 0,
            totalBuyCost: 0,
            totalSellValue: 0,
            totalFee: 0
          };
        }
        
        if (trade.side === 'buy') {
          byStrategyData[strategyKey].totalBuyAmount += amount;
          byStrategyData[strategyKey].totalBuyCost += value;
        } else {
          byStrategyData[strategyKey].totalSellAmount += amount;
          byStrategyData[strategyKey].totalSellValue += value;
        }
        byStrategyData[strategyKey].totalFee += fee;
        
        break;
      }
    }
  }
  
  // 現在のポジション情報を取得
  const allRecords = await getTradeRecordsAsObject();
  let currentPositions = 0;
  let currentBuyAmount = 0;
  let currentSellAmount = 0;
  let currentBuyCost = 0;
  let currentSellValue = 0;
  
  // 全ての記録を集計
  Object.keys(allRecords).forEach(exId => {
    Object.keys(allRecords[exId]).forEach(sym => {
      Object.keys(allRecords[exId][sym]).forEach(strat => {
        const record = allRecords[exId][sym][strat];
        currentPositions += record.netPosition;
        currentBuyAmount += record.buyAmount;
        currentSellAmount += record.sellAmount;
        currentBuyCost += record.totalBuyCost;
        currentSellValue += record.totalSellValue;
      });
    });
  });
  
  // 実現済み損益を計算（より正確な方法）
  // 売りの総額から、売った分の平均購入コストを引く
  let realizedPnL = 0;
  
  // 売りの量が買いの量以下の場合（通常のケース）
  if (totalSellAmount <= totalBuyAmount) {
    // 平均購入単価を計算
    const avgBuyPrice = totalBuyCost / totalBuyAmount;
    // 売った分の購入コスト
    const soldCost = totalSellAmount * avgBuyPrice;
    // 実現損益 = 売りの総額 - 売った分の購入コスト
    realizedPnL = totalSellValue - soldCost;
  } else {
    // 売りの量が買いの量を超える場合（ショートポジションなど）
    // 買った分は全て売却済みと考える
    realizedPnL = totalSellValue - totalBuyCost;
  }
  
  // 取引所別の実現済み損益を計算（より正確な方法）
  Object.keys(byExchangeData).forEach(exId => {
    const exchange = byExchangeData[exId];
    if (exchange.totalSellAmount <= exchange.totalBuyAmount) {
      const avgBuyPrice = exchange.totalBuyCost / exchange.totalBuyAmount;
      const soldCost = exchange.totalSellAmount * avgBuyPrice;
      exchange.realizedPnL = exchange.totalSellValue - soldCost;
    } else {
      exchange.realizedPnL = exchange.totalSellValue - exchange.totalBuyCost;
    }
  });
  
  // 戦略別の実現済み損益を計算（より正確な方法）
  Object.keys(byStrategyData).forEach(strat => {
    const strategy = byStrategyData[strat];
    if (strategy.totalSellAmount <= strategy.totalBuyAmount) {
      const avgBuyPrice = strategy.totalBuyCost / strategy.totalBuyAmount;
      const soldCost = strategy.totalSellAmount * avgBuyPrice;
      strategy.realizedPnL = strategy.totalSellValue - soldCost;
    } else {
      strategy.realizedPnL = strategy.totalSellValue - strategy.totalBuyCost;
    }
  });
  
  // 純損益（手数料を差し引いた実現損益）を計算
  const netPnL = realizedPnL - totalFee;
  
  // 取引所別の純損益を計算
  Object.keys(byExchangeData).forEach(exId => {
    byExchangeData[exId].netPnL = byExchangeData[exId].realizedPnL - byExchangeData[exId].totalFee;
  });
  
  // 戦略別の純損益を計算
  Object.keys(byStrategyData).forEach(strat => {
    byStrategyData[strat].netPnL = byStrategyData[strat].realizedPnL - byStrategyData[strat].totalFee;
  });
  
  return {
    period,
    summary: {
      totalBuyAmount,
      totalSellAmount,
      totalBuyCost,
      totalSellValue,
      totalFee,
      realizedPnL,
      netPnL,
      currentPositions,
      currentPositionValue: currentBuyCost - currentSellValue
    },
    byExchange: byExchangeData,
    byStrategy: byStrategyData
  };
}

/**
 * 約定サマリーを取得する関数
 * @param {Object} filters - フィルター条件（exchangeId, symbol, strategyKey）
 * @returns {Promise<Object>} 約定サマリー情報
 */
async function getFilledSummary(filters = {}) {
  const { exchangeId, symbol, strategyKey } = filters;
  
  // 全て指定されている場合は特定のサマリーを取得
  if (exchangeId && symbol && strategyKey) {
    const summaryKey = `trade:filledSummary:${exchangeId}:${symbol}:${strategyKey}`;
    const summary = await client.hGetAll(summaryKey);
    
    if (Object.keys(summary).length > 0) {
      return {
        buyAmount: parseFloat(summary.buyAmount || 0),
        sellAmount: parseFloat(summary.sellAmount || 0),
        totalBuyCost: parseFloat(summary.totalBuyCost || 0),
        totalSellValue: parseFloat(summary.totalSellValue || 0),
        netPosition: parseFloat(summary.netPosition || 0),
        totalFee: parseFloat(summary.totalFee || 0),
        realizedPnL: parseFloat(summary.realizedPnL || 0),
        createdAt: parseInt(summary.createdAt || 0),
        updatedAt: parseInt(summary.updatedAt || 0)
      };
    }
    return {};
  }
  
  return {};
}

/**
 * 特定の注文IDから戦略キーを取得する関数
 * @param {String} orderId - 注文ID
 */
async function getOrderStrategyKeyByOrderId(orderId) {
  const indexValue = await client.get(`order:index:${orderId}`);
  
  // インデックスが存在しない場合
  if (!indexValue) {
    return 'OUTSIDE';
  }
  
  // インデックス値を分解
  const [exchangeId, symbol, strategyKey] = indexValue.split(':');
  
  return strategyKey;
}

/**
 * 特定の注文IDから注文の詳細情報を取得する関数（効率化版）
 * @param {String} orderId - 注文ID
 * @returns {Promise<Object|null>} 注文の詳細情報またはnull
 */
async function getOrderDetailsByOrderId(orderId) {
  // 直接インデックスから詳細情報を取得（高速）
  const orderDetails = await client.get(`order:details:${orderId}`);
  if (orderDetails) {
    try {
      return JSON.parse(orderDetails);
    } catch (error) {
      console.error('注文詳細のパースエラー:', error);
    }
  }
  return null;
}


// モジュールのエクスポート
/**
 * 取引履歴（注文履歴）を取得する関数
 * @param {Object} filters - フィルター条件
 * @param {Number} limit - 取得件数
 * @param {Number} offset - オフセット
 * @returns {Promise<Object>} 取引履歴と合計件数
 */
async function getOrderHistory(filters = {}, limit = 100, offset = 0) {
  const { exchangeId, symbol, strategyKey, startDate, endDate } = filters;
  
  console.log('getOrderHistory関数呼び出し:', {
    filters,
    limit,
    offset
  });
  
  // 時系列インデックスから取得
  let historyItems = [];
  let allTrades = []; // 全データを保持する変数
  
  if (exchangeId && symbol && strategyKey) {
    // 特定の取引所、通貨ペア、戦略の履歴を取得
    const historyKey = `trade:orderHistory:${exchangeId}:${symbol}:${strategyKey}`;
    
    console.log('使用しているRedisキー:', historyKey);
    
    // 全データを取得してソート後にページングする
    console.log('全データを取得してソート後にページング');
    
    // 全データを取得
    const allData = await client.lRange(historyKey, 0, -1);
    console.log(`全データ取得: ${allData.length}件`);
    
    // 全データをパースしてタイムスタンプでソート
    allTrades = allData.map(item => {
      const trade = JSON.parse(item);
      return {
        id: trade.orderId,
        timestamp: Number(trade.orderedAt), // 数値に変換
        exchangeId,
        symbol,
        strategyKey,
        side: trade.side,
        amount: trade.amount,
        price: trade.price,
        value: trade.amount * trade.price
      };
    });
    
    // 降順（新しい順）にソート
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`ソート完了: 最初のタイムスタンプ=${allTrades[0]?.timestamp}, 最後のタイムスタンプ=${allTrades[allTrades.length-1]?.timestamp}`);
    
    // ページングを適用
    historyItems = allTrades.slice(offset, offset + limit);
    console.log(`ページング適用: ${offset}から${offset + limit}まで, 結果=${historyItems.length}件`);
  } else {
    // 時系列インデックスから取得
    let scoreMin = '-inf';
    let scoreMax = '+inf';
    
    if (startDate) {
      scoreMin = startDate;
    }
    
    if (endDate) {
      scoreMax = endDate;
    }
    
    // 時系列インデックスから全てのアイテムを取得
    console.log('時系列インデックスから全データを取得');
    const allTimeRangeItems = await client.zRangeByScore('trade:orderHistory:time', scoreMin, scoreMax);
    console.log(`全時系列データ取得: ${allTimeRangeItems.length}件`);
    
    // 全てのアイテムを処理
    allTrades = []; // 既に定義されている変数を使用
    
    for (const item of allTimeRangeItems) {
      const [itemExchangeId, itemSymbol, itemStrategyKey, timestamp] = item.split(':');
      
      // フィルター条件に一致するか確認
      if (exchangeId && itemExchangeId !== exchangeId) continue;
      if (symbol && itemSymbol !== symbol) continue;
      if (strategyKey && itemStrategyKey !== strategyKey) continue;
      
      // 履歴キー
      const historyKey = `trade:orderHistory:${itemExchangeId}:${itemSymbol}:${itemStrategyKey}`;
      
      // インデックスを特定するのは難しいので、全て取得して検索
      const allHistory = await client.lRange(historyKey, 0, -1);
      
      for (const historyItem of allHistory) {
        const trade = JSON.parse(historyItem);
        
        // タイムスタンプが一致するものを探す
        if (trade.orderedAt.toString() === timestamp) {
          allTrades.push({
            id: trade.orderId,
            timestamp: Number(trade.orderedAt), // 数値に変換
            exchangeId: itemExchangeId,
            symbol: itemSymbol,
            strategyKey: itemStrategyKey,
            side: trade.side,
            amount: trade.amount,
            price: trade.price,
            value: trade.amount * trade.price
          });
          break;
        }
      }
    }
    
    // 降順（新しい順）にソート
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`ソート完了: 全${allTrades.length}件, 最初のタイムスタンプ=${allTrades[0]?.timestamp}, 最後のタイムスタンプ=${allTrades[allTrades.length-1]?.timestamp}`);
    
    // ページングを適用
    historyItems = allTrades.slice(offset, offset + limit);
    console.log(`ページング適用: ${offset}から${offset + limit}まで, 結果=${historyItems.length}件`);
  }
  
  // 合計数を取得
  let totalCount = 0;
  
  if (exchangeId && symbol && strategyKey) {
    // 特定の取引所、通貨ペア、戦略の場合は、全データの長さを使用
    const historyKey = `trade:orderHistory:${exchangeId}:${symbol}:${strategyKey}`;
    totalCount = await client.lLen(historyKey);
  } else {
    // フィルター条件がある場合は、フィルタリング後の全データの長さを使用
    // この場合、allTradesの長さが実際のフィルタリング後の全データ数
    totalCount = allTrades ? allTrades.length : 0;
  }
  
  console.log(`合計数: ${totalCount}件`);
  
  return {
    history: historyItems,
    total: totalCount
  };
}

module.exports = {
  initialize,
  addTrade,
  addFilledTrade,
  getTradeRecordsAsObject,
  getLatestTradeAmount,
  getFilledHistory, // 関数名を変更
  getOrderHistory,
  getTradeSummary,
  getFilledSummary,
  getOrderStrategyKeyByOrderId,
  getOrderDetailsByOrderId
};

/**
 * 約定サマリー更新時間テーブルを更新する関数
 * 約定サマリーが更新された時間のみを記録するテーブルを管理します
 * @returns {Promise<Boolean>} 処理完了時に解決されるPromise
 */
async function updateFilledSummaryTimestamp(exchangeId, symbol) {
  // 約定サマリー更新時間テーブルのキー
  const timestampKey = `summary:filledSummaryTimestamp:${exchangeId}:${symbol}`;
  const timestamp = Date.now();
  
  // 更新時間を設定
  await client.set(timestampKey, timestamp);
  
  return true;
}

/**
 * 特定の約定サマリーの最終更新時間を取得する関数
 * @returns {Promise<Number|null>} 最終更新時間（ミリ秒）またはnull
 */
async function getFilledSummaryTimestamp(exchange, symbol) {
  // 約定サマリー更新時間テーブルのキー
  const timestampKey = `summary:filledSummaryTimestamp:${exchange.id}:${symbol}`;
  
  // 更新時間を取得
  const timestamp = await client.get(timestampKey);
  // console.log('約定サマリー更新時間:', timestamp);
  
  return parseInt(timestamp || 0);
}


// モジュールのエクスポートに新しい関数を追加
module.exports = {
  initialize,
  addTrade,
  addFilledTrade,
  getTradeRecordsAsObject,
  getLatestTradeAmount,
  getFilledHistory, // 関数名を変更
  getOrderHistory,
  getTradeSummary,
  getFilledSummary,
  getOrderStrategyKeyByOrderId,
  getOrderDetailsByOrderId,
  updateFilledSummaryTimestamp,
  getFilledSummaryTimestamp,
  getOrderPairs,
  saveOrderPairs
}