#!/usr/bin/env node

/**
 * データ収集テストスクリプト
 * 短時間のテスト収集を実行し、システムの動作を確認
 */

const RealDataCollectionManager = require('./start-real-data-collection');

async function runTestCollection() {
    console.log('🧪 データ収集テスト開始\n');
    
    const manager = new RealDataCollectionManager();
    
    // 既存データの確認
    manager.checkExistingData();
    
    try {
        // 取引所初期化
        await manager.initializeExchanges();
        
        // 短時間のテスト収集
        console.log('⏰ 5分間のテスト収集を開始...');
        
        manager.collector = new (require('../src/monitoring/realDataCollector'))({
            collectionInterval: 30000, // 30秒間隔（テスト用）
            dataRetention: 30 * 24 * 60 * 60 * 1000,
            dataFile: manager.config.dataFile
        });
        
        // データ収集開始
        manager.collector.startCollection(manager.exchanges);
        
        // 5分後に停止
        setTimeout(() => {
            console.log('\n⏰ テスト収集終了');
            manager.collector.stopCollection();
            
            // 結果表示
            const stats = manager.collector.getCollectionStats();
            console.log('\n📊 テスト収集結果:');
            console.log(`   収集データ数: ${stats.total}件`);
            console.log(`   ファイル存在: ${stats.fileExists}`);
            console.log(`   ファイルサイズ: ${Math.round(stats.fileSize / 1024)}KB`);
            console.log(`   対象取引所: ${stats.exchanges.join(', ')}`);
            
            if (stats.total > 0) {
                console.log('\n✅ データ収集テスト成功');
                console.log('   次のステップ: 本格的なデータ収集の開始');
            } else {
                console.log('\n❌ データ収集テスト失敗');
                console.log('   設定や取引所接続を確認してください');
            }
            
            process.exit(0);
        }, 5 * 60 * 1000); // 5分
        
        // 進捗表示
        let progressCount = 0;
        const progressInterval = setInterval(() => {
            progressCount++;
            const stats = manager.collector.getCollectionStats();
            console.log(`   進捗 ${progressCount}分: ${stats.total}件収集済み`);
            
            if (progressCount >= 5) {
                clearInterval(progressInterval);
            }
        }, 60 * 1000); // 1分間隔
        
    } catch (error) {
        console.error('❌ テスト収集エラー:', error.message);
        process.exit(1);
    }
}

// スクリプト実行
if (require.main === module) {
    runTestCollection();
}

module.exports = runTestCollection;