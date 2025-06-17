const { getOHLCVQueue, resetOHLCVQueue } = require('../src/database/ohlcvQueue');
const { config } = require('../src/config');

/**
 * OHLCV キューシステムの基本テスト
 */
async function testOHLCVQueue() {
  console.log('=== OHLCV Queue System Test ===');
  
  try {
    // キューシステムの初期化
    const queue = getOHLCVQueue({
      maxConcurrentRequests: 1,
      rateLimitMs: 500, // テスト用に短縮
      retryAttempts: 2,
      retryDelayMs: 1000
    });
    
    const exchange = config.exchanges.bitbank.instance;
    const symbol = 'BTC/JPY';
    const timeframe = '15m';
    const limit = 10;
    
    console.log('キューの初期状態:', queue.getQueueStatus());
    
    // 複数のリクエストを同時に送信（重複排除テスト）
    console.log('\n1. 重複リクエストテスト');
    const requests = [];
    
    // 同じリクエストを複数回送信
    for (let i = 0; i < 3; i++) {
      requests.push(
        queue.requestOHLCV(exchange, symbol, timeframe, limit, { test: true })
      );
    }
    
    // 異なる優先度のリクエストも追加
    requests.push(
      queue.requestOHLCV(exchange, symbol, timeframe, limit, { urgent: true, test: true })
    );
    requests.push(
      queue.requestOHLCV(exchange, symbol, timeframe, limit, { backtest: true, test: true })
    );
    
    console.log('リクエスト送信後のキュー状態:', queue.getQueueStatus());
    
    // 結果を待機
    const results = await Promise.allSettled(requests);
    
    console.log('\n2. テスト結果');
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`リクエスト ${index + 1}: 成功 (${result.value?.length || 0}件のデータ)`);
      } else {
        console.log(`リクエスト ${index + 1}: 失敗 - ${result.reason?.message}`);
      }
    });
    
    console.log('\n3. 最終統計');
    console.log('キューの最終状態:', queue.getQueueStatus());
    
    // 少し待ってから統計を確認
    setTimeout(() => {
      console.log('5秒後のキュー状態:', queue.getQueueStatus());
    }, 5000);
    
  } catch (error) {
    console.error('テストエラー:', error);
  }
}

/**
 * 優先度テスト
 */
async function testPriorityQueue() {
  console.log('\n=== Priority Queue Test ===');
  
  try {
    resetOHLCVQueue(); // リセット
    const queue = getOHLCVQueue({
      rateLimitMs: 1000
    });
    
    const exchange = config.exchanges.bitbank.instance;
    const symbol = 'ETH/JPY';
    const timeframe = '15m';
    
    // 低優先度リクエスト
    const lowPriorityPromise = queue.requestOHLCV(
      exchange, symbol, timeframe, 10, 
      { backtest: true, timestamp: Date.now() }
    );
    
    // 高優先度リクエスト（後から送信）
    setTimeout(() => {
      queue.requestOHLCV(
        exchange, symbol, timeframe, 10,
        { urgent: true }
      ).then(() => {
        console.log('高優先度リクエスト完了');
      });
    }, 100);
    
    console.log('優先度テスト開始 - 低優先度を先に送信、高優先度を後から送信');
    
    await lowPriorityPromise;
    console.log('低優先度リクエスト完了');
    
  } catch (error) {
    console.error('優先度テストエラー:', error);
  }
}

/**
 * メイン実行
 */
async function main() {
  try {
    await testOHLCVQueue();
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒待機
    await testPriorityQueue();
    
    console.log('\n=== Test Completed ===');
  } catch (error) {
    console.error('メインテストエラー:', error);
  } finally {
    // クリーンアップ
    setTimeout(() => {
      resetOHLCVQueue();
      process.exit(0);
    }, 7000);
  }
}

// テスト実行
if (require.main === module) {
  main();
}

module.exports = {
  testOHLCVQueue,
  testPriorityQueue
};