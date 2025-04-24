const { updateTradeSummaryTimestamp, initialize } = require('../src/database/redisDatabase');
const { exchangeBB } = require('../src/config');

async function main() {
  // Redis初期化
  await initialize();

  try {
    console.log('bitbankの全銘柄のタイムスタンプを更新します...');

    // bitbankの市場データをロード
    const markets = await exchangeBB.loadMarkets();
    const symbols = Object.keys(markets).filter(symbol => symbol.endsWith('/JPY'));

    console.log(`対象銘柄数: ${symbols.length}`);

    // 各銘柄に対してタイムスタンプを更新
    for (const symbol of symbols) {
      console.log(`Updating timestamp for ${symbol}...`);
      await updateTradeSummaryTimestamp('bitbank', symbol); // exchangeId は 'bitbank'
    }

    console.log('全銘柄のタイムスタンプ更新が完了しました。');

  } catch (error) {
    console.error('タイムスタンプ更新中にエラーが発生しました:', error);
  } finally {
    // 必要に応じてRedisクライアントを閉じる処理を追加
    // redisDatabase.js に close 関数があればそれを使う
    // なければ、スクリプト終了時に自動的に閉じることを期待する
  }
}

main();