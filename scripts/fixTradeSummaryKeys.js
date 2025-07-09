const { createClient } = require('redis');

async function fixTradeSummaryKeys() {
  const client = await createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
  });

  await client.connect();
  console.log('Redisに接続しました');

  try {
    // 既存のサマリーキーを取得
    const keys = await client.keys('summary:trade:*');
    console.log(`見つかったサマリーキー数: ${keys.length}`);

    for (const key of keys) {
      const keyParts = key.split(':');

      // 現在の誤った構造: summary:trade:{exchangeId}:{symbol}:{strategyKey}
      // exchangeId = "trade", symbol = "bitbank", strategyKey = "ATOM/JPY"など

      if (keyParts.length >= 5) {
        const wrongExchangeId = keyParts[2]; // "trade"
        const realExchangeId = keyParts[3];  // "bitbank"
        const realSymbol = keyParts[4];      // "ATOM/JPY"など

        // 戦略名を抽出（簡易的に通貨ペアから戦略名を生成）
        // 本来はどの戦略が使用されたかの情報が必要だが、一時的に "unknown" とする
        const strategyKey = 'unknown';

        // 正しいキー形式を作成
        const newKey = `summary:trade:${realExchangeId}:${realSymbol}:${strategyKey}`;

        // データを取得
        const data = await client.hGetAll(key);

        if (Object.keys(data).length > 0) {
          console.log(`移行: ${key} -> ${newKey}`);

          // 新しいキーにデータをコピー
          await client.hSet(newKey, data);

          // 古いキーを削除
          await client.del(key);
        }
      }
    }

    console.log('サマリーキーの修正が完了しました');
  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await client.quit();
  }
}

// 環境変数の読み込み
require('dotenv').config();

// スクリプトを実行
fixTradeSummaryKeys()
  .then(() => console.log('完了'))
  .catch(console.error);