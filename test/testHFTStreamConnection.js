#!/usr/bin/env node

const PublicStreamClient = require('../src/hft/bitbank/PublicStreamClient');
const MarketDataStore = require('../src/hft/datastore/MarketDataStore');
const Logger = require('../src/hft/utils/Logger');
const config = require('../src/hft/config');

// テスト設定
const TEST_DURATION = 30000; // 30秒間テスト
const TEST_PAIRS = ['btc_jpy', 'eth_jpy']; // テスト対象の通貨ペア

class StreamConnectionTester {
  constructor() {
    this.logger = new Logger('StreamTester');
    this.dataStore = new MarketDataStore();
    this.messageCount = {
      ticker: 0,
      transactions: 0,
      orderBook: 0,
      errors: 0,
      reconnects: 0
    };
    this.lastData = {};
  }

  async runTest(mockMode = false) {
    this.logger.info('🧪 Starting HFT Stream Connection Test');
    this.logger.info(`📋 Test Configuration:`);
    this.logger.info(`   - Duration: ${TEST_DURATION / 1000} seconds`);
    this.logger.info(`   - Pairs: ${TEST_PAIRS.join(', ')}`);
    this.logger.info(`   - Mode: ${mockMode ? 'MOCK' : 'REAL'}`);
    
    // コンフィグ設定
    const testConfig = {
      ...config,
      mockMode: mockMode
    };
    
    // PublicStreamClientを作成
    this.client = new PublicStreamClient(
      mockMode ? 'mock://localhost' : 'wss://stream.bitbank.cc',
      testConfig,
      this.dataStore
    );
    
    // イベントリスナーを設定
    this._setupEventListeners();
    
    try {
      // 接続
      await this.client.connect();
      this.logger.success('✅ WebSocket connection established');
      
      // 通貨ペアを購読
      for (const pair of TEST_PAIRS) {
        this.client.subscribePair(pair);
        this.logger.info(`📡 Subscribed to ${pair}`);
      }
      
      // 定期的な統計表示
      this.statsInterval = setInterval(() => this._displayStats(), 5000);
      
      // テスト期間が終了したら終了
      setTimeout(() => {
        this._finishTest();
      }, TEST_DURATION);
      
    } catch (error) {
      this.logger.error('❌ Failed to connect:', error.message);
      process.exit(1);
    }
  }

  _setupEventListeners() {
    // ティッカー更新
    this.dataStore.on('tickerUpdate', (pair, data) => {
      this.messageCount.ticker++;
      this.lastData[`ticker_${pair}`] = {
        data: data,
        timestamp: new Date()
      };
      this.logger.debug(`💱 Ticker update for ${pair}:`, {
        sell: data.sell,
        buy: data.buy,
        last: data.last
      });
    });
    
    // 約定履歴更新
    this.dataStore.on('transactionsUpdate', (pair, transactions) => {
      this.messageCount.transactions++;
      this.lastData[`transactions_${pair}`] = {
        count: transactions.length,
        timestamp: new Date()
      };
      this.logger.debug(`💰 ${transactions.length} new transactions for ${pair}`);
    });
    
    // 注文板更新
    this.dataStore.on('orderBookUpdate', (pair, orderBook) => {
      this.messageCount.orderBook++;
      this.lastData[`orderbook_${pair}`] = {
        bidCount: orderBook.bids.length,
        askCount: orderBook.asks.length,
        timestamp: new Date()
      };
      this.logger.debug(`📊 Order book update for ${pair}:`, {
        bids: orderBook.bids.length,
        asks: orderBook.asks.length
      });
    });
    
    // 再接続イベント
    this.client.client.on('reconnected', (attempts) => {
      this.messageCount.reconnects++;
      this.logger.warn(`🔄 Reconnected after ${attempts} attempts`);
    });
    
    // エラーイベント
    this.client.client.on('error', (error) => {
      this.messageCount.errors++;
      this.logger.error(`❌ WebSocket error:`, error.message);
    });
  }

  _displayStats() {
    const stats = this.dataStore.getStats();
    this.logger.info('📊 Current Statistics:');
    this.logger.info(`   - Messages received:`);
    this.logger.info(`     • Ticker: ${this.messageCount.ticker}`);
    this.logger.info(`     • Transactions: ${this.messageCount.transactions}`);
    this.logger.info(`     • Order Book: ${this.messageCount.orderBook}`);
    this.logger.info(`   - Errors: ${this.messageCount.errors}`);
    this.logger.info(`   - Reconnections: ${this.messageCount.reconnects}`);
    this.logger.info(`   - Active pairs: ${stats.pairs}`);
    
    // 各ペアの最新データ状況
    for (const pair of TEST_PAIRS) {
      const pairStats = stats.dataByPair[pair];
      if (pairStats) {
        this.logger.info(`   - ${pair.toUpperCase()}:`);
        this.logger.info(`     • Has ticker: ${pairStats.hasTicker ? '✅' : '❌'}`);
        this.logger.info(`     • Has order book: ${pairStats.hasOrderBook ? '✅' : '❌'}`);
        this.logger.info(`     • Transaction count: ${pairStats.transactionCount}`);
      }
    }
  }

  _finishTest() {
    clearInterval(this.statsInterval);
    
    this.logger.info('🏁 Test completed!');
    this.logger.info('📈 Final Results:');
    this._displayStats();
    
    // データ受信の成功率を計算
    const totalExpectedMessages = TEST_PAIRS.length * 3; // ticker, transactions, orderbook
    const totalReceivedMessages = this.messageCount.ticker + this.messageCount.transactions + this.messageCount.orderBook;
    
    this.logger.info('📊 Summary:');
    this.logger.info(`   - Total messages received: ${totalReceivedMessages}`);
    this.logger.info(`   - Average messages per second: ${(totalReceivedMessages / (TEST_DURATION / 1000)).toFixed(2)}`);
    
    // 最後に受信したデータのタイムスタンプを表示
    this.logger.info('⏰ Last data received:');
    for (const [key, value] of Object.entries(this.lastData)) {
      const age = new Date() - value.timestamp;
      this.logger.info(`   - ${key}: ${age}ms ago`);
    }
    
    // テスト結果の判定
    if (this.messageCount.errors > 0) {
      this.logger.warn(`⚠️ Test completed with ${this.messageCount.errors} errors`);
    } else if (totalReceivedMessages === 0) {
      this.logger.error('❌ Test failed: No messages received');
    } else {
      this.logger.success('✅ Test passed successfully!');
    }
    
    // 切断してプロセスを終了
    this.client.disconnect();
    process.exit(this.messageCount.errors > 0 || totalReceivedMessages === 0 ? 1 : 0);
  }
}

// コマンドライン引数の処理
const args = process.argv.slice(2);
const mockMode = args.includes('--mock') || args.includes('-m');

// テスト実行
const tester = new StreamConnectionTester();
tester.runTest(mockMode).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// ヘルプメッセージ
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
HFT Stream Connection Tester

Usage:
  node testHFTStreamConnection.js [options]

Options:
  --mock, -m    Run in mock mode (simulate WebSocket data)
  --help, -h    Show this help message

Examples:
  # Test with real WebSocket connection
  node testHFTStreamConnection.js
  
  # Test with mock data
  node testHFTStreamConnection.js --mock
`);
  process.exit(0);
}