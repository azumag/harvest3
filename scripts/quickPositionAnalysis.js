/**
 * 簡易ポジション分析（Redis直接アクセス）
 */
require('dotenv').config();
const redis = require('redis');

async function quickPositionAnalysis() {
  try {
    console.log('=== 簡易ポジション分析 ===');
    
    // Redisクライアント接続
    const client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();
    
    // 1. 現在のポジション確認
    const positionKeys = await client.keys('position:*');
    console.log(`\n総ポジション数: ${positionKeys.length}件`);
    
    const stats = {
      long: 0,
      short: 0,
      open: 0,
      closed: 0,
      byStrategy: {},
      bySymbol: {},
      totalValue: 0
    };
    
    for (const key of positionKeys) {
      try {
        const data = await client.hGetAll(key);
        
        // 基本統計
        if (data.status === 'open') {
          stats.open++;
          if (data.side === 'long' || data.side === 'buy') {
            stats.long++;
          } else {
            stats.short++;
          }
          
          // 戦略別
          const strategy = data.strategy || 'unknown';
          stats.byStrategy[strategy] = (stats.byStrategy[strategy] || 0) + 1;
          
          // 通貨別
          const symbol = data.symbol || 'unknown';
          stats.bySymbol[symbol] = (stats.bySymbol[symbol] || 0) + 1;
          
          // 価値計算
          const value = parseFloat(data.amount || 0) * parseFloat(data.entryPrice || 0);
          stats.totalValue += value;
        } else {
          stats.closed++;
        }
      } catch (err) {
        console.warn(`ポジション読み取りエラー: ${key}`);
      }
    }
    
    console.log(`\nオープンポジション: ${stats.open}件`);
    console.log(`クローズ済み: ${stats.closed}件`);
    console.log(`ロング: ${stats.long}件`);
    console.log(`ショート: ${stats.short}件`);
    console.log(`総ポジション価値: ¥${stats.totalValue.toLocaleString()}`);
    
    // 偏り計算
    if (stats.open > 0) {
      const bias = ((stats.long - stats.short) / stats.open * 100).toFixed(1);
      console.log(`ポジション偏り: ${bias}% (プラスはロング偏り)`);
    }
    
    // 戦略別統計
    console.log('\n戦略別ポジション:');
    Object.entries(stats.byStrategy)
      .sort(([,a], [,b]) => b - a)
      .forEach(([strategy, count]) => {
        console.log(`  ${strategy}: ${count}件`);
      });
    
    // 通貨別統計
    console.log('\n通貨ペア別ポジション:');
    Object.entries(stats.bySymbol)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([symbol, count]) => {
        console.log(`  ${symbol}: ${count}件`);
      });
    
    // 2. 未約定オーダー確認
    const pendingKeys = await client.keys('pending_order:*');
    console.log(`\n未約定オーダー: ${pendingKeys.length}件`);
    
    const orderStats = { buy: 0, sell: 0 };
    for (const key of pendingKeys) {
      try {
        const data = await client.hGetAll(key);
        if (data.side === 'buy') {
          orderStats.buy++;
        } else {
          orderStats.sell++;
        }
      } catch (err) {
        console.warn(`オーダー読み取りエラー: ${key}`);
      }
    }
    
    console.log(`買い注文: ${orderStats.buy}件`);
    console.log(`売り注文: ${orderStats.sell}件`);
    
    // 3. リスク評価
    console.log('\n=== リスク評価 ===');
    
    if (stats.short === 0 && stats.long > 0) {
      console.log('⚠️ 【重大】ショートポジションが全く存在しない');
    }
    
    if (stats.open > 50) {
      console.log('⚠️ ポジション数が多すぎる（50件超）');
    }
    
    const biasThreshold = 80;
    if (stats.open > 0) {
      const bias = Math.abs((stats.long - stats.short) / stats.open * 100);
      if (bias > biasThreshold) {
        console.log(`⚠️ 極端なポジション偏り: ${bias.toFixed(1)}%`);
      }
    }
    
    if (orderStats.sell === 0 && orderStats.buy > 10) {
      console.log('⚠️ 売り注文が全く存在しない');
    }
    
    await client.quit();
    console.log('\n✅ 分析完了');
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

quickPositionAnalysis();