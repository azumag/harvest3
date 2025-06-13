const { initRedisClient } = require('../src/database/redisClient');
const { getTradeSummary } = require('../src/database/redisDatabase');
const { config } = require('../src/config');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');
const { formattedAvailableAmount } = require('../src/database/manager');

async function compareExchangeVsSummary() {
  try {
    await initRedisClient();
    console.log('=== 取引所残高 vs サマリー合計の比較 ===\n');
    
    const exchange = config.exchanges.bitbank.instance;
    const exchangeId = 'bitbank';
    
    // 主要通貨ペア
    const symbols = [
      'BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'BCH/JPY',
      'SOL/JPY', 'DOT/JPY', 'XLM/JPY', 'LINK/JPY', 'GALA/JPY',
      'APE/JPY', 'MANA/JPY', 'SAND/JPY', 'CHZ/JPY', 'OAS/JPY',
      'OMG/JPY', 'ADA/JPY', 'DOGE/JPY', 'MATIC/JPY', 'AVAX/JPY'
    ];
    
    // 有効な戦略
    const activeStrategies = Object.keys(config.strategies).filter(key => 
      config.strategies[key].enabled
    );
    
    console.log(`有効な戦略: ${activeStrategies.join(', ')}\n`);
    
    // 実際の残高を取得
    const balance = await exchange.fetchBalance();
    
    // 通貨別の比較結果
    const results = [];
    const discrepancies = [];
    
    for (const symbol of symbols) {
      const baseAsset = symbol.split('/')[0];
      
      // 取引所の実残高
      const exchangeBalance = {
        total: balance.total[baseAsset] || 0,
        free: balance.free[baseAsset] || 0,
        used: balance.used[baseAsset] || 0
      };
      
      // 全戦略のサマリーを合計
      let summaryTotal = {
        netPosition: 0,
        buyAmount: 0,
        sellAmount: 0,
        availableToSell: 0,
        strategies: {}
      };
      
      // 各戦略の詳細を取得
      for (const strategyKey of activeStrategies) {
        const summary = await getTradeSummary({
          exchangeId: exchangeId,
          symbol: symbol,
          strategyKey: strategyKey
        });
        
        if (summary && summary.netPosition > 0) {
          // formattedAvailableAmountで実際に売却可能な量を取得
          const availableAmount = await formattedAvailableAmount(
            exchange, 
            symbol, 
            strategyKey, 
            4 // デフォルトの精度
          );
          
          summaryTotal.netPosition += summary.netPosition;
          summaryTotal.buyAmount += summary.buyAmount;
          summaryTotal.sellAmount += summary.sellAmount;
          summaryTotal.availableToSell += availableAmount;
          
          summaryTotal.strategies[strategyKey] = {
            netPosition: summary.netPosition,
            buyAmount: summary.buyAmount,
            sellAmount: summary.sellAmount,
            availableToSell: availableAmount
          };
        }
      }
      
      // 比較（有意な残高がある場合のみ）
      if (exchangeBalance.total > 0.0001 || summaryTotal.netPosition > 0.0001) {
        const discrepancy = Math.abs(exchangeBalance.total - summaryTotal.netPosition);
        const discrepancyPercent = exchangeBalance.total > 0 ? 
          (discrepancy / exchangeBalance.total * 100) : 0;
        
        const result = {
          symbol,
          baseAsset,
          exchange: exchangeBalance,
          summary: summaryTotal,
          discrepancy,
          discrepancyPercent
        };
        
        results.push(result);
        
        // 1%以上または0.01以上の乖離
        if (discrepancy > 0.01 && discrepancyPercent > 1) {
          discrepancies.push(result);
        }
        
        // 詳細表示
        console.log(`📊 ${symbol}`);
        console.log(`  取引所残高: Total=${exchangeBalance.total.toFixed(6)}, Free=${exchangeBalance.free.toFixed(6)}, Used=${exchangeBalance.used.toFixed(6)}`);
        console.log(`  サマリー合計: ${summaryTotal.netPosition.toFixed(6)} (買い=${summaryTotal.buyAmount.toFixed(2)}, 売り=${summaryTotal.sellAmount.toFixed(2)})`);
        console.log(`  売却可能量合計: ${summaryTotal.availableToSell.toFixed(6)}`);
        
        if (Object.keys(summaryTotal.strategies).length > 0) {
          console.log(`  戦略別内訳:`);
          for (const [strategy, data] of Object.entries(summaryTotal.strategies)) {
            console.log(`    ${strategy}: 正味=${data.netPosition.toFixed(6)}, 売却可能=${data.availableToSell.toFixed(6)}`);
          }
        }
        
        if (discrepancy > 0.01) {
          const status = discrepancyPercent > 1 ? '❌' : '⚠️';
          console.log(`  ${status} 乖離: ${discrepancy.toFixed(6)} (${discrepancyPercent.toFixed(2)}%)`);
        } else {
          console.log(`  ✅ 整合性OK`);
        }
        console.log();
      }
    }
    
    // サマリーレポート
    console.log('='.repeat(80));
    console.log('📋 比較結果サマリー');
    console.log('='.repeat(80));
    console.log(`検査通貨数: ${results.length}`);
    console.log(`不整合検出: ${discrepancies.length}件\n`);
    
    if (discrepancies.length > 0) {
      console.log('🚨 主要な不整合:');
      const topDiscrepancies = discrepancies
        .sort((a, b) => b.discrepancyPercent - a.discrepancyPercent)
        .slice(0, 5);
      
      for (const item of topDiscrepancies) {
        console.log(`  ${item.symbol}: ${item.discrepancyPercent.toFixed(2)}%乖離`);
        console.log(`    取引所: ${item.exchange.total.toFixed(6)}`);
        console.log(`    サマリー: ${item.summary.netPosition.toFixed(6)}`);
        console.log(`    差分: ${item.discrepancy.toFixed(6)}\n`);
      }
    }
    
    // Discord通知
    await sendDiscordReport(results, discrepancies);
    
  } catch (error) {
    console.error('比較エラー:', error);
  }
  
  process.exit(0);
}

async function sendDiscordReport(results, discrepancies) {
  const severity = discrepancies.length > 0 ? '🚨' : '✅';
  const status = discrepancies.length > 0 ? '不整合検出' : '正常';
  
  let message = `${severity} [残高比較] 取引所 vs サマリー ${status}\n\n`;
  message += `📊 検査通貨数: ${results.length}\n`;
  message += `❌ 不整合件数: ${discrepancies.length}\n`;
  message += `🕐 実行時刻: ${new Date().toLocaleString('ja-JP')}\n`;

  if (discrepancies.length > 0) {
    message += '\n🚨 主要な不整合:\n';
    
    const topIssues = discrepancies
      .sort((a, b) => b.discrepancyPercent - a.discrepancyPercent)
      .slice(0, 5);
    
    for (const issue of topIssues) {
      message += `• ${issue.symbol}: ${issue.discrepancyPercent.toFixed(2)}%乖離\n`;
      message += `  取引所: ${issue.exchange.total.toFixed(6)}, サマリー: ${issue.summary.netPosition.toFixed(6)}\n`;
    }
  }

  try {
    if (discrepancies.length > 0) {
      await postErrorToDiscord(message);
    } else {
      await postOrderToDiscord(message);
    }
  } catch (error) {
    console.error('Discord通知の送信に失敗:', error.message);
  }
}

// 実行
compareExchangeVsSummary().catch(console.error);