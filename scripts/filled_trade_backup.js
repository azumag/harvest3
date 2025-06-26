/**
 * filled_trade データバックアップスクリプト
 * 削除前の安全なデータ保存
 */
require('dotenv').config();
const redis = require('redis');
const fs = require('fs').promises;

async function backupFilledTrade() {
  try {
    console.log('🔄 filled_trade データバックアップ開始...');
    
    // Redis接続
    const client = redis.createClient({ url: 'redis://localhost:6379' });
    await client.connect();
    console.log('✅ Redis接続完了');
    
    // filled_tradeキー取得
    const filledTradeKeys = await client.keys('filled_trade:*');
    console.log(`📦 バックアップ対象: ${filledTradeKeys.length}キー`);
    
    if (filledTradeKeys.length === 0) {
      console.log('⚠️ バックアップ対象データが見つかりません');
      await client.quit();
      return;
    }
    
    // データ取得
    const backupData = {};
    let processedCount = 0;
    
    for (const key of filledTradeKeys) {
      try {
        const data = await client.hGetAll(key);
        backupData[key] = data;
        processedCount++;
        
        if (processedCount % 10 === 0) {
          console.log(`  進行状況: ${processedCount}/${filledTradeKeys.length}`);
        }
      } catch (err) {
        console.error(`⚠️ ${key} バックアップエラー:`, err.message);
      }
    }
    
    // バックアップファイル作成
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `filled_trade_backup_${timestamp}.json`;
    const backupPath = `/Users/azumag/work/harvest3/${backupFileName}`;
    
    const backupContent = {
      timestamp: new Date().toISOString(),
      keyCount: Object.keys(backupData).length,
      totalSize: JSON.stringify(backupData).length,
      data: backupData
    };
    
    await fs.writeFile(backupPath, JSON.stringify(backupContent, null, 2));
    
    console.log(`✅ バックアップ完了: ${backupFileName}`);
    console.log(`📊 バックアップ統計:`);
    console.log(`  キー数: ${backupContent.keyCount}`);
    console.log(`  ファイルサイズ: ${(backupContent.totalSize / 1024).toFixed(2)} KB`);
    console.log(`  保存先: ${backupPath}`);
    
    await client.quit();
    return backupFileName;
    
  } catch (error) {
    console.error('❌ バックアップエラー:', error.message);
    throw error;
  }
}

// 直接実行時
if (require.main === module) {
  backupFilledTrade()
    .then((fileName) => {
      console.log(`🎉 バックアップ成功: ${fileName}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 バックアップ失敗:', error);
      process.exit(1);
    });
}

module.exports = { backupFilledTrade };