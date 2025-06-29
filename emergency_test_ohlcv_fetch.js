// 緊急診断：OHLCVデータ取得の実際のテスト
const ccxt = require('ccxt');

async function testOHLCVFetch() {
  console.log('🔍 OHLCVデータ取得の緊急診断開始...');
  
  try {
    // bitbank取引所インスタンス作成
    const exchange = new ccxt.bitbank({
      rateLimit: 200,
      enableRateLimit: true,
    });
    
    console.log('✅ bitbank取引所インスタンス作成成功');
    
    // 市場データ取得テスト
    console.log('📊 市場データ取得テスト中...');
    const markets = await exchange.loadMarkets();
    console.log('✅ 市場データ取得成功:', Object.keys(markets).slice(0, 5));
    
    // BTC/JPYのOHLCVデータ取得テスト
    console.log('📈 BTC/JPY OHLCVデータ取得テスト中...');
    const symbol = 'BTC/JPY';
    const timeframe = '1h';
    const limit = 24; // 24時間分
    
    const ohlcvData = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    console.log(`✅ ${symbol} ${timeframe} OHLCVデータ取得成功`);
    console.log(`データ件数: ${ohlcvData.length}`);
    
    if (ohlcvData.length > 0) {
      const lastCandle = ohlcvData[ohlcvData.length - 1];
      console.log('最新のローソク足データ:');
      console.log(`  タイムスタンプ: ${new Date(lastCandle[0]).toISOString()}`);
      console.log(`  開始価格: ${lastCandle[1]}`);
      console.log(`  最高価格: ${lastCandle[2]}`);
      console.log(`  最低価格: ${lastCandle[3]}`);
      console.log(`  終了価格: ${lastCandle[4]}`);
      console.log(`  出来高: ${lastCandle[5]}`);
    }
    
    console.log('🎉 OHLCVデータ取得テスト完了 - 正常動作確認');
    return { success: true, dataLength: ohlcvData.length };
    
  } catch (error) {
    console.error('❌ OHLCVデータ取得エラー:', error.message);
    console.error('エラー詳細:', error);
    return { success: false, error: error.message };
  }
}

// テスト実行
testOHLCVFetch()
  .then(result => {
    console.log('🔬 診断結果:', result);
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('🚨 予期しないエラー:', error);
    process.exit(1);
  });