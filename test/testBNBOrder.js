/**
 * BNB/JPYの注文ステータスをチェックするためのテストスクリプト
 */
const { exchangeBB } = require('../src/config');

async function checkBNBJPY() {
  try {
    console.log('='.repeat(50));
    console.log('bitbank BNB/JPY 注文ステータスチェック開始');
    console.log('='.repeat(50));
    
    // 取引所接続確認
    console.log('bitbank APIに接続中...');
    const markets = await exchangeBB.loadMarkets();
    console.log('取引所に接続しました。BNB/JPYのサポート状況を確認します...');
    
    const symbol = 'BNB/JPY';
    
    // マーケット情報の確認
    if (symbol in markets) {
      console.log(`${symbol} はbitbankでサポートされています。`);
      const marketInfo = markets[symbol];
      console.log(`${symbol}の情報:`, {
        id: marketInfo.id,
        baseId: marketInfo.baseId,
        quoteId: marketInfo.quoteId,
        active: marketInfo.active
      });
    } else {
      console.log(`${symbol} はbitbankでサポートされていません。`);
      console.log('サポートされているマーケット:', Object.keys(markets));
      return; // マーケットがサポートされていない場合は終了
    }
    
    // オープン注文の確認
    console.log(`${symbol} のオープン注文を確認します...`);
    try {
      const openOrders = await exchangeBB.fetchOpenOrders(symbol);
      console.log(`${openOrders.length}件のオープン注文があります。`);
    } catch (error) {
      console.error(`オープン注文の確認中にエラーが発生しました:`, error.message);
      
      // エラーコードとエラータイプの詳細を表示
      if (error.name) {
        console.log(`エラー名: ${error.name}`);
      }
      if (error.code) {
        console.log(`エラーコード: ${error.code}`);
      }
    }
    
  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.stack) {
      console.error('スタックトレース:', error.stack);
    }
  }
}

// スクリプト実行
checkBNBJPY();