/**
 * filled_trade データ復元スクリプト
 * バックアップからのデータ復元
 */
require('dotenv').config();
const redis = require('redis');
const fs = require('fs').promises;

async function restoreFilledTrade(backupFileName) {
  try {
    console.log(`🔄 filled_trade データ復元開始: ${backupFileName}`);

    // バックアップファイル読み込み
    const backupPath = `/Users/azumag/work/harvest3/${backupFileName}`;
    const backupContent = await fs.readFile(backupPath, 'utf8');
    const backup = JSON.parse(backupContent);

    console.log('📦 復元データ情報:');
    console.log(`  作成日時: ${backup.timestamp}`);
    console.log(`  キー数: ${backup.keyCount}`);
    console.log(`  ファイルサイズ: ${(backup.totalSize / 1024).toFixed(2)} KB`);

    // Redis接続
    const client = redis.createClient({ url: 'redis://localhost:6379' });
    await client.connect();
    console.log('✅ Redis接続完了');

    // データ復元
    let restoredCount = 0;
    let errorCount = 0;

    for (const [key, data] of Object.entries(backup.data)) {
      try {
        // 既存データが存在する場合は警告
        const exists = await client.exists(key);
        if (exists) {
          console.log(`⚠️ 既存データを上書き: ${key}`);
        }

        // データ復元
        await client.hSet(key, data);
        restoredCount++;

        if (restoredCount % 10 === 0) {
          console.log(`  進行状況: ${restoredCount}/${backup.keyCount}`);
        }
      } catch (err) {
        console.error(`❌ ${key} 復元エラー:`, err.message);
        errorCount++;
      }
    }

    // 復元結果確認
    const currentKeys = await client.keys('filled_trade:*');

    console.log('✅ 復元完了:');
    console.log(`  成功: ${restoredCount}キー`);
    console.log(`  エラー: ${errorCount}キー`);
    console.log(`  現在のfilled_tradeキー数: ${currentKeys.length}`);

    await client.quit();
    return { restoredCount, errorCount };

  } catch (error) {
    console.error('❌ 復元エラー:', error.message);
    throw error;
  }
}

// 使用方法の表示
function showUsage() {
  console.log(`
使用方法:
  node scripts/filled_trade_restore.js <バックアップファイル名>

例:
  node scripts/filled_trade_restore.js filled_trade_backup_2024-06-26T12-34-56-789Z.json
`);
}

// 直接実行時
if (require.main === module) {
  const backupFileName = process.argv[2];

  if (!backupFileName) {
    console.error('❌ バックアップファイル名を指定してください');
    showUsage();
    process.exit(1);
  }

  restoreFilledTrade(backupFileName)
    .then(({ restoredCount, errorCount }) => {
      console.log(`🎉 復元完了: ${restoredCount}成功, ${errorCount}エラー`);
      process.exit(errorCount > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('💥 復元失敗:', error);
      process.exit(1);
    });
}

module.exports = { restoreFilledTrade };