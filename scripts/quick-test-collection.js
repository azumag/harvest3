#!/usr/bin/env node

/**
 * 迅速なデータ収集テスト
 * 数分以内でデータ収集の動作確認を行う
 */

const RealDataCollector = require('../src/monitoring/realDataCollector');
const ccxt = require('ccxt');

async function quickTest() {
  console.log('🚀 迅速なデータ収集テスト開始\n');

  try {
    // 1つの取引所でテスト
    console.log('📊 テスト用取引所初期化...');
    const exchange = new ccxt.binance({
      rateLimit: 1200,
      enableRateLimit: true,
      timeout: 10000
    });

    // 市場データ読み込み
    await exchange.loadMarkets();
    console.log(`   ✅ Binance: ${Object.keys(exchange.markets).length}個の市場`);

    // データ収集インスタンス作成
    const collector = new RealDataCollector({
      collectionInterval: 10000, // 10秒間隔
      dataRetention: 24 * 60 * 60 * 1000, // 24時間
      dataFile: '/Users/azumag/work/harvest3/data/test-performance-data.json'
    });

    console.log('📈 データ収集開始...');

    // 取引所を設定
    collector.exchanges = [exchange];

    // 手動で複数回データ収集（分析に必要な最低限のデータ）
    const targetCount = 65; // 分析に必要な最低限+αのデータ
    console.log(`   ${targetCount}件のデータポイントを収集中...`);

    for (let i = 0; i < targetCount; i++) {
      if (i % 10 === 0) {
        console.log(`   進捗: ${i}/${targetCount} (${Math.round(i/targetCount*100)}%)`);
      }
      await collector.collectDataPoint();

      // 短い待機（100ms）
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // データ保存
    collector.saveData();

    // 結果確認
    const stats = collector.getCollectionStats();
    console.log('\n📊 テスト結果:');
    console.log(`   収集データ数: ${stats.total}件`);
    console.log(`   ファイル存在: ${stats.fileExists}`);
    console.log(`   ファイルサイズ: ${Math.round(stats.fileSize / 1024)}KB`);

    if (stats.total > 0) {
      console.log('\n✅ データ収集テスト成功');
      console.log('   実際のデータファイルを確認してください');

      // 少し分析してみる
      const testAnalyzer = require('./analyze-real-data');
      const analyzer = new testAnalyzer();
      analyzer.dataFile = '/Users/azumag/work/harvest3/data/test-performance-data.json';

      if (analyzer.loadData()) {
        console.log('\n🔍 簡易分析実行...');
        const basicStats = analyzer.calculateBasicStats();
        console.log(`   分析期間: ${basicStats.timespan.durationDays.toFixed(3)}日`);
        console.log(`   取引所数: ${Object.keys(basicStats.exchanges).length}個`);

        Object.entries(basicStats.exchanges).forEach(([exchangeId, stats]) => {
          console.log(`   ${exchangeId}: 成功率 ${(stats.successRate * 100).toFixed(1)}%`);
        });
      }
    } else {
      console.log('\n❌ データ収集テスト失敗');
    }

  } catch (error) {
    console.error('❌ テストエラー:', error.message);
    console.error('スタックトレース:', error.stack);
  }
}

// 直接実行
quickTest();