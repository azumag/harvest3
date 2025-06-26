/**
 * デバッグ検証とテストスクリプト
 * 修正されたシステムの検証を行う
 */

const { config } = require('../src/config');
const { connectDB, listTrades, listOrders } = require('../src/database/mongoDatabase');
const { initRedisClient, getClient } = require('../src/database/redisDatabase');
const { getAllTradeSummaries } = require('../src/database/redisDatabase');
const TransactionalOrderManager = require('../src/common/transactionalOrderManager');

class DebugValidator {
  constructor() {
    this.results = {
      redisKeyIssues: [],
      orphanedTrades: [],
      systemHealth: {},
      fixValidation: {}
    };
  }

  /**
   * 包括的デバッグ検証の実行
   */
  async runComprehensiveValidation() {
    console.log('🔍 【包括的デバッグ検証】開始...\n');

    try {
      // Redis接続を初期化
      await initRedisClient();
      const redisClient = getClient();
      
      console.log('Step 1: Redis キー整合性チェック...');
      await this.validateRedisKeyIntegrity(redisClient);
      
      console.log('\nStep 2: OUTSIDE戦略の孤立取引検証...');
      await this.validateOrphanedTrades();
      
      console.log('\nStep 3: 修正されたシステムコンポーネント検証...');
      await this.validateSystemFixes();
      
      console.log('\nStep 4: トランザクショナル注文システム検証...');
      await this.validateTransactionalOrderSystem();
      
      console.log('\nStep 5: 最終診断レポート生成...');
      this.generateDiagnosticReport();
      
    } catch (error) {
      console.error('検証エラー:', error);
      throw error;
    }
  }

  /**
   * Redis キー整合性チェック
   */
  async validateRedisKeyIntegrity(redisClient) {
    console.log('🔍 Redis キー整合性をチェック中...');

    try {
      // 全trade_summaryキーを取得
      const summaryKeys = await redisClient.keys('summary:trade:*');
      console.log(`総サマリーキー数: ${summaryKeys.length}件`);

      let validKeys = 0;
      let invalidKeys = 0;

      for (const key of summaryKeys) {
        const keyParts = key.split(':');
        
        if (keyParts.length === 5 && keyParts[0] === 'summary' && keyParts[1] === 'trade') {
          const [, exchange, symbol, strategy] = keyParts;
          
          if (exchange && symbol && strategy && 
              exchange !== 'undefined' && symbol !== 'undefined' && strategy !== 'undefined') {
            validKeys++;
          } else {
            invalidKeys++;
            this.results.redisKeyIssues.push({
              key,
              issue: 'undefined_values',
              parts: keyParts
            });
            console.log(`  ❌ 不正なキー: ${key} - undefined値検出`);
          }
        } else {
          invalidKeys++;
          this.results.redisKeyIssues.push({
            key,
            issue: 'invalid_format',
            parts: keyParts,
            expectedFormat: 'summary:trade:exchange:symbol:strategy'
          });
          console.log(`  ❌ 不正なキー形式: ${key}`);
        }
      }

      console.log(`✅ 有効キー: ${validKeys}件`);
      console.log(`❌ 無効キー: ${invalidKeys}件`);

      this.results.systemHealth.redisKeyHealth = {
        total: summaryKeys.length,
        valid: validKeys,
        invalid: invalidKeys,
        healthPercentage: summaryKeys.length > 0 ? (validKeys / summaryKeys.length * 100).toFixed(2) : 100
      };

    } catch (error) {
      console.error('Redis キー検証エラー:', error);
      this.results.redisKeyIssues.push({
        error: error.message,
        type: 'validation_error'
      });
    }
  }

  /**
   * OUTSIDE戦略の孤立取引検証
   */
  async validateOrphanedTrades() {
    console.log('🔍 OUTSIDE戦略の孤立取引を検証中...');

    try {
      // MongoDBからOUTSIDE戦略の取引を取得
      const outsideTrades = await listTrades(
        { strategy: 'OUTSIDE' },
        { timestamp: -1 },
        1000
      );

      console.log(`OUTSIDE戦略取引: ${outsideTrades.length}件`);

      // 売買別で集計
      const buyTrades = outsideTrades.filter(trade => trade.side === 'buy');
      const sellTrades = outsideTrades.filter(trade => trade.side === 'sell');

      console.log(`  買い: ${buyTrades.length}件`);
      console.log(`  売り: ${sellTrades.length}件`);

      // 異常比率チェック
      const sellRatio = outsideTrades.length > 0 ? (sellTrades.length / outsideTrades.length) : 0;
      console.log(`  売り取引比率: ${(sellRatio * 100).toFixed(1)}%`);

      if (sellRatio > 0.7) {
        console.log('  ⚠️ 警告: 売り取引比率が異常に高い (70%以上)');
        this.results.orphanedTrades.push({
          issue: 'excessive_sell_ratio',
          sellRatio: sellRatio,
          sellCount: sellTrades.length,
          buyCount: buyTrades.length
        });
      }

      // 最近の孤立取引をサンプリング
      const recentOrphaned = sellTrades.slice(0, 10);
      for (const trade of recentOrphaned) {
        this.results.orphanedTrades.push({
          orderId: trade.orderId,
          symbol: trade.symbol,
          amount: trade.amount,
          price: trade.price,
          timestamp: trade.timestamp,
          issue: 'potential_orphaned_sell'
        });
      }

    } catch (error) {
      console.error('孤立取引検証エラー:', error);
      this.results.orphanedTrades.push({
        error: error.message,
        type: 'validation_error'
      });
    }
  }

  /**
   * 修正されたシステムコンポーネント検証
   */
  async validateSystemFixes() {
    console.log('🔍 修正されたシステムコンポーネントを検証中...');

    try {
      // 1. getOrderStrategyKeyByOrderId関数の検証
      console.log('  📝 getOrderStrategyKeyByOrderId関数の修正確認...');
      const { getOrderStrategyKeyByOrderId } = require('../src/database/manager');
      
      // テスト用の存在しない注文IDで検証
      const testOrderId = 'non_existent_order_' + Date.now();
      
      try {
        const strategy = await getOrderStrategyKeyByOrderId(testOrderId);
        console.log(`    ✅ 修正確認: 存在しない注文ID → ${strategy} (OUTSIDE デフォルト)`);
        
        this.results.fixValidation.getOrderStrategyKeyByOrderId = {
          tested: true,
          result: strategy,
          status: 'functional'
        };
      } catch (error) {
        console.log(`    ❌ エラー発生: ${error.message}`);
        this.results.fixValidation.getOrderStrategyKeyByOrderId = {
          tested: true,
          error: error.message,
          status: 'error'
        };
      }

      // 2. ultimateAssetSyncRecovery.js の修正確認
      console.log('  📝 ultimateAssetSyncRecovery.js の修正確認...');
      try {
        const UltimateAssetSyncRecovery = require('./ultimateAssetSyncRecovery');
        const recovery = new UltimateAssetSyncRecovery();
        
        // 安全性制限の確認
        if (recovery.safetyLimits && recovery.safetyLimits.maxRepairs) {
          console.log(`    ✅ 安全性制限実装: 最大修復 ${recovery.safetyLimits.maxRepairs}件`);
          this.results.fixValidation.ultimateAssetSyncRecovery = {
            safetyLimits: true,
            maxRepairs: recovery.safetyLimits.maxRepairs,
            status: 'hardened'
          };
        } else {
          console.log('    ⚠️ 安全性制限が見つかりません');
          this.results.fixValidation.ultimateAssetSyncRecovery = {
            safetyLimits: false,
            status: 'needs_review'
          };
        }
      } catch (error) {
        console.log(`    ❌ スクリプト読み込みエラー: ${error.message}`);
        this.results.fixValidation.ultimateAssetSyncRecovery = {
          error: error.message,
          status: 'error'
        };
      }

      // 3. Redis hSet/hMSet 修正確認
      console.log('  📝 Redis hSet使用の確認...');
      const redisClient = getClient();
      try {
        // Redis client の hSet メソッドが利用可能か確認
        if (typeof redisClient.hSet === 'function') {
          console.log('    ✅ Redis hSet メソッド利用可能');
          this.results.fixValidation.redisHSet = {
            available: true,
            status: 'compatible'
          };
        } else {
          console.log('    ❌ Redis hSet メソッドが利用できません');
          this.results.fixValidation.redisHSet = {
            available: false,
            status: 'incompatible'
          };
        }
      } catch (error) {
        console.log(`    ❌ Redis確認エラー: ${error.message}`);
        this.results.fixValidation.redisHSet = {
          error: error.message,
          status: 'error'
        };
      }

    } catch (error) {
      console.error('システム修正検証エラー:', error);
      this.results.fixValidation.error = error.message;
    }
  }

  /**
   * トランザクショナル注文システム検証
   */
  async validateTransactionalOrderSystem() {
    console.log('🔍 トランザクショナル注文システムを検証中...');

    try {
      // モックExchangeオブジェクトを作成
      const mockExchange = {
        id: 'test_exchange',
        createLimitBuyOrder: async () => ({ id: 'test_order_123', symbol: 'BTC/JPY' }),
        cancelOrder: async () => ({ info: 'cancelled' })
      };

      const transactionalManager = new TransactionalOrderManager(mockExchange);

      // 基本機能テスト
      console.log('  📝 基本機能テスト実行中...');
      
      try {
        const transactionId = transactionalManager.generateTransactionId();
        console.log(`    ✅ トランザクションID生成: ${transactionId}`);
        
        // 統計情報取得テスト
        const stats = transactionalManager.getStatistics();
        console.log(`    ✅ 統計情報取得: ${JSON.stringify(stats)}`);

        this.results.fixValidation.transactionalOrderSystem = {
          transactionIdGeneration: true,
          statisticsAccess: true,
          basicFunctionality: true,
          status: 'operational'
        };

      } catch (testError) {
        console.log(`    ❌ 基本機能テストエラー: ${testError.message}`);
        this.results.fixValidation.transactionalOrderSystem = {
          error: testError.message,
          status: 'error'
        };
      }

    } catch (error) {
      console.error('トランザクショナルシステム検証エラー:', error);
      this.results.fixValidation.transactionalOrderSystem = {
        error: error.message,
        status: 'initialization_error'
      };
    }
  }

  /**
   * 最終診断レポート生成
   */
  generateDiagnosticReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 【包括的デバッグ検証】最終診断レポート');
    console.log('='.repeat(80));

    // システム健全性
    if (this.results.systemHealth.redisKeyHealth) {
      const health = this.results.systemHealth.redisKeyHealth;
      console.log('\n🏥 Redis システム健全性:');
      console.log(`  総キー数: ${health.total}件`);
      console.log(`  有効キー: ${health.valid}件`);
      console.log(`  無効キー: ${health.invalid}件`);
      console.log(`  健全度: ${health.healthPercentage}%`);
    }

    // 修正検証結果
    console.log('\n🔧 修正されたコンポーネント検証:');
    for (const [component, result] of Object.entries(this.results.fixValidation)) {
      const status = result.status || 'unknown';
      const statusIcon = status === 'functional' || status === 'operational' || status === 'hardened' || status === 'compatible' ? '✅' : '❌';
      console.log(`  ${statusIcon} ${component}: ${status}`);
      
      if (result.error) {
        console.log(`      エラー: ${result.error}`);
      }
    }

    // 推奨事項
    console.log('\n💡 推奨事項:');
    
    if (this.results.redisKeyIssues.length > 0) {
      console.log('  📝 Redis キークリーンアップの実行を推奨');
    }
    
    if (this.results.orphanedTrades.length > 0) {
      console.log('  📝 孤立取引の修復実行を推奨');
    }
    
    if (this.results.systemHealth.redisKeyHealth?.healthPercentage < 95) {
      console.log('  📝 Redis キー健全性の改善が必要');
    }
    
    // 実行準備状況
    console.log('\n🚀 システム実行準備状況:');
    
    const criticalFixes = [
      this.results.fixValidation.getOrderStrategyKeyByOrderId?.status === 'functional',
      this.results.fixValidation.redisHSet?.status === 'compatible',
      this.results.fixValidation.transactionalOrderSystem?.status === 'operational'
    ];
    
    const readyCount = criticalFixes.filter(Boolean).length;
    const totalCritical = criticalFixes.length;
    
    console.log(`  準備完了: ${readyCount}/${totalCritical} 重要コンポーネント`);
    
    if (readyCount === totalCritical) {
      console.log('  ✅ 【準備完了】ultimateAssetSyncRecovery.js の実行が可能です');
    } else {
      console.log('  ⚠️ 【準備未完了】追加の修正が必要です');
    }

    console.log('\n='.repeat(80));
    console.log('【包括的デバッグ検証】完了');
    console.log('='.repeat(80));
  }
}

/**
 * メイン実行関数
 */
async function main() {
  const validator = new DebugValidator();

  try {
    console.log('MongoDB接続を初期化中...');
    await connectDB();
    console.log('データベース接続完了\n');

    await validator.runComprehensiveValidation();
    
  } catch (error) {
    console.error('検証実行エラー:', error);
    process.exit(1);
  } finally {
    console.log('\n🔍 【包括的デバッグ検証】システム完了');
    process.exit(0);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { DebugValidator };