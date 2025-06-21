#!/usr/bin/env node

/**
 * trade_summaryを再構築するスクリプト
 * 
 * 残っているpositionキーから戦略別・通貨別のサマリーを再計算し、
 * 正しいtrade_summaryキーを作成する
 */

const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

async function rebuildTradeSummary() {
  console.log('🔧 trade_summary再構築開始');
  
  try {
    await initializeRedis();
    const client = getClient();
    
    // 既存のtrade_summaryキーを削除
    const existingSummaries = await client.keys('trade_summary:*');
    if (existingSummaries.length > 0) {
      await client.del(existingSummaries);
      console.log(`✅ 既存のtrade_summary削除: ${existingSummaries.length}件`);
    }
    
    // 全positionキーを取得
    const positionKeys = await client.keys('position:*');
    console.log(`📊 処理対象のposition: ${positionKeys.length}件`);
    
    const summaryByStrategy = new Map(); // key: 'exchange:symbol:strategy', value: { buy, sell, netPosition }
    
    // 各positionを処理
    for (const key of positionKeys) {
      try {
        const position = await client.hGetAll(key);
        
        const exchange = position.exchangeId;
        const symbol = position.symbol;
        const strategy = position.strategyKey;
        const side = position.side;
        const amount = parseFloat(position.amount) || 0;
        const entryPrice = parseFloat(position.entryPrice) || 0;
        
        const summaryKey = `${exchange}:${symbol}:${strategy}`;
        
        if (!summaryByStrategy.has(summaryKey)) {
          summaryByStrategy.set(summaryKey, {
            exchange,
            symbol,
            strategy,
            buyAmount: 0,
            sellAmount: 0,
            totalBuyCost: 0,
            totalSellRevenue: 0,
            netPosition: 0,
            count: 0
          });
        }
        
        const summary = summaryByStrategy.get(summaryKey);
        summary.count++;
        
        if (side === 'buy') {
          summary.buyAmount += amount;
          summary.totalBuyCost += (amount * entryPrice);
          summary.netPosition += amount;
        } else if (side === 'sell') {
          summary.sellAmount += amount;
          summary.totalSellRevenue += (amount * entryPrice);
          summary.netPosition -= amount;
        }
        
      } catch (error) {
        console.error(`❌ position処理エラー: ${key} - ${error.message}`);
      }
    }
    
    console.log(`\n📈 再構築されるサマリー: ${summaryByStrategy.size}件`);
    
    // trade_summaryキーを作成
    let createdCount = 0;
    for (const [summaryKey, data] of summaryByStrategy) {
      const redisKey = `trade_summary:${data.exchange}:${data.symbol}:${data.strategy}`;
      
      await client.hSet(redisKey, {
        buyAmount: data.buyAmount.toFixed(8),
        sellAmount: data.sellAmount.toFixed(8),
        totalBuyCost: data.totalBuyCost.toFixed(8),
        totalSellRevenue: data.totalSellRevenue.toFixed(8),
        netPosition: data.netPosition.toFixed(8),
        avgBuyPrice: data.buyAmount > 0 ? (data.totalBuyCost / data.buyAmount).toFixed(8) : '0',
        avgSellPrice: data.sellAmount > 0 ? (data.totalSellRevenue / data.sellAmount).toFixed(8) : '0',
        realizedPnL: '0', // 再計算困難のため0に設定
        totalFee: '0',    // 再計算困難のため0に設定
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      createdCount++;
      
      if (data.netPosition !== 0) {
        console.log(`  📝 ${data.exchange}:${data.symbol}:${data.strategy} - netPosition: ${data.netPosition.toFixed(6)} (positions: ${data.count})`);
      }
    }
    
    console.log(`\n✅ trade_summary再構築完了: ${createdCount}件作成`);
    
    // 結果を通貨別に集計
    const currencyTotals = new Map();
    for (const [, data] of summaryByStrategy) {
      const currency = data.symbol.split('/')[0];
      if (!currencyTotals.has(currency)) {
        currencyTotals.set(currency, 0);
      }
      currencyTotals.set(currency, currencyTotals.get(currency) + data.netPosition);
    }
    
    console.log('\n📊 通貨別Bot管理残高:');
    for (const [currency, total] of currencyTotals) {
      if (Math.abs(total) > 0.000001) {
        console.log(`  ${currency}: ${total.toFixed(8)}`);
      }
    }
    
  } catch (error) {
    console.error('❌ 再構築エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  rebuildTradeSummary().then(() => {
    console.log('\n🎉 再構築処理完了');
    process.exit(0);
  }).catch((error) => {
    console.error('❌ 再構築失敗:', error);
    process.exit(1);
  });
}

module.exports = { rebuildTradeSummary };