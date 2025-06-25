/**
 * 究極的資産同期復旧システム - 根本原因解決と完全同期実現
 * Gemini分析に基づく戦略-売り注文のリンク問題修復
 */

const { config } = require('../src/config');
const { connectDB, listOrders, listTrades, addTradeMongoDB } = require('../src/database/mongoDatabase');
const { initRedisClient } = require('../src/database/redisClient');
const { 
  getAllTradeSummaries,
  updateTradeSummary,
  getTradeSummary,
  deleteKey,
  getClient
} = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

class UltimateAssetSyncRecovery {
  constructor() {
    this.inconsistencies = [];
    this.repairedStrategies = [];
    this.orphanedTrades = [];
    this.strategyMappingErrors = [];
    this.errors = [];
    this.redisClient = null;
    this.safetyLimits = {
      maxRepairs: 100,
      maxOrphanedTrades: 50
    };
  }

  /**
   * 究極的資産同期復旧の実行
   */
  async executeUltimateRecovery() {
    console.log('🚀 【究極的資産同期復旧】システムを開始します...\n');
    
    try {
      // Redis接続を初期化
      console.log('Redis接続を初期化中...');
      this.redisClient = getClient();
      if (!this.redisClient) {
        throw new Error('Redis接続の初期化に失敗しました');
      }
      
      console.log('Step 1: 戦略-売り注文リンク問題の解析...');
      await this.analyzeStrategyLinkingIssues();
      
      // 安全性チェック
      if (this.strategyMappingErrors.length > this.safetyLimits.maxRepairs) {
        throw new Error(`安全制限に達しました: ${this.strategyMappingErrors.length}件の修復が必要（上限: ${this.safetyLimits.maxRepairs}件）`);
      }
      
      console.log('\nStep 2: OUTSIDE戦略の誤配置取引修復...');
      await this.repairOutsideStrategyMisallocations();
      
      console.log('\nStep 3: 戦略別netPosition再計算...');
      await this.recalculateAllNetPositions();
      
      console.log('\nStep 4: 取引所との完全同期検証...');
      await this.performFinalSyncVerification();
      
      console.log('\nStep 5: 結果レポート生成...');
      await this.generateUltimateRecoveryReport();
      
    } catch (error) {
      const errorMsg = `究極的資産同期復旧エラー: ${error.message}`;
      console.error(errorMsg);
      console.error('エラースタック:', error.stack);
      this.errors.push(errorMsg);
      await postErrorToDiscord(`🚨 **究極的資産同期復旧エラー**\n${errorMsg}`);
      throw error; // Re-throw to prevent silent failures
    }
  }

  /**
   * 戦略-売り注文リンク問題の解析
   * Gemini発見の根本原因：getOrderStrategyKeyByOrderId機能不全
   */
  async analyzeStrategyLinkingIssues() {
    console.log('🔍 戦略リンク問題を解析中...');
    
    // MongoDB から全取引を取得
    const allTrades = await listTrades({}, {}, 10000);
    console.log(`総取引数: ${allTrades.length}件`);
    
    // 戦略別取引集計
    const strategyBreakdown = {};
    for (const trade of allTrades) {
      const strategy = trade.strategy || 'UNKNOWN';
      if (!strategyBreakdown[strategy]) {
        strategyBreakdown[strategy] = { buy: 0, sell: 0, total: 0 };
      }
      strategyBreakdown[strategy][trade.side]++;
      strategyBreakdown[strategy].total++;
    }
    
    console.log('\n📊 戦略別取引集計:');
    for (const [strategy, data] of Object.entries(strategyBreakdown)) {
      const buyRatio = data.total > 0 ? (data.buy / data.total * 100).toFixed(1) : 0;
      console.log(`  ${strategy}: Buy ${data.buy}件 (${buyRatio}%) / Sell ${data.sell}件`);
      
      // OUTSIDE戦略の異常検出
      if (strategy === 'OUTSIDE' && data.sell > data.buy * 2) {
        this.strategyMappingErrors.push({
          strategy,
          issue: 'excessive_sell_allocation',
          buyCount: data.buy,
          sellCount: data.sell,
          severity: 'critical'
        });
        console.log(`    ❌ 異常検出: OUTSIDE戦略に売り注文が過度に配置 (${data.sell}売り vs ${data.buy}買い)`);
      }
    }
    
    // 最近の取引でのリンク問題確認
    await this.identifyRecentLinkingIssues(allTrades);
  }

  /**
   * 最近の取引でのリンク問題特定
   */
  async identifyRecentLinkingIssues(allTrades) {
    const recentTrades = allTrades.filter(trade => 
      Date.now() - trade.timestamp < 7 * 24 * 60 * 60 * 1000 // 過去7日
    );
    
    console.log(`\n🔍 過去7日の取引分析: ${recentTrades.length}件`);
    
    // 注文IDで取引をグループ化
    const orderGroups = {};
    for (const trade of recentTrades) {
      if (!orderGroups[trade.orderId]) {
        orderGroups[trade.orderId] = [];
      }
      orderGroups[trade.orderId].push(trade);
    }
    
    // 一つの注文で複数戦略に分かれている問題を検出
    for (const [orderId, trades] of Object.entries(orderGroups)) {
      const strategies = [...new Set(trades.map(t => t.strategy))];
      
      if (strategies.length > 1) {
        this.strategyMappingErrors.push({
          orderId,
          strategies,
          trades,
          issue: 'multiple_strategies_per_order',
          severity: 'high'
        });
        console.log(`    ❌ 注文分割問題: OrderID ${orderId} が複数戦略に分割 (${strategies.join(', ')})`);
      }
    }
  }

  /**
   * OUTSIDE戦略の誤配置取引修復
   */
  async repairOutsideStrategyMisallocations() {
    console.log('🔧 OUTSIDE戦略誤配置修復中...');
    
    // OUTSIDE戦略の売り取引を取得
    const outsideSellTrades = await listTrades(
      { strategy: 'OUTSIDE', side: 'sell' },
      { timestamp: -1 },
      1000
    );
    
    console.log(`OUTSIDE売り取引: ${outsideSellTrades.length}件`);
    
    let processedCount = 0;
    for (const sellTrade of outsideSellTrades) {
      if (processedCount >= this.safetyLimits.maxOrphanedTrades) {
        console.warn(`安全制限により処理を停止: ${this.safetyLimits.maxOrphanedTrades}件`);
        break;
      }
      
      try {
        // 対応する買い取引を探す
        const matchingBuyTrade = await this.findMatchingBuyTrade(sellTrade);
        processedCount++;
        
        if (matchingBuyTrade && matchingBuyTrade.strategy !== 'OUTSIDE') {
          // 売り取引の戦略を買い取引の戦略に修正
          const correctedTrade = {
            ...sellTrade,
            strategy: matchingBuyTrade.strategy,
            correctionReason: 'strategy_realignment',
            originalStrategy: 'OUTSIDE',
            correctedAt: Date.now()
          };
          
          // MongoDB更新
          await addTradeMongoDB(correctedTrade);
          
          // Redis trade_summary更新
          await this.updateTradeSummaryForCorrection(correctedTrade, sellTrade);
          
          this.repairedStrategies.push({
            orderId: sellTrade.orderId,
            symbol: sellTrade.symbol,
            originalStrategy: 'OUTSIDE',
            correctedStrategy: matchingBuyTrade.strategy,
            amount: sellTrade.amount
          });
          
          console.log(`    ✅ 修復: ${sellTrade.symbol} ${sellTrade.orderId} OUTSIDE → ${matchingBuyTrade.strategy}`);
        } else {
          this.orphanedTrades.push(sellTrade);
          console.log(`    ⚠️ 孤立取引: ${sellTrade.symbol} ${sellTrade.orderId} (対応する買い取引未発見)`);
        }
        
      } catch (error) {
        console.warn(`取引修復エラー: ${sellTrade.orderId} - ${error.message}`);
      }
    }
  }

  /**
   * 対応する買い取引を探す
   */
  async findMatchingBuyTrade(sellTrade) {
    // 1. 同じOrderIDの買い取引を探す（最も確実）
    const sameOrderBuy = await listTrades(
      { orderId: sellTrade.orderId, side: 'buy' },
      {},
      1
    );
    
    if (sameOrderBuy.length > 0) {
      return sameOrderBuy[0];
    }
    
    // 2. 同一シンボル・近い時間・近い金額の買い取引を探す
    const timeWindow = 24 * 60 * 60 * 1000; // 24時間
    const priceThreshold = 0.1; // 10%の価格差許容
    
    const candidateBuys = await listTrades(
      {
        symbol: sellTrade.symbol,
        side: 'buy',
        timestamp: {
          $gte: sellTrade.timestamp - timeWindow,
          $lte: sellTrade.timestamp + timeWindow
        }
      },
      { timestamp: 1 },
      100
    );
    
    // 最も条件に近い買い取引を選択
    for (const buyTrade of candidateBuys) {
      const priceRatio = Math.abs(buyTrade.price - sellTrade.price) / sellTrade.price;
      const amountRatio = Math.abs(buyTrade.amount - sellTrade.amount) / sellTrade.amount;
      
      if (priceRatio < priceThreshold && amountRatio < priceThreshold) {
        return buyTrade;
      }
    }
    
    return null;
  }

  /**
   * 修正のためのtrade_summary更新
   */
  async updateTradeSummaryForCorrection(correctedTrade, originalTrade) {
    // 元のOUTSIDE戦略から売りを削除
    const outsideSummary = await getTradeSummary(
      originalTrade.exchange,
      originalTrade.symbol,
      'OUTSIDE'
    );
    
    if (outsideSummary) {
      outsideSummary.sellAmount -= originalTrade.amount;
      outsideSummary.totalSellRevenue -= originalTrade.amount * originalTrade.price;
      outsideSummary.netPosition = outsideSummary.buyAmount - outsideSummary.sellAmount;
      
      await updateTradeSummary({
        exchange: originalTrade.exchange,
        symbol: originalTrade.symbol,
        strategy: 'OUTSIDE',
        side: 'sell',
        amount: -originalTrade.amount, // 負の値で削除
        price: originalTrade.price
      });
    }
    
    // 正しい戦略に売りを追加
    await updateTradeSummary(correctedTrade);
  }

  /**
   * 戦略別netPosition完全再計算
   */
  async recalculateAllNetPositions() {
    console.log('🔄 全戦略netPosition再計算中...');
    
    const allSummaries = await getAllTradeSummaries();
    console.log(`処理対象サマリー: ${allSummaries.length}件`);
    
    for (const summaryData of allSummaries) {
      try {
        // getAllTradeSummaries returns objects, not keys
        const { exchangeId: exchange, symbol, strategyKey: strategy } = summaryData;
        
        if (!exchange || !symbol || !strategy) {
          console.warn(`不正なサマリーデータ: ${JSON.stringify(summaryData)}`);
          continue;
        }
        
        const summaryKey = `trade_summary:${exchange}:${symbol}:${strategy}`;
        
        // 該当戦略の全取引を取得
        const strategyTrades = await listTrades(
          { exchange, symbol, strategy },
          { timestamp: 1 },
          1000
        );
        
        // netPositionを再計算
        let buyAmount = 0, sellAmount = 0;
        let totalBuyCost = 0, totalSellRevenue = 0;
        
        for (const trade of strategyTrades) {
          if (trade.side === 'buy') {
            buyAmount += trade.amount;
            totalBuyCost += trade.amount * trade.price;
          } else {
            sellAmount += trade.amount;
            totalSellRevenue += trade.amount * trade.price;
          }
        }
        
        const netPosition = buyAmount - sellAmount;
        
        // Redis更新
        const correctedSummary = {
          buyAmount,
          sellAmount,
          totalBuyCost,
          totalSellRevenue,
          netPosition,
          avgBuyPrice: buyAmount > 0 ? totalBuyCost / buyAmount : 0,
          avgSellPrice: sellAmount > 0 ? totalSellRevenue / sellAmount : 0,
          realizedPnL: totalSellRevenue - (sellAmount * (buyAmount > 0 ? totalBuyCost / buyAmount : 0)),
          updatedAt: Date.now()
        };
        
        // Redis に直接設定
        if (!this.redisClient) {
          console.error(`Redis接続がありません: ${summaryKey}`);
          continue;
        }
        
        // hSet を使用（hMSet は非推奨）
        for (const [field, value] of Object.entries(correctedSummary)) {
          await this.redisClient.hSet(summaryKey, field, value.toString());
        }
        
        console.log(`    ✅ 再計算完了: ${strategy} ${symbol} netPosition: ${netPosition.toFixed(6)}`);
        
      } catch (error) {
        console.warn(`サマリー再計算エラー: ${summaryKey} - ${error.message}`);
      }
    }
  }

  /**
   * 取引所との最終同期検証
   */
  async performFinalSyncVerification() {
    console.log('🎯 取引所との最終同期検証中...');
    
    for (const exchangeId of Object.keys(config.exchanges)) {
      try {
        const exchange = config.exchanges[exchangeId]?.instance;
        if (!exchange) continue;
        
        console.log(`  📊 ${exchangeId} 検証中...`);
        
        // 取引所残高取得
        const exchangeBalance = await exchange.fetchBalance();
        
        // Bot計算残高取得
        const botBalance = await this.calculateBotBalance();
        
        // 検証結果
        const verification = this.verifyBalanceSync(exchangeBalance, botBalance);
        console.log(`    結果: ${verification.matched}/${verification.total} 通貨で同期 (${verification.accuracy.toFixed(1)}%)`);
        
      } catch (error) {
        console.warn(`  ❌ ${exchangeId} 検証エラー: ${error.message}`);
      }
    }
  }

  /**
   * Bot残高計算
   */
  async calculateBotBalance() {
    const summaries = await getAllTradeSummaries();
    const balance = {};
    
    for (const summaryData of summaries) {
      try {
        // getAllTradeSummaries returns objects, not keys
        const { symbol, netPosition } = summaryData;
        
        if (!symbol || netPosition === undefined) {
          console.warn(`不正なサマリーデータ: ${JSON.stringify(summaryData)}`);
          continue;
        }
        
        if (netPosition !== 0) {
          const [currency] = symbol.split('/');
          
          if (!balance[currency]) balance[currency] = 0;
          balance[currency] += parseFloat(netPosition) || 0;
        }
      } catch (error) {
        console.warn(`残高計算エラー: ${JSON.stringify(summaryData)} - ${error.message}`);
      }
    }
    
    return balance;
  }

  /**
   * 残高同期検証
   */
  verifyBalanceSync(exchangeBalance, botBalance) {
    const allCurrencies = [...new Set([
      ...Object.keys(exchangeBalance.total || {}),
      ...Object.keys(botBalance)
    ])];
    
    let matched = 0;
    const threshold = 0.0001; // 0.0001以下の差は許容
    
    for (const currency of allCurrencies) {
      const exchangeAmount = exchangeBalance.total[currency] || 0;
      const botAmount = botBalance[currency] || 0;
      const diff = Math.abs(exchangeAmount - botAmount);
      
      if (diff <= threshold) {
        matched++;
      }
    }
    
    return {
      matched,
      total: allCurrencies.length,
      accuracy: (matched / allCurrencies.length) * 100
    };
  }

  /**
   * 究極的復旧結果レポート生成
   */
  async generateUltimateRecoveryReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 【究極的資産同期復旧】結果レポート');
    console.log('='.repeat(80));
    
    console.log(`🔧 戦略リンク修復: ${this.repairedStrategies.length}件`);
    console.log(`⚠️ 戦略マッピングエラー: ${this.strategyMappingErrors.length}件`);
    console.log(`🔍 孤立取引検出: ${this.orphanedTrades.length}件`);
    console.log(`❌ エラー発生: ${this.errors.length}件\n`);

    if (this.repairedStrategies.length > 0) {
      console.log('🔧 修復された戦略リンク:');
      console.log('-'.repeat(60));
      for (const repair of this.repairedStrategies) {
        console.log(`• ${repair.symbol}: ${repair.originalStrategy} → ${repair.correctedStrategy}`);
        console.log(`  OrderID: ${repair.orderId}, 数量: ${repair.amount}`);
      }
      console.log();
    }

    if (this.strategyMappingErrors.length > 0) {
      console.log('⚠️ 発見された戦略マッピングエラー:');
      console.log('-'.repeat(60));
      for (const error of this.strategyMappingErrors) {
        console.log(`• ${error.issue}: ${error.severity}`);
        if (error.strategy) {
          console.log(`  戦略: ${error.strategy} (Buy: ${error.buyCount}, Sell: ${error.sellCount})`);
        }
      }
      console.log();
    }

    // Discord通知
    await this.sendUltimateRecoveryNotification();
    
    console.log('='.repeat(80));
    console.log('【究極的資産同期復旧】完了');
    console.log('='.repeat(80));
  }

  /**
   * 究極的復旧結果をDiscordに通知
   */
  async sendUltimateRecoveryNotification() {
    const severity = this.repairedStrategies.length > 0 ? '🔧' : '✅';
    const status = this.repairedStrategies.length > 0 ? '重大問題修復完了' : '問題なし';
    
    let message = `${severity} **【究極的資産同期復旧】完了**\n\n`;
    message += `🔧 戦略リンク修復: ${this.repairedStrategies.length}件\n`;
    message += `⚠️ マッピングエラー: ${this.strategyMappingErrors.length}件\n`;
    message += `🔍 孤立取引: ${this.orphanedTrades.length}件\n`;
    message += `❌ エラー: ${this.errors.length}件\n`;
    message += `🕐 実行時刻: ${new Date().toLocaleString('ja-JP')}\n`;

    if (this.repairedStrategies.length > 0) {
      message += '\n🔧 **主要な修復:**\n';
      for (const repair of this.repairedStrategies.slice(0, 5)) {
        message += `• ${repair.symbol}: ${repair.originalStrategy} → ${repair.correctedStrategy}\n`;
      }
      
      if (this.repairedStrategies.length > 5) {
        message += `...他${this.repairedStrategies.length - 5}件\n`;
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
  const recovery = new UltimateAssetSyncRecovery();

  try {
    console.log('MongoDB接続を初期化中...');
    await connectDB();
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('データベース接続完了\n');

    await recovery.executeUltimateRecovery();
    
  } catch (error) {
    console.error('究極的資産同期復旧実行エラー:', error);
    process.exit(1);
  } finally {
    console.log('🚀 【究極的資産同期復旧】システム完了');
    process.exit(0);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { UltimateAssetSyncRecovery };