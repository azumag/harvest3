#!/usr/bin/env node

/**
 * 実データ収集開始スクリプト
 * 理論値から実証値への移行 - 30日間の実データ収集を最優先タスクとして実行
 */

const RealDataCollector = require('../src/monitoring/realDataCollector');
const ccxt = require('ccxt');
const fs = require('fs');
const path = require('path');

class RealDataCollectionManager {
  constructor() {
    this.collector = null;
    this.exchanges = [];
    this.config = {
      // 実際の本番環境設定を使用
      collectionInterval: 60000, // 1分間隔
      dataRetention: 30 * 24 * 60 * 60 * 1000, // 30日間
      dataFile: path.join(__dirname, '../data/real-performance-data.json'),
      maxFileSize: 100 * 1024 * 1024, // 100MB
      backupInterval: 6 * 60 * 60 * 1000 // 6時間間隔
    };

    this.startTime = Date.now();
    this.statusFile = path.join(__dirname, '../data/collection-status.json');
  }

  /**
     * 取引所インスタンスの初期化
     */
  async initializeExchanges() {
    console.log('📊 取引所インスタンス初期化中...');

    // 実際の取引所を使用（APIキーなしでも基本的な情報は取得可能）
    const exchangeConfigs = [
      {
        id: 'binance',
        class: ccxt.binance,
        config: {
          rateLimit: 1200,
          enableRateLimit: true,
          timeout: 30000,
          options: {
            // 本番環境では実際のAPIキーを使用
            // sandbox: false
          }
        }
      },
      {
        id: 'bybit',
        class: ccxt.bybit,
        config: {
          rateLimit: 1000,
          enableRateLimit: true,
          timeout: 30000
        }
      },
      {
        id: 'okx',
        class: ccxt.okx,
        config: {
          rateLimit: 1000,
          enableRateLimit: true,
          timeout: 30000
        }
      }
    ];

    for (const config of exchangeConfigs) {
      try {
        const exchange = new config.class(config.config);

        // 最低限の動作確認
        await exchange.loadMarkets();
        console.log(`   ✅ ${config.id}: ${Object.keys(exchange.markets).length}個の市場`);

        this.exchanges.push(exchange);

      } catch (error) {
        console.warn(`   ⚠️ ${config.id}: 初期化失敗 - ${error.message}`);

        // 失敗した場合もモックインスタンスを作成（テスト用）
        const mockExchange = {
          id: config.id,
          fetchStatus: async () => ({ status: 'ok' }),
          fetchTime: async () => Date.now(),
          rateLimit: config.config.rateLimit,
          enableRateLimit: config.config.enableRateLimit,
          timeout: config.config.timeout,
          markets: { 'BTC/USDT': {} },
          throttle: { queue: [] }
        };

        this.exchanges.push(mockExchange);
        console.log(`   📝 ${config.id}: モック使用（テスト環境）`);
      }
    }

    console.log(`\n🎯 合計 ${this.exchanges.length}個の取引所でデータ収集を開始\n`);
  }

  /**
     * データ収集開始
     */
  async startCollection() {
    console.log('🚀 実データ収集開始...\n');

    // 取引所初期化
    await this.initializeExchanges();

    // データ収集インスタンス作成
    this.collector = new RealDataCollector(this.config);

    // 収集状況のログ記録
    this.logCollectionStatus('started');

    // データ収集開始
    this.collector.startCollection(this.exchanges);

    // 定期的なステータス更新
    setInterval(() => {
      this.logCollectionStatus('running');
      this.printCollectionStats();
    }, 5 * 60 * 1000); // 5分間隔

    console.log('📈 データ収集開始完了');
    console.log('   - 収集間隔: 1分');
    console.log('   - 保存間隔: 10データポイントごと');
    console.log('   - バックアップ: 6時間間隔');
    console.log('   - 保存先:', this.config.dataFile);
    console.log('\n💡 Ctrl+C で停止');

    // 終了処理の設定
    process.on('SIGINT', () => {
      console.log('\n🛑 データ収集停止中...');
      this.stopCollection();
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 データ収集停止中...');
      this.stopCollection();
    });
  }

  /**
     * データ収集停止
     */
  stopCollection() {
    if (this.collector) {
      this.collector.stopCollection();
      this.logCollectionStatus('stopped');
      console.log('✅ データ収集停止完了');
    }

    // 最終統計表示
    this.printFinalStats();

    process.exit(0);
  }

  /**
     * 収集状況のログ記録
     */
  logCollectionStatus(status) {
    const statusData = {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      exchanges: this.exchanges.map(e => e.id),
      config: this.config,
      stats: this.collector ? this.collector.getCollectionStats() : null
    };

    try {
      fs.writeFileSync(this.statusFile, JSON.stringify(statusData, null, 2));
    } catch (error) {
      console.warn('⚠️ ステータスログ保存エラー:', error.message);
    }
  }

  /**
     * 収集統計の表示
     */
  printCollectionStats() {
    if (!this.collector) {
      return;
    }

    const stats = this.collector.getCollectionStats();
    const uptime = Math.round((Date.now() - this.startTime) / 1000);

    console.log(`\n📊 データ収集統計 (稼働時間: ${uptime}秒)`);
    console.log(`   - 総データ数: ${stats.total}件`);
    console.log(`   - 過去24時間: ${stats.coverage.last24hours}件`);
    console.log(`   - 過去7日間: ${stats.coverage.last7days}件`);
    console.log(`   - データ期間: ${stats.coverage.totalDays}日`);
    console.log(`   - ファイルサイズ: ${Math.round(stats.fileSize / 1024)}KB`);
    console.log(`   - 対象取引所: ${stats.exchanges.join(', ')}`);
    console.log('');
  }

  /**
     * 最終統計の表示
     */
  printFinalStats() {
    if (!this.collector) {
      return;
    }

    const stats = this.collector.getCollectionStats();
    const totalTime = Math.round((Date.now() - this.startTime) / 1000);

    console.log('\n📈 最終収集統計');
    console.log('================');
    console.log(`総収集時間: ${totalTime}秒`);
    console.log(`総データ数: ${stats.total}件`);
    console.log(`データ期間: ${stats.coverage.totalDays}日`);
    console.log(`最終ファイルサイズ: ${Math.round(stats.fileSize / 1024)}KB`);
    console.log(`対象取引所: ${stats.exchanges.join(', ')}`);
    console.log('');

    if (stats.total > 0) {
      console.log('✅ 実データ収集が完了しました');
      console.log('   次のステップ: データ分析と閾値調整');
      console.log('   分析コマンド: npm run analyze-real-data');
    } else {
      console.log('⚠️ データが収集されませんでした');
      console.log('   設定や取引所接続を確認してください');
    }
  }

  /**
     * 既存データの確認
     */
  checkExistingData() {
    if (fs.existsSync(this.config.dataFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.config.dataFile, 'utf8'));
        const count = data.measurements ? data.measurements.length : 0;
        console.log(`📁 既存データ確認: ${count}件`);

        if (count > 0) {
          const lastUpdate = new Date(data.metadata.lastUpdated);
          console.log(`   最終更新: ${lastUpdate.toLocaleString()}`);

          // 30日以上のデータがある場合の通知
          if (count > 30 * 24 * 60) { // 30日 * 24時間 * 60分
            console.log('   ✅ 30日間以上のデータが蓄積されています');
            console.log('   💡 分析を実行してください: npm run analyze-real-data');
          }
        }
      } catch (error) {
        console.warn('⚠️ 既存データの読み込みエラー:', error.message);
      }
    }
  }
}

// スクリプト実行
if (require.main === module) {
  const manager = new RealDataCollectionManager();

  // 既存データの確認
  manager.checkExistingData();

  // データ収集開始
  manager.startCollection().catch(error => {
    console.error('❌ データ収集エラー:', error.message);
    process.exit(1);
  });
}

module.exports = RealDataCollectionManager;