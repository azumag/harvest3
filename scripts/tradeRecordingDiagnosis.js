/**
 * 取引記録（filled_trade）の問題診断
 * なぜ約定済み取引が0件なのかを調査
 */
require('dotenv').config();
const redis = require('redis');
const ccxt = require('ccxt');

async function tradeRecordingDiagnosis() {
  try {
    console.log('=== 取引記録問題診断 ===');
    
    // Redisクライアント接続
    const client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();
    
    // 取引所接続
    const exchange = new ccxt.bitbank({
      apiKey: process.env.BB_API_KEY,
      secret: process.env.BB_API_SECRET
    });
    
    // 1. Redis内の取引関連データ確認
    console.log('\n1. Redis内取引データ確認');
    
    const allKeys = await client.keys('*');
    const tradeKeys = allKeys.filter(key => key.includes('trade') || key.includes('filled'));
    console.log(`取引関連キー: ${tradeKeys.length}件`);
    
    const summaryKeys = allKeys.filter(key => key.startsWith('trade_summary:'));
    console.log(`取引サマリーキー: ${summaryKeys.length}件`);
    
    if (summaryKeys.length > 0) {
      console.log('\n取引サマリー例（最初の5件）:');
      for (const key of summaryKeys.slice(0, 5)) {
        try {
          const data = await client.hGetAll(key);
          console.log(`${key}:`);
          console.log(`  netPosition: ${data.netPosition || '0'}`);
          console.log(`  buyAmount: ${data.buyAmount || '0'}`);
          console.log(`  sellAmount: ${data.sellAmount || '0'}`);
          console.log(`  lastUpdate: ${data.lastUpdate ? new Date(parseInt(data.lastUpdate)).toLocaleString('ja-JP') : 'なし'}`);
        } catch (err) {
          console.log(`  エラー: ${err.message}`);
        }
      }
    }
    
    // 2. 実際の取引所履歴との比較（サンプル通貨）
    console.log('\n2. 取引所履歴との比較分析');
    
    const testSymbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'XYM/JPY'];
    
    for (const symbol of testSymbols.slice(0, 3)) { // 最初の3通貨のみテスト
      try {
        console.log(`\n--- ${symbol} 分析 ---`);
        
        // 取引所から最近の取引履歴を取得
        const trades = await exchange.fetchMyTrades(symbol, undefined, 10); // 最新10件
        console.log(`取引所記録: ${trades.length}件`);
        
        if (trades.length > 0) {
          const latestTrade = trades[trades.length - 1];
          console.log(`最新取引: ${latestTrade.side} ${latestTrade.amount} @ ¥${latestTrade.price} (${new Date(latestTrade.timestamp).toLocaleString('ja-JP')})`);
        }
        
        // Redis内のサマリーと比較
        const summaryKey = `trade_summary:${exchange.id}:${symbol}`;
        const exists = await client.exists(summaryKey);
        
        if (exists) {
          const summary = await client.hGetAll(summaryKey);
          console.log(`Redis記録: netPosition=${summary.netPosition || '0'}, lastUpdate=${summary.lastUpdate ? new Date(parseInt(summary.lastUpdate)).toLocaleString('ja-JP') : 'なし'}`);
        } else {
          console.log('Redis記録: サマリーなし');
        }
        
        // 差異を確認
        if (trades.length > 0 && !exists) {
          console.log('⚠️ 取引所に履歴があるがRedisにサマリーがない');
        } else if (trades.length === 0 && exists) {
          console.log('⚠️ 取引所に履歴がないがRedisにサマリーがある');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // API制限回避
        
      } catch (error) {
        console.log(`${symbol} エラー: ${error.message}`);
      }
    }
    
    // 3. updateFilledTrades動作テスト
    console.log('\n3. updateFilledTrades動作テスト');
    
    // 手動でupdateFilledTradesを実行してみる
    try {
      const { updateFilledTrades } = require('../src/database/manager');
      console.log('updateFilledTrades関数をテスト実行中...');
      
      const result = await updateFilledTrades(exchange, 'BTC/JPY');
      console.log(`updateFilledTrades結果: ${result}件の約定を処理`);
      
    } catch (error) {
      console.log(`updateFilledTrades テストエラー: ${error.message}`);
    }
    
    // 4. 問題診断
    console.log('\n4. 問題診断');
    
    const issues = [];
    
    if (tradeKeys.length === 0) {
      issues.push('🚨 filled_trade キーが全く存在しない');
    }
    
    if (summaryKeys.length === 0) {
      issues.push('🚨 trade_summary キーが全く存在しない');
    }
    
    // 実際のポジション数と比較
    const positionKeys = allKeys.filter(key => key.startsWith('position:'));
    const openPositions = [];
    
    for (const key of positionKeys.slice(0, 10)) { // 最初の10件チェック
      try {
        const data = await client.hGetAll(key);
        if (data.status === 'open') {
          openPositions.push({
            symbol: data.symbol,
            amount: parseFloat(data.amount) || 0,
            strategy: data.strategy
          });
        }
      } catch (err) {
        // エラーはスキップ
      }
    }
    
    if (openPositions.length > 0 && summaryKeys.length === 0) {
      issues.push('🚨 オープンポジションは存在するが取引サマリーがない');
    }
    
    console.log('\n発見された問題:');
    if (issues.length === 0) {
      console.log('✅ 明確な問題は検出されませんでした');
    } else {
      issues.forEach(issue => console.log(`  ${issue}`));
    }
    
    // 5. 推奨修復アクション
    console.log('\n5. 推奨修復アクション');
    
    if (summaryKeys.length === 0) {
      console.log('- 全通貨ペアでupdateFilledTradesを強制実行');
      console.log('- 取引履歴の再構築スクリプト実行');
    }
    
    if (openPositions.length > 0 && summaryKeys.length === 0) {
      console.log('- ポジション情報から取引サマリーを逆算で再構築');
      console.log('- データ整合性修復スクリプト実行');
    }
    
    console.log('- updateFilledTrades関数の例外処理強化');
    console.log('- 定期的な取引記録同期の実装');
    
    await client.quit();
    console.log('\n✅ 取引記録診断完了');
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

tradeRecordingDiagnosis();