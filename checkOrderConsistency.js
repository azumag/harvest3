/**
 * Redis未約定注文と取引所オープンオーダーの整合性チェック
 * Issue #191対応: 安全な不整合注文特定とクリーンアップ
 */
require('dotenv').config();
const ccxt = require('ccxt');

async function checkOrderConsistency() {
  try {
    console.log('=== Redis-取引所間 注文整合性チェック開始 ===');
    
    // Bitbank取引所インスタンス
    const exchange = new ccxt.bitbank({
      apiKey: process.env.BB_API_KEY,
      secret: process.env.BB_API_SECRET,
      sandbox: false,
      options: {
        enableUnifiedAccount: false,
        enableUnifiedMargin: false,
        defaultType: 'spot'
      }
    });
    
    await exchange.loadMarkets();
    
    // 取引所側の全オープンオーダーを取得
    console.log('\n1. 取引所側オープンオーダー取得中...');
    const symbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'XYM/JPY', 'ADA/JPY', 'DOT/JPY', 'LINK/JPY', 'MKR/JPY', 'ENJ/JPY', 'MATIC/JPY', 'ATOM/JPY', 'SAND/JPY', 'AXS/JPY', 'RENDER/JPY', 'OP/JPY', 'ARB/JPY', 'QTUM/JPY', 'FLR/JPY', 'GALA/JPY', 'OMG/JPY'];
    
    const exchangeOrders = new Map(); // orderID -> order data
    let totalExchangeOrders = 0;
    
    for (const symbol of symbols) {
      try {
        const orders = await exchange.fetchOpenOrders(symbol);
        orders.forEach(order => {
          exchangeOrders.set(order.id, order);
          totalExchangeOrders++;
        });
        
        if (orders.length > 0) {
          console.log(`  ${symbol}: ${orders.length}件`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100)); // API制限回避
      } catch (err) {
        // 通貨ペアが存在しない場合はスキップ
      }
    }
    
    console.log(`取引所側総オープンオーダー数: ${totalExchangeOrders}件`);
    
    // Redisクライアント接続（Docker内実行想定のため単純化）
    console.log('\n2. Redis未約定注文取得中...');
    const redis = require('redis');
    const client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();
    
    const pendingOrderKeys = await client.keys('pending_order:*');
    console.log(`Redis未約定注文数: ${pendingOrderKeys.length}件`);
    
    // 整合性チェック
    console.log('\n3. 整合性チェック実行中...');
    const results = {
      redisOnly: [], // Redisにのみ存在（削除対象）
      exchangeOnly: [], // 取引所にのみ存在（Redis追加要検討）
      consistent: [], // 両方に存在（正常）
      errors: []
    };
    
    // Redis側注文をチェック
    for (const pendingKey of pendingOrderKeys) {
      try {
        const pendingData = await client.hgetall(pendingKey);
        const orderId = pendingData.orderId;
        
        if (!orderId) {
          results.errors.push(`データ不整合: ${pendingKey}`);
          continue;
        }
        
        if (exchangeOrders.has(orderId)) {
          results.consistent.push({
            orderId,
            symbol: pendingData.symbol,
            redisKey: pendingKey
          });
        } else {
          const age = (Date.now() - parseInt(pendingData.timestamp)) / (1000 * 60 * 60);
          results.redisOnly.push({
            orderId,
            symbol: pendingData.symbol,
            redisKey: pendingKey,
            age: age.toFixed(1)
          });
        }
      } catch (error) {
        results.errors.push(`処理エラー: ${pendingKey} - ${error.message}`);
      }
    }
    
    // 取引所側のみの注文をチェック
    for (const [orderId, order] of exchangeOrders) {
      const hasInRedis = pendingOrderKeys.some(async key => {
        try {
          const data = await client.hgetall(key);
          return data.orderId === orderId;
        } catch {
          return false;
        }
      });
      
      if (!hasInRedis) {
        results.exchangeOnly.push({
          orderId,
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.price
        });
      }
    }
    
    // 結果出力
    console.log('\n=== 整合性チェック結果 ===');
    console.log(`✅ 整合性OK: ${results.consistent.length}件`);
    console.log(`⚠️  Redis削除対象: ${results.redisOnly.length}件`);
    console.log(`📝 取引所のみ存在: ${results.exchangeOnly.length}件`);
    console.log(`❌ エラー: ${results.errors.length}件`);
    
    if (results.redisOnly.length > 0) {
      console.log('\n=== Redis削除対象詳細 ===');
      results.redisOnly.forEach((item, index) => {
        console.log(`[${index + 1}] ${item.orderId} (${item.symbol}) - 経過: ${item.age}時間`);
      });
    }
    
    if (results.exchangeOnly.length > 0) {
      console.log('\n=== 取引所のみ存在詳細 ===');
      results.exchangeOnly.forEach((item, index) => {
        console.log(`[${index + 1}] ${item.orderId} (${item.symbol}) - ${item.side} ${item.amount} @ ${item.price}`);
      });
    }
    
    if (results.errors.length > 0) {
      console.log('\n=== エラー詳細 ===');
      results.errors.forEach((error, index) => {
        console.log(`[${index + 1}] ${error}`);
      });
    }
    
    // クリーンアップ提案
    console.log('\n=== 推奨アクション ===');
    if (results.redisOnly.length > 0) {
      console.log(`🔧 Redis削除実行: ${results.redisOnly.length}件の不整合注文をクリーンアップ`);
    }
    if (results.exchangeOnly.length > 0) {
      console.log(`📋 Redis追加検討: ${results.exchangeOnly.length}件の注文がRedis管理外`);
    }
    if (results.consistent.length === totalExchangeOrders && results.redisOnly.length === 0) {
      console.log('✅ 完全整合性確認済み');
    }
    
    await client.quit();
    console.log('\n✅ 整合性チェック完了');
    
    return results;
    
  } catch (error) {
    console.error('❌ 整合性チェックエラー:', error.message);
  }
}

checkOrderConsistency();