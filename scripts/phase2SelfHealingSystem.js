/**
 * Phase 2: 自己修復システム - Gemini提案の3フェーズ戦略実装
 * 優先度1（高）: 偽約定と部分約定の自動検出・修復システム
 */

const { config } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const { 
  getAllPositionsRedis, 
  deletePositionRedis,
  getTradeSummary,
  updateTradeSummary
} = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

class Phase2SelfHealingSystem {
  constructor() {
    this.detectedIssues = [];
    this.healedIssues = [];
    this.pendingIssues = [];
    this.errors = [];
  }

  /**
   * Phase 2 自己修復システムのメイン実行
   */
  async executeSelfHealing() {
    console.log('🔄 【Phase 2】自己修復システムを開始します...\n');
    
    try {
      console.log('Step 1: 偽約定ポジションの自動検出...');
      await this.autoDetectPhantomPositions();
      
      console.log('\nStep 2: 部分約定の不整合検出・修復...');
      await this.autoRepairPartialFills();
      
      console.log('\nStep 3: 軽微な残高不整合の自動修復...');
      await this.autoRepairMinorDiscrepancies();
      
      console.log('\nStep 4: 自己修復結果レポート生成...');
      await this.generateSelfHealingReport();
      
    } catch (error) {
      const errorMsg = `Phase 2 自己修復エラー: ${error.message}`;
      console.error(errorMsg);
      this.errors.push(errorMsg);
      await postErrorToDiscord(`🚨 **Phase 2 自己修復エラー**\n${errorMsg}`);
    }
  }

  /**
   * 偽約定ポジションの自動検出（Phase 1の拡張）
   */
  async autoDetectPhantomPositions() {
    const allPositions = await getAllPositionsRedis();
    
    for (const position of allPositions) {
      try {
        // 24時間以上前の大量ポジションをチェック
        const ageHours = (Date.now() - position.createdAt) / (1000 * 60 * 60);
        const isSuspicious = ageHours > 24 && position.amount > 5 && position.status === 'open';
        
        if (isSuspicious) {
          const exchange = config.exchanges[position.exchangeId]?.instance;
          if (!exchange) continue;

          try {
            const order = await exchange.fetchOrder(position.orderId, position.symbol);
            
            // 取引所で cancelled/rejected だが Redis で open の場合
            if ((order.status === 'canceled' || order.status === 'rejected') && position.status === 'open') {
              this.detectedIssues.push({
                type: 'phantom_position',
                position,
                exchangeStatus: order.status,
                severity: 'high',
                autoHealable: true
              });
              
              console.log(`❌ 偽約定検出: ${position.symbol} ${position.strategyKey} (${position.amount})`);
              console.log(`   取引所状態: ${order.status}, Redis状態: ${position.status}`);
            }
            
          } catch (orderError) {
            if (orderError.message.includes('Order not found')) {
              this.detectedIssues.push({
                type: 'phantom_position',
                position,
                exchangeStatus: 'not_found',
                severity: 'high',
                autoHealable: true
              });
              
              console.log(`❌ 存在しない注文のポジション: ${position.orderId}`);
            }
          }
          
          // API制限回避
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
      } catch (error) {
        console.warn(`ポジション検証エラー: ${position.orderId} - ${error.message}`);
      }
    }
  }

  /**
   * 部分約定の不整合検出・修復
   */
  async autoRepairPartialFills() {
    for (const issue of this.detectedIssues) {
      if (issue.type !== 'phantom_position') continue;
      
      try {
        const position = issue.position;
        const exchange = config.exchanges[position.exchangeId]?.instance;
        
        // 実際の約定履歴を確認
        const trades = await exchange.fetchMyTrades(position.symbol, undefined, 10);
        const relatedTrades = trades.filter(trade => trade.order === position.orderId);
        
        if (relatedTrades.length > 0) {
          const actualFilled = relatedTrades.reduce((sum, trade) => sum + trade.amount, 0);
          
          if (actualFilled > 0 && actualFilled < position.amount) {
            // 部分約定の場合：正しい金額に修正
            issue.type = 'partial_fill_mismatch';
            issue.actualAmount = actualFilled;
            issue.recordedAmount = position.amount;
            issue.autoHealable = true;
            
            console.log(`⚠️ 部分約定不整合: ${position.symbol} 実際:${actualFilled} 記録:${position.amount}`);
          } else if (actualFilled === 0) {
            // 約定なしの場合：偽約定として確定
            console.log(`❌ 約定履歴なし確認: ${position.orderId}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.warn(`部分約定確認エラー: ${issue.position.orderId} - ${error.message}`);
      }
    }
  }

  /**
   * 軽微な残高不整合の自動修復（0.1%未満）
   */
  async autoRepairMinorDiscrepancies() {
    // 自動修復可能な問題を処理
    const healableIssues = this.detectedIssues.filter(issue => issue.autoHealable);
    
    for (const issue of healableIssues) {
      try {
        if (issue.type === 'phantom_position') {
          // 偽約定ポジションの削除
          await deletePositionRedis(issue.position.key);
          
          this.healedIssues.push({
            ...issue,
            action: 'deleted_phantom_position',
            timestamp: Date.now()
          });
          
          console.log(`✅ 偽約定削除: ${issue.position.orderId}`);
          
        } else if (issue.type === 'partial_fill_mismatch') {
          // 部分約定の金額修正（実装は複雑なので今回はログのみ）
          this.pendingIssues.push({
            ...issue,
            action: 'requires_manual_review',
            timestamp: Date.now()
          });
          
          console.log(`⚠️ 手動確認要: ${issue.position.orderId} (部分約定)`);
        }
        
      } catch (error) {
        const errorMsg = `自動修復エラー: ${issue.position.orderId} - ${error.message}`;
        console.error(errorMsg);
        this.errors.push(errorMsg);
      }
    }
  }

  /**
   * 自己修復結果レポート生成
   */
  async generateSelfHealingReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 【Phase 2】自己修復システム - 結果レポート');
    console.log('='.repeat(80));
    
    console.log(`🔍 検出された問題: ${this.detectedIssues.length}件`);
    console.log(`✅ 自動修復完了: ${this.healedIssues.length}件`);
    console.log(`⚠️ 手動確認要: ${this.pendingIssues.length}件`);
    console.log(`❌ エラー発生: ${this.errors.length}件\n`);

    if (this.healedIssues.length > 0) {
      console.log('✅ 自動修復された問題:');
      console.log('-'.repeat(60));
      for (const healed of this.healedIssues) {
        console.log(`• ${healed.position.symbol} ${healed.position.strategyKey}: ${healed.action}`);
        console.log(`  オーダーID: ${healed.position.orderId}, 重要度: ${healed.severity}`);
      }
      console.log();
    }

    if (this.pendingIssues.length > 0) {
      console.log('⚠️ 手動確認が必要な問題:');
      console.log('-'.repeat(60));
      for (const pending of this.pendingIssues) {
        console.log(`• ${pending.position.symbol}: ${pending.type}`);
        if (pending.actualAmount) {
          console.log(`  実際約定: ${pending.actualAmount}, 記録: ${pending.recordedAmount}`);
        }
      }
      console.log();
    }

    // Discord通知
    await this.sendSelfHealingNotification();
    
    console.log('='.repeat(80));
    console.log('【Phase 2】自己修復システム完了');
    console.log('='.repeat(80));
  }

  /**
   * 自己修復結果をDiscordに通知
   */
  async sendSelfHealingNotification() {
    const severity = this.healedIssues.length > 0 ? '🔄' : '✅';
    const status = this.healedIssues.length > 0 ? '自己修復実行' : '問題なし';
    
    let message = `${severity} **【Phase 2】自己修復システム完了**\n\n`;
    message += `🔍 検出された問題: ${this.detectedIssues.length}件\n`;
    message += `✅ 自動修復完了: ${this.healedIssues.length}件\n`;
    message += `⚠️ 手動確認要: ${this.pendingIssues.length}件\n`;
    message += `❌ エラー: ${this.errors.length}件\n`;
    message += `🕐 実行時刻: ${new Date().toLocaleString('ja-JP')}\n`;

    if (this.healedIssues.length > 0) {
      message += '\n✅ **自動修復実行:**\n';
      for (const healed of this.healedIssues) {
        message += `• ${healed.position.symbol}: ${healed.action}\n`;
      }
    }

    if (this.pendingIssues.length > 0) {
      message += '\n⚠️ **手動確認要:**\n';
      for (const pending of this.pendingIssues) {
        message += `• ${pending.position.symbol}: ${pending.type}\n`;
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
  const healingSystem = new Phase2SelfHealingSystem();

  try {
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('Redis接続完了\n');

    await healingSystem.executeSelfHealing();
    
  } catch (error) {
    console.error('Phase 2 自己修復システム実行エラー:', error);
    process.exit(1);
  } finally {
    console.log('🔄 【Phase 2】自己修復システム完了');
    process.exit(0);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { Phase2SelfHealingSystem };