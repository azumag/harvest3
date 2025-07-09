const { getOHLCVCacheManager, resetOHLCVCacheManager } = require('../src/database/ohlcvCache');

/**
 * Redis モックオブジェクト（テスト用）
 */
const mockRedisDatabase = {
  async getOHLCVRedis(exchangeId, symbol, timeframe) {
    // モックデータを返す
    return [
      [Date.now() - 900000, 100, 110, 95, 105, 1000], // 15分前
      [Date.now() - 300000, 105, 115, 100, 110, 1500], // 5分前
      [Date.now(), 110, 120, 105, 115, 2000]            // 現在
    ];
  },

  async getOHLCVRedisTimestamp(exchangeId, symbol, timeframe) {
    return Date.now() - 60000; // 1分前
  },

  async updateOHLCVRedis(exchangeId, symbol, timeframe, data) {
    console.log(`[MockRedis] updateOHLCVRedis: ${exchangeId} ${symbol} ${timeframe} (${data.length}件)`);
    return true;
  },

  async getBacktestOHLCVRedisBeforeTimestamp(exchangeId, symbol, timeframe, timestamp, limit) {
    // バックテスト用モックデータ
    const testData = [];
    for (let i = 0; i < limit; i++) {
      testData.push([
        timestamp - (i * 900000), // 15分間隔
        100 + i, 110 + i, 95 + i, 105 + i, 1000 + i
      ]);
    }
    return testData.reverse(); // 古い順にソート
  },

  async updateBacktestOHLCVRedisSortedSet(exchangeId, symbol, timeframe, ohlcv) {
    console.log(`[MockRedis] updateBacktestOHLCV: ${exchangeId} ${symbol} ${timeframe}`);
    return true;
  }
};

/**
 * OHLCVキャッシュマネージャーの基本テスト
 */
async function testOHLCVCache() {
  console.log('=== OHLCV Cache Manager Test ===');

  try {
    // キャッシュマネージャーの初期化
    const cacheManager = getOHLCVCacheManager(mockRedisDatabase, {
      memoryTTL: 30, // テスト用に30秒
      maxMemoryKeys: 100
    });

    const exchangeId = 'bitbank';
    const symbol = 'BTC/JPY';
    const timeframe = '15m';
    const limit = 10;

    console.log('初期統計:', cacheManager.getStats());

    // 1. 最初の取得（キャッシュミス）
    console.log('\\n1. 最初の取得（キャッシュミス予想）');
    const result1 = await cacheManager.get(exchangeId, symbol, timeframe, limit);
    console.log('取得結果1:', result1 ? `${result1.length}件のデータ` : 'null');

    // 2. データをキャッシュに保存
    console.log('\\n2. データをキャッシュに保存');
    const testData = [
      [Date.now() - 1800000, 100, 110, 95, 105, 1000],
      [Date.now() - 900000, 105, 115, 100, 110, 1500],
      [Date.now(), 110, 120, 105, 115, 2000]
    ];

    await cacheManager.set(exchangeId, symbol, timeframe, limit, testData);
    console.log('キャッシュ保存完了');

    // 3. 二回目の取得（メモリキャッシュヒット）
    console.log('\\n3. 二回目の取得（メモリヒット予想）');
    const result2 = await cacheManager.get(exchangeId, symbol, timeframe, limit);
    console.log('取得結果2:', result2 ? `${result2.length}件のデータ` : 'null');

    // 4. 異なるlimitでの取得
    console.log('\\n4. 異なるlimitでの取得');
    const result3 = await cacheManager.get(exchangeId, symbol, timeframe, 5);
    console.log('取得結果3 (limit=5):', result3 ? `${result3.length}件のデータ` : 'null');

    // 5. バックテストモードでの取得
    console.log('\\n5. バックテストモードでの取得');
    const backtestOptions = {
      backtest: {
        timestamp: Date.now() - 3600000 // 1時間前
      }
    };
    const result4 = await cacheManager.get(exchangeId, symbol, timeframe, limit, backtestOptions);
    console.log('バックテスト結果:', result4 ? `${result4.length}件のデータ` : 'null');

    // 6. 統計情報の確認
    console.log('\\n6. 最終統計');
    console.log('キャッシュ統計:', cacheManager.getStats());

    // 7. キャッシュの無効化テスト
    console.log('\\n7. キャッシュ無効化テスト');
    await cacheManager.invalidate(exchangeId, symbol, timeframe);
    const result5 = await cacheManager.get(exchangeId, symbol, timeframe, limit);
    console.log('無効化後の取得:', result5 ? `${result5.length}件のデータ` : 'null');

  } catch (error) {
    console.error('キャッシュテストエラー:', error);
  }
}

/**
 * TTL（Time To Live）テスト
 */
async function testCacheTTL() {
  console.log('\\n=== Cache TTL Test ===');

  try {
    resetOHLCVCacheManager(); // リセット
    const cacheManager = getOHLCVCacheManager(mockRedisDatabase, {
      memoryTTL: 2, // 2秒でテスト
      maxMemoryKeys: 10
    });

    const exchangeId = 'bitbank';
    const symbol = 'ETH/JPY';
    const timeframe = '15m';
    const testData = [[Date.now(), 100, 110, 95, 105, 1000]];

    // データを保存
    await cacheManager.set(exchangeId, symbol, timeframe, 10, testData);
    console.log('データをキャッシュに保存');

    // すぐに取得（ヒット予想）
    const result1 = await cacheManager.get(exchangeId, symbol, timeframe, 10);
    console.log('即座の取得:', result1 ? 'ヒット' : 'ミス');

    // 3秒待機
    console.log('3秒待機中...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 再取得（ミス予想）
    const result2 = await cacheManager.get(exchangeId, symbol, timeframe, 10);
    console.log('3秒後の取得:', result2 ? 'ヒット' : 'ミス');

    console.log('TTL統計:', cacheManager.getStats());

  } catch (error) {
    console.error('TTLテストエラー:', error);
  }
}

/**
 * メイン実行
 */
async function main() {
  try {
    await testOHLCVCache();
    await testCacheTTL();

    console.log('\\n=== Cache Test Completed ===');
  } catch (error) {
    console.error('メインキャッシュテストエラー:', error);
  } finally {
    // クリーンアップ
    resetOHLCVCacheManager();
  }
}

// テスト実行
if (require.main === module) {
  main();
}

module.exports = {
  testOHLCVCache,
  testCacheTTL
};