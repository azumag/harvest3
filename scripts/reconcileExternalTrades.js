/**
 * 外部取引監査スクリプト - Gemini提案のPhase 2優先度2実装
 * 取引所の約定履歴とBot管理のオーダーを照合し、外部取引を検出・統合
 */

const { config } = require('../src/config');
const { connectDB, listOrders, addTradeMongoDB } = require('../src/database/mongoDatabase');
const { initRedisClient } = require('../src/database/redisClient');
const { updateTradeSummary } = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

class ExternalTradesReconciler {
  constructor() {
    this.externalTrades = [];
    this.reconciledTrades = [];
    this.errors = [];
    this.lookbackHours = 24; // デフォルト24時間
  }

  /**
   * 外部取引の監査・統合を実行
   */
  async executeReconciliation() {
    console.log('🔍 【Phase 2-2】外部取引監査・統合を開始します...\n');

    try {
      console.log('Step 1: MongoDB接続とBot管理オーダー取得...');
      await this.initializeDatabases();

      console.log('\nStep 2: 取引所約定履歴の取得...');
      await this.fetchExchangeTrades();

      console.log('\nStep 3: 外部取引の検出...');
      await this.detectExternalTrades();

      console.log('\nStep 4: 外部取引の統合処理...');
      await this.integrateExternalTrades();

      console.log('\nStep 5: 結果レポート生成...');
      await this.generateReconciliationReport();

    } catch (error) {
      const errorMsg = `外部取引監査エラー: ${error.message}`;
      console.error(errorMsg);
      this.errors.push(errorMsg);
      await postErrorToDiscord(`🚨 **外部取引監査エラー**\n${errorMsg}`);
    }
  }

  /**
   * データベース接続の初期化
   */
  async initializeDatabases() {
    await connectDB();
    await initRedisClient();

    // Bot管理オーダーをMongoDBから取得
    this.botOrders = await listOrders({}, { orderId: 1 }, 5000);
    this.botOrderIds = new Set(this.botOrders.map(order => order.orderId));

    console.log(`Bot管理オーダー数: ${this.botOrderIds.size}件`);
  }

  /**
   * 取引所から約定履歴を取得
   */
  async fetchExchangeTrades() {
    const exchanges = Object.keys(config.exchanges);

    for (const exchangeId of exchanges) {
      try {
        const exchange = config.exchanges[exchangeId]?.instance;
        if (!exchange) {
          continue;
        }

        console.log(`📊 ${exchangeId} の約定履歴を取得中...`);

        // 主要通貨ペアの約定履歴を取得
        const symbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'BCH/JPY',
          'SOL/JPY', 'DOT/JPY', 'XLM/JPY', 'LINK/JPY', 'GALA/JPY',
          'APE/JPY', 'MANA/JPY', 'SAND/JPY', 'CHZ/JPY', 'OAS/JPY'];

        for (const symbol of symbols) {
          try {
            // 過去24時間の約定履歴を取得
            const since = Date.now() - (this.lookbackHours * 60 * 60 * 1000);
            const trades = await exchange.fetchMyTrades(symbol, since, 100);

            if (trades.length > 0) {
              console.log(`  ${symbol}: ${trades.length}件の約定を取得`);

              // 各約定について外部取引チェック
              for (const trade of trades) {
                if (!this.botOrderIds.has(trade.order)) {
                  this.externalTrades.push({
                    exchangeId,
                    symbol,
                    trade,
                    reason: 'order_not_in_bot_records'
                  });
                }
              }
            }

            // API制限回避
            await new Promise(resolve => setTimeout(resolve, 200));

          } catch (symbolError) {
            console.warn(`  ${symbol} 約定履歴取得エラー: ${symbolError.message}`);
          }
        }

        // 取引所間での待機
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        const errorMsg = `${exchangeId} 約定履歴取得エラー: ${error.message}`;
        console.error(errorMsg);
        this.errors.push(errorMsg);
      }
    }

    console.log(`\n外部取引検出: ${this.externalTrades.length}件`);
  }

  /**
   * 外部取引の詳細検出・分類
   */
  async detectExternalTrades() {
    for (const externalTrade of this.externalTrades) {
      const { trade, exchangeId, symbol } = externalTrade;

      try {
        // 取引の詳細分析
        const tradeAge = (Date.now() - trade.timestamp) / (1000 * 60 * 60);
        const tradeValue = trade.amount * trade.price;

        // 分類ロジック
        if (tradeValue > 50000) {
          externalTrade.classification = 'large_external_trade';
          externalTrade.priority = 'high';
        } else if (tradeAge < 1) {
          externalTrade.classification = 'recent_external_trade';
          externalTrade.priority = 'medium';
        } else {
          externalTrade.classification = 'historical_external_trade';
          externalTrade.priority = 'low';
        }

        // 取引戦略の推定
        if (trade.side === 'buy' && trade.amount < 1) {
          externalTrade.estimatedStrategy = 'MANUAL_BUY';
        } else if (trade.side === 'sell' && tradeAge < 6) {
          externalTrade.estimatedStrategy = 'MANUAL_SELL';
        } else {
          externalTrade.estimatedStrategy = 'OUTSIDE';
        }

        console.log(`📋 外部取引検出: ${symbol} ${trade.side} ${trade.amount} (${externalTrade.classification})`);
        console.log(`   オーダーID: ${trade.order}, 価値: ¥${tradeValue.toFixed(0)}, 経過: ${tradeAge.toFixed(1)}h`);

      } catch (error) {
        console.warn(`外部取引分析エラー: ${trade.order} - ${error.message}`);
      }
    }
  }

  /**
   * 外部取引をシステムに統合
   */
  async integrateExternalTrades() {
    for (const externalTrade of this.externalTrades) {
      try {
        const { trade, exchangeId, symbol, estimatedStrategy } = externalTrade;

        // MongoDB tradesコレクションに追加
        const tradeRecord = {
          tradeId: `external_${trade.id}_${Date.now()}`,
          orderId: trade.order,
          exchange: exchangeId,
          symbol: symbol,
          side: trade.side,
          amount: trade.amount,
          price: trade.price,
          timestamp: trade.timestamp,
          strategy: estimatedStrategy,
          fee: trade.fee?.cost || 0,
          feeCurrency: trade.fee?.currency || 'JPY',
          isExternal: true,
          detectedAt: Date.now()
        };

        await addTradeMongoDB(tradeRecord);

        // trade_summary更新
        await updateTradeSummary(tradeRecord);

        this.reconciledTrades.push({
          ...externalTrade,
          tradeRecord,
          action: 'integrated_as_external'
        });

        console.log(`✅ 統合完了: ${symbol} ${estimatedStrategy} (¥${(trade.amount * trade.price).toFixed(0)})`);

      } catch (error) {
        const errorMsg = `外部取引統合エラー: ${externalTrade.trade.order} - ${error.message}`;
        console.error(errorMsg);
        this.errors.push(errorMsg);
      }
    }
  }

  /**
   * 監査結果レポート生成
   */
  async generateReconciliationReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 【Phase 2-2】外部取引監査・統合 - 結果レポート');
    console.log('='.repeat(80));

    console.log(`🔍 外部取引検出: ${this.externalTrades.length}件`);
    console.log(`✅ 統合完了: ${this.reconciledTrades.length}件`);
    console.log(`❌ エラー発生: ${this.errors.length}件\n`);

    // 分類別統計
    const classifications = {};
    const strategies = {};
    let totalValue = 0;

    for (const reconciled of this.reconciledTrades) {
      const { classification, estimatedStrategy, trade } = reconciled;

      classifications[classification] = (classifications[classification] || 0) + 1;
      strategies[estimatedStrategy] = (strategies[estimatedStrategy] || 0) + 1;
      totalValue += trade.amount * trade.price;
    }

    if (Object.keys(classifications).length > 0) {
      console.log('📊 分類別統計:');
      console.log('-'.repeat(40));
      for (const [classification, count] of Object.entries(classifications)) {
        console.log(`  ${classification}: ${count}件`);
      }
      console.log();
    }

    if (Object.keys(strategies).length > 0) {
      console.log('🎯 推定戦略別統計:');
      console.log('-'.repeat(40));
      for (const [strategy, count] of Object.entries(strategies)) {
        console.log(`  ${strategy}: ${count}件`);
      }
      console.log();
    }

    console.log(`💰 統合した外部取引の総価値: ¥${totalValue.toFixed(0)}\n`);

    if (this.errors.length > 0) {
      console.log('❌ 発生したエラー:');
      console.log('-'.repeat(40));
      for (const error of this.errors) {
        console.log(`  ${error}`);
      }
      console.log();
    }

    // Discord通知
    await this.sendReconciliationNotification();

    console.log('='.repeat(80));
    console.log('【Phase 2-2】外部取引監査・統合完了');
    console.log('='.repeat(80));
  }

  /**
   * 監査結果をDiscordに通知
   */
  async sendReconciliationNotification() {
    const severity = this.externalTrades.length > 0 ? '🔍' : '✅';
    const status = this.externalTrades.length > 0 ? '外部取引検出・統合' : '外部取引なし';

    let message = `${severity} **【Phase 2-2】外部取引監査完了**\n\n`;
    message += `🔍 外部取引検出: ${this.externalTrades.length}件\n`;
    message += `✅ 統合完了: ${this.reconciledTrades.length}件\n`;
    message += `❌ エラー: ${this.errors.length}件\n`;
    message += `📅 監査期間: 過去${this.lookbackHours}時間\n`;
    message += `🕐 実行時刻: ${new Date().toLocaleString('ja-JP')}\n`;

    if (this.reconciledTrades.length > 0) {
      const totalValue = this.reconciledTrades.reduce((sum, r) => sum + (r.trade.amount * r.trade.price), 0);
      message += `\n💰 **統合した取引総価値: ¥${totalValue.toFixed(0)}**\n`;

      const highPriorityTrades = this.reconciledTrades.filter(r => r.priority === 'high');
      if (highPriorityTrades.length > 0) {
        message += '\n🚨 **高額外部取引:**\n';
        for (const trade of highPriorityTrades.slice(0, 3)) {
          const value = trade.trade.amount * trade.trade.price;
          message += `• ${trade.symbol}: ¥${value.toFixed(0)} (${trade.estimatedStrategy})\n`;
        }
      }
    }

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('Discord通知の送信に失敗:', error.message);
    }
  }
}

/**
 * メイン実行関数
 */
async function main() {
  const reconciler = new ExternalTradesReconciler();

  // コマンドライン引数の処理
  if (process.argv.includes('--hours')) {
    const hoursIndex = process.argv.indexOf('--hours');
    if (hoursIndex + 1 < process.argv.length) {
      reconciler.lookbackHours = parseInt(process.argv[hoursIndex + 1]) || 24;
    }
  }

  try {
    console.log(`外部取引監査範囲: 過去${reconciler.lookbackHours}時間\n`);
    await reconciler.executeReconciliation();

  } catch (error) {
    console.error('外部取引監査実行エラー:', error);
    process.exit(1);
  } finally {
    console.log('🔍 【Phase 2-2】外部取引監査・統合完了');
    process.exit(0);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ExternalTradesReconciler };