/**
 * 売りシグナル生成の詳細分析
 * なぜ売りシグナルが実行されていないのかを突き止める
 */
require('dotenv').config();
const redis = require('redis');

async function deepSignalAnalysis() {
  try {
    console.log('=== 売りシグナル生成詳細分析 ===');
    
    // Redisクライアント接続
    const client = redis.createClient({ url: 'redis://localhost:6379' });
    await client.connect();
    
    // 1. 戦略シグナル履歴の確認
    console.log('\n1. 戦略シグナル履歴分析');
    const signalKeys = await client.keys('strategy_signal:*');
    console.log(`戦略シグナル記録数: ${signalKeys.length}件`);
    
    const signalStats = {
      buy: 0,
      sell: 0,
      none: 0,
      byStrategy: {},
      bySymbol: {},
      recent: []
    };
    
    // 最新1000件のシグナルを分析
    const recentSignals = [];
    for (const key of signalKeys.slice(-1000)) {
      try {
        const data = await client.hGetAll(key);
        const timestamp = parseInt(data.timestamp) || 0;
        
        recentSignals.push({
          key,
          strategy: data.strategy || 'unknown',
          symbol: data.symbol || 'unknown',
          signal: data.signal || 'none',
          price: parseFloat(data.price) || 0,
          timestamp
        });
      } catch (err) {
        // エラーはスキップ
      }
    }
    
    // 最新順にソート
    recentSignals.sort((a, b) => b.timestamp - a.timestamp);
    
    // 統計を計算
    recentSignals.forEach(signal => {
      signalStats[signal.signal] = (signalStats[signal.signal] || 0) + 1;
      
      if (!signalStats.byStrategy[signal.strategy]) {
        signalStats.byStrategy[signal.strategy] = { buy: 0, sell: 0, none: 0 };
      }
      signalStats.byStrategy[signal.strategy][signal.signal]++;
      
      if (!signalStats.bySymbol[signal.symbol]) {
        signalStats.bySymbol[signal.symbol] = { buy: 0, sell: 0, none: 0 };
      }
      signalStats.bySymbol[signal.symbol][signal.signal]++;
    });
    
    console.log(`\n全体シグナル統計（最新1000件）:`);
    console.log(`買い: ${signalStats.buy}件`);
    console.log(`売り: ${signalStats.sell}件`);
    console.log(`なし: ${signalStats.none}件`);
    
    if (signalStats.buy + signalStats.sell > 0) {
      const sellRatio = (signalStats.sell / (signalStats.buy + signalStats.sell) * 100).toFixed(1);
      console.log(`売りシグナル比率: ${sellRatio}%`);
    }
    
    // 2. 戦略別シグナル分析
    console.log('\n2. 戦略別シグナル生成状況:');
    Object.entries(signalStats.byStrategy).forEach(([strategy, stats]) => {
      const total = stats.buy + stats.sell + stats.none;
      const sellPercent = total > 0 ? (stats.sell / total * 100).toFixed(1) : '0.0';
      console.log(`${strategy}: 買い${stats.buy}, 売り${stats.sell}, なし${stats.none} (売り率${sellPercent}%)`);
    });
    
    // 3. 最近の売りシグナル詳細
    console.log('\n3. 最近の売りシグナル（直近20件）:');
    const recentSellSignals = recentSignals
      .filter(s => s.signal === 'sell')
      .slice(0, 20);
    
    if (recentSellSignals.length === 0) {
      console.log('⚠️ 最近の売りシグナルが見つかりません！');
    } else {
      recentSellSignals.forEach((signal, index) => {
        const date = new Date(signal.timestamp).toLocaleString('ja-JP');
        console.log(`[${index + 1}] ${signal.strategy} - ${signal.symbol} @ ¥${signal.price.toLocaleString()} (${date})`);
      });
    }
    
    // 4. 売り注文実行状況の確認
    console.log('\n4. 売り注文実行状況確認');
    
    // 未約定売り注文
    const pendingKeys = await client.keys('pending_order:*');
    let sellOrders = 0;
    let buyOrders = 0;
    
    for (const key of pendingKeys) {
      try {
        const data = await client.hGetAll(key);
        if (data.side === 'sell') {
          sellOrders++;
        } else if (data.side === 'buy') {
          buyOrders++;
        }
      } catch (err) {
        // エラーはスキップ
      }
    }
    
    console.log(`未約定売り注文: ${sellOrders}件`);
    console.log(`未約定買い注文: ${buyOrders}件`);
    
    // 5. 約定済み取引の分析
    console.log('\n5. 約定済み取引分析');
    const tradeKeys = await client.keys('filled_trade:*');
    console.log(`約定済み取引記録: ${tradeKeys.length}件`);
    
    let filledBuy = 0;
    let filledSell = 0;
    const recentTrades = [];
    
    for (const key of tradeKeys.slice(-100)) { // 最新100件
      try {
        const data = await client.hGetAll(key);
        const timestamp = parseInt(data.timestamp) || 0;
        
        if (data.side === 'sell') {
          filledSell++;
        } else if (data.side === 'buy') {
          filledBuy++;
        }
        
        if (data.side === 'sell' && timestamp > Date.now() - 24 * 60 * 60 * 1000) {
          recentTrades.push({
            symbol: data.symbol,
            amount: data.amount,
            price: data.price,
            timestamp
          });
        }
      } catch (err) {
        // エラーはスキップ
      }
    }
    
    console.log(`約定済み買い取引: ${filledBuy}件`);
    console.log(`約定済み売り取引: ${filledSell}件`);
    console.log(`直近24時間の売り約定: ${recentTrades.length}件`);
    
    // 6. 問題分析と診断
    console.log('\n6. 問題診断');
    const issues = [];
    
    if (signalStats.sell === 0) {
      issues.push('🚨 売りシグナルが全く生成されていない');
    } else if (signalStats.sell < signalStats.buy * 0.1) {
      issues.push(`⚠️ 売りシグナル生成が異常に少ない (${(signalStats.sell / signalStats.buy * 100).toFixed(1)}%)`);
    }
    
    if (sellOrders === 0 && signalStats.sell > 0) {
      issues.push('🚨 売りシグナルは生成されているが売り注文が作成されていない');
    }
    
    if (filledSell === 0) {
      issues.push('🚨 売り取引が全く約定していない');
    }
    
    if (recentSellSignals.length > 0 && sellOrders === 0) {
      issues.push('⚠️ 最近売りシグナルがあったが未約定売り注文がない（実行エラーの可能性）');
    }
    
    if (issues.length === 0) {
      console.log('✅ 明確な技術的問題は検出されませんでした');
      console.log('💡 市場環境による買い偏りの可能性があります');
    } else {
      console.log('発見された問題:');
      issues.forEach(issue => console.log(`  ${issue}`));
    }
    
    // 7. 推奨アクション
    console.log('\n7. 推奨アクション');
    if (signalStats.sell === 0) {
      console.log('- 戦略アルゴリズムの売りシグナル生成ロジックを確認');
      console.log('- RSI、MACD等の売りシグナル条件が適切かチェック');
    }
    
    if (signalStats.sell > 0 && sellOrders === 0) {
      console.log('- executeSellOrder関数のエラーログを確認');
      console.log('- 資産残高チェックロジックの検証');
      console.log('- 売り注文の実行条件を緩和');
    }
    
    if (filledSell === 0 && sellOrders > 0) {
      console.log('- 売り注文の価格設定が適切かチェック');
      console.log('- 注文タイプ（limit/market）の見直し');
    }
    
    await client.quit();
    console.log('\n✅ 詳細分析完了');
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

deepSignalAnalysis();