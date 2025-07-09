/**
 * Bitbankがサポートしている市場をリストアップするスクリプト
 */
const ccxt = require('ccxt');
require('dotenv').config();

async function listBitbankMarkets() {
  try {
    console.log('Bitbankのサポート市場を確認します...');

    // Bitbank取引所のインスタンスを作成
    const exchange = new ccxt.bitbank({
      enableRateLimit: true
      // APIキー不要
    });

    // 市場情報を取得
    const markets = await exchange.loadMarkets();

    console.log(`Bitbankは${Object.keys(markets).length}の市場をサポートしています:`);
    console.log(Object.keys(markets).sort().join(', '));

    // いくつかの特定の市場について詳細を表示
    const checkSymbols = ['BTC/JPY', 'BNB/JPY', 'DOT/JPY', 'ETH/JPY', 'XRP/JPY'];
    console.log('\n特定の市場の詳細情報:');

    for (const symbol of checkSymbols) {
      if (symbol in markets) {
        console.log(`\n${symbol}:`);
        console.log(`  ID: ${markets[symbol].id}`);
        console.log(`  ベース通貨: ${markets[symbol].base}`);
        console.log(`  相手通貨: ${markets[symbol].quote}`);
        console.log(`  アクティブ: ${markets[symbol].active}`);
      } else {
        console.log(`\n${symbol}: サポートされていません`);
      }
    }

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
  }
}

// スクリプト実行
listBitbankMarkets();