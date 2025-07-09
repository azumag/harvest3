/**
 * 緊急Phase1監査スクリプト - 偽約定ポジション検出と修復
 * Gemini提案の3フェーズ戦略 Phase 1 実装
 */

const { config } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const { getAllPositionsRedis, deletePositionRedis } = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

class EmergencyPhase1Auditor {
  constructor() {
    this.suspiciousPositions = [];
    this.verifiedFakePositions = [];
    this.deletedPositions = [];
    this.errors = [];
  }

  /**
   * Phase 1: 緊急診断と修復を実行
   */
  async executePhase1() {
    console.log('🚨 【Phase 1】緊急診断と修復を開始します...\n');

    try {
      console.log('Step 1: 偽約定ポジション検出中...');
      await this.detectFakePositions();

      console.log('\nStep 2: 取引所API経由で注文状態を確認中...');
      await this.verifyOrdersWithExchange();

      console.log('\nStep 3: 偽約定ポジションを安全に削除中...');
      await this.deleteFakePositions();

      console.log('\nStep 4: 結果レポート生成中...');
      await this.generatePhase1Report();

    } catch (error) {
      const errorMsg = `Phase 1 実行エラー: ${error.message}`;
      console.error(errorMsg);
      this.errors.push(errorMsg);
      await postErrorToDiscord(`🚨 **Phase 1 緊急修復エラー**\n${errorMsg}`);
    }
  }

  /**
   * 高リスク偽約定ポジションを検出
   */
  async detectFakePositions() {
    const allPositions = await getAllPositionsRedis();

    // 既知の問題ポジション（Gemini分析結果から）
    const knownFakeOrders = [
      '47148451536', // GALA - Bot: 27.3962, 取引所used: 0
      '47148562118'  // OAS - Bot: 43.0267, 取引所used: 0
    ];

    for (const position of allPositions) {
      // 既知の偽約定注文をマーク
      if (knownFakeOrders.includes(position.orderId)) {
        this.suspiciousPositions.push({
          ...position,
          reason: 'known_fake_order',
          severity: 'critical'
        });
        console.log(`❌ 【重大】偽約定検出: ${position.symbol} ${position.strategyKey} (${position.amount})`);
        console.log(`   オーダーID: ${position.orderId} - 取引所残高: 0`);
      }

      // その他の怪しいパターンも検出
      else if (position.status === 'open' && position.side === 'buy') {
        // 作成から24時間以上経過した大量ポジション
        const ageHours = (Date.now() - position.createdAt) / (1000 * 60 * 60);
        const isOldLargePosition = ageHours > 24 && position.amount > 10;

        if (isOldLargePosition) {
          this.suspiciousPositions.push({
            ...position,
            reason: 'old_large_position',
            severity: 'medium',
            ageHours: ageHours.toFixed(1)
          });
          console.log(`⚠️ 【中程度】疑わしいポジション: ${position.symbol} ${position.strategyKey} (${position.amount})`);
          console.log(`   経過時間: ${ageHours.toFixed(1)}時間`);
        }
      }
    }

    console.log(`\n📊 検出結果: 重大${this.suspiciousPositions.filter(p => p.severity === 'critical').length}件, 中程度${this.suspiciousPositions.filter(p => p.severity === 'medium').length}件`);
  }

  /**
   * 取引所API経由で注文状態を確認
   */
  async verifyOrdersWithExchange() {
    for (const position of this.suspiciousPositions) {
      try {
        const exchange = config.exchanges[position.exchangeId]?.instance;
        if (!exchange) {
          console.error(`取引所設定が見つかりません: ${position.exchangeId}`);
          continue;
        }

        console.log(`🔍 注文確認中: ${position.orderId} (${position.symbol})`);

        try {
          // 注文状態を取得
          const order = await exchange.fetchOrder(position.orderId, position.symbol);

          if (order.status === 'canceled' || order.status === 'rejected') {
            console.log(`❌ 【確認】注文が取り消し済み: ${position.orderId} (${order.status})`);
            this.verifiedFakePositions.push({
              ...position,
              exchangeStatus: order.status,
              verification: 'canceled_order'
            });
          } else if (order.status === 'open') {
            console.log(`⚠️ 【注意】注文が未約定状態: ${position.orderId}`);
            // 未約定注文として正しく管理されるべき
          } else if (order.status === 'closed' && order.filled < position.amount) {
            console.log(`⚠️ 【部分約定】期待値と実際の約定量に差異: ${position.orderId}`);
            console.log(`   期待: ${position.amount}, 実際: ${order.filled}`);
          }

        } catch (orderError) {
          if (orderError.message.includes('Order not found') ||
              orderError.message.includes('order_not_found')) {
            console.log(`❌ 【確認】注文が存在しません: ${position.orderId}`);
            this.verifiedFakePositions.push({
              ...position,
              exchangeStatus: 'not_found',
              verification: 'order_not_found'
            });
          } else {
            console.warn(`注文確認エラー: ${position.orderId} - ${orderError.message}`);
          }
        }

        // API制限を避けるため待機
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        const errorMsg = `注文確認エラー: ${position.orderId} - ${error.message}`;
        console.error(errorMsg);
        this.errors.push(errorMsg);
      }
    }
  }

  /**
   * 確認済み偽約定ポジションを安全に削除
   */
  async deleteFakePositions() {
    for (const fakePosition of this.verifiedFakePositions) {
      try {
        console.log(`🗑️ 偽約定ポジション削除中: ${fakePosition.orderId} (${fakePosition.symbol})`);

        // Redisからポジション削除
        await deletePositionRedis(fakePosition.key);

        this.deletedPositions.push(fakePosition);
        console.log(`✅ 削除完了: ${fakePosition.orderId}`);

      } catch (error) {
        const errorMsg = `ポジション削除エラー: ${fakePosition.orderId} - ${error.message}`;
        console.error(errorMsg);
        this.errors.push(errorMsg);
      }
    }
  }

  /**
   * Phase 1 結果レポートを生成
   */
  async generatePhase1Report() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 【Phase 1】緊急診断と修復 - 結果レポート');
    console.log('='.repeat(80));

    console.log(`🔍 疑わしいポジション検出: ${this.suspiciousPositions.length}件`);
    console.log(`✅ 偽約定確認済み: ${this.verifiedFakePositions.length}件`);
    console.log(`🗑️ 削除完了: ${this.deletedPositions.length}件`);
    console.log(`❌ エラー発生: ${this.errors.length}件\n`);

    if (this.deletedPositions.length > 0) {
      console.log('🗑️ 削除されたポジション:');
      console.log('-'.repeat(60));
      for (const deleted of this.deletedPositions) {
        console.log(`• ${deleted.symbol} ${deleted.strategyKey}: ${deleted.amount}`);
        console.log(`  オーダーID: ${deleted.orderId}, 理由: ${deleted.verification}`);
      }
      console.log();
    }

    if (this.errors.length > 0) {
      console.log('❌ 発生したエラー:');
      console.log('-'.repeat(40));
      for (const error of this.errors) {
        console.log(`• ${error}`);
      }
      console.log();
    }

    // Discord通知
    await this.sendPhase1Notification();

    console.log('='.repeat(80));
    console.log('【Phase 1】緊急診断と修復完了');
    console.log('='.repeat(80));
  }

  /**
   * Phase 1 結果をDiscordに通知
   */
  async sendPhase1Notification() {
    const severity = this.verifiedFakePositions.length > 0 ? '🚨' : '✅';
    const status = this.verifiedFakePositions.length > 0 ? '偽約定検出・修復完了' : '問題なし';

    let message = `${severity} **【Phase 1】緊急診断と修復完了**\n\n`;
    message += `🔍 疑わしいポジション: ${this.suspiciousPositions.length}件\n`;
    message += `✅ 偽約定確認: ${this.verifiedFakePositions.length}件\n`;
    message += `🗑️ 削除完了: ${this.deletedPositions.length}件\n`;
    message += `❌ エラー: ${this.errors.length}件\n`;
    message += `🕐 実行時刻: ${new Date().toLocaleString('ja-JP')}\n`;

    if (this.deletedPositions.length > 0) {
      message += '\n🗑️ **削除されたポジション:**\n';
      for (const deleted of this.deletedPositions) {
        message += `• ${deleted.symbol} ${deleted.strategyKey}: ${deleted.amount}\n`;
        message += `  ID: ${deleted.orderId} (${deleted.verification})\n`;
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
  const auditor = new EmergencyPhase1Auditor();

  try {
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('Redis接続完了\n');

    await auditor.executePhase1();

  } catch (error) {
    console.error('Phase 1 実行エラー:', error);
    process.exit(1);
  } finally {
    console.log('🚨 【Phase 1】緊急診断と修復完了');
    process.exit(0);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { EmergencyPhase1Auditor };