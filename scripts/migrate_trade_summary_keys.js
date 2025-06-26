const redis = require('redis');
const { initRedisClient } = require('../src/database/redisClient');

async function migrateTradeSummaryKeys() {
  console.log('🚀 Redisキー移行スクリプトを開始します...');

  let client;
  try {
    await initRedisClient();
    client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();
    console.log('✅ Redisクライアントに接続しました。');

    const oldKeys = await client.keys('trade_summary:*');
    console.log(`🔍 移行対象の古いキー (trade_summary:*) が ${oldKeys.length} 件見つかりました。`);

    if (oldKeys.length === 0) {
      console.log('移行するキーがありません。スクリプトを終了します。');
      await client.quit();
      return;
    }

    let migratedCount = 0;
    for (const oldKey of oldKeys) {
      try {
        const hashData = await client.hGetAll(oldKey);
        
        // 新しいキー名を生成 (trade_summary:exchange:symbol:strategy -> summary:trade:exchange:symbol:strategy)
        const parts = oldKey.split(':');
        if (parts.length === 4 && parts[0] === 'trade_summary') {
          const newKey = `summary:trade:${parts[1]}:${parts[2]}:${parts[3]}`;
          
          // 新しいキーにデータを書き込み
          await client.hSet(newKey, hashData);
          
          // 古いキーを削除
          await client.del(oldKey);
          migratedCount++;
          console.log(`  移行済み: ${oldKey} -> ${newKey}`);
        } else {
          console.warn(`  スキップ: 不正な形式のキー ${oldKey}`);
        }
      } catch (error) {
        console.error(`  キー ${oldKey} の移行中にエラーが発生しました: ${error.message}`);
      }
    }

    console.log(`🎉 Redisキー移行が完了しました。${migratedCount} 件のキーが移行されました。`);

  } catch (error) {
    console.error('❌ Redisキー移行中に致命的なエラーが発生しました:', error.message);
  } finally {
    if (client && client.isOpen) {
      await client.quit();
      console.log('Redisクライアントを切断しました。');
    }
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  migrateTradeSummaryKeys().catch(console.error);
}
