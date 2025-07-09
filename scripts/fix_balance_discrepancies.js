const { config } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const {
  getStrategyPositionsRedis,
  savePositionRedis,
  deletePositionRedis
} = require('../src/database/redisDatabase');

/**
 * 残高不整合の修正ツール
 */
class BalanceDiscrepancyFixer {
  constructor() {
    this.fixes = [];
    this.errors = [];
  }

  /**
   * 緊急修正の実行
   */
  async executeEmergencyFixes() {
    console.log('🚨 緊急残高不整合修正を開始...\n');

    await this.fixZombiePosition();
    await this.fixGalaOverPosition();
    await this.reportResults();
  }

  /**
   * ゾンビポジション（LINK/JPY）削除
   */
  async fixZombiePosition() {
    console.log('1️⃣ LINK/JPY ゾンビポジション削除中...');

    try {
      const positionKey = 'bitbank:LINK/JPY:BOLLINGER_BANDS:46807587451';
      const success = await deletePositionRedis(positionKey);

      if (success) {
        this.fixes.push({
          type: 'zombie_position_deletion',
          symbol: 'LINK/JPY',
          strategy: 'BOLLINGER_BANDS',
          action: 'Redisポジション削除',
          details: 'ポジション 0.0162 LINK を削除（実残高ゼロのため）'
        });
        console.log('✅ LINK/JPY ゾンビポジション削除完了');
      } else {
        throw new Error('Redis削除に失敗');
      }

    } catch (error) {
      this.errors.push({
        type: 'zombie_position_deletion_failed',
        symbol: 'LINK/JPY',
        error: error.message
      });
      console.error('❌ LINK/JPY ゾンビポジション削除失敗:', error.message);
    }
  }

  /**
   * GALA/JPY 過大ポジション修正
   */
  async fixGalaOverPosition() {
    console.log('\n2️⃣ GALA/JPY 過大ポジション修正中...');

    try {
      const exchange = config.exchanges.bitbank.instance;
      const balance = await exchange.fetchBalance();
      const actualUsed = balance.used.GALA || 0;

      if (actualUsed === 0) {
        console.log('⚠️ GALAの使用中残高が0のため、ポジション削除します');
        const positionKey = 'bitbank:GALA/JPY:OSCILLATOR:46810939296';
        await deletePositionRedis(positionKey);

        this.fixes.push({
          type: 'position_deletion',
          symbol: 'GALA/JPY',
          strategy: 'OSCILLATOR',
          action: 'ポジション削除',
          details: '使用中残高0のためポジション全削除'
        });
        console.log('✅ GALA/JPY ポジション削除完了');

      } else {
        // 実残高に合わせて調整
        const positions = await getStrategyPositionsRedis('bitbank', 'GALA/JPY', 'OSCILLATOR');

        if (positions.length > 0) {
          const position = positions[0];
          const oldAmount = position.amount;

          // 実際の使用中残高に合わせる
          position.amount = actualUsed;
          position.updatedAt = Date.now();

          const positionKey = `bitbank:GALA/JPY:OSCILLATOR:${position.orderId}`;
          await savePositionRedis(positionKey, position);

          this.fixes.push({
            type: 'position_amount_correction',
            symbol: 'GALA/JPY',
            strategy: 'OSCILLATOR',
            action: 'ポジション量修正',
            details: `${oldAmount} → ${actualUsed} GALA に修正`
          });
          console.log(`✅ GALA/JPY ポジション量修正: ${oldAmount} → ${actualUsed}`);
        }
      }

    } catch (error) {
      this.errors.push({
        type: 'gala_position_fix_failed',
        symbol: 'GALA/JPY',
        error: error.message
      });
      console.error('❌ GALA/JPY ポジション修正失敗:', error.message);
    }
  }

  /**
   * 修正結果のレポート
   */
  async reportResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📋 残高不整合修正結果レポート');
    console.log('='.repeat(60));

    console.log(`\n✅ 修正完了: ${this.fixes.length}件`);
    for (const fix of this.fixes) {
      console.log(`  • ${fix.symbol} (${fix.strategy}): ${fix.action}`);
      console.log(`    ${fix.details}`);
    }

    if (this.errors.length > 0) {
      console.log(`\n❌ 修正失敗: ${this.errors.length}件`);
      for (const error of this.errors) {
        console.log(`  • ${error.symbol}: ${error.error}`);
      }
    }

    console.log('\n📊 残り対応が必要な案件:');
    console.log('  • XRP/JPY (MUTUAL_INFO): 軽微な不整合（2.35%）- 監視継続');
    console.log('  • XLM/JPY (RSI): 記録不足（実残高 > ポジション）- 原因調査');
    console.log('  • APE/JPY (OSCILLATOR): 記録不足（実残高 > ポジション）- 原因調査');

    console.log('\n💡 次のステップ:');
    console.log('  1. 残高整合性チェッカーで修正確認');
    console.log('  2. 記録不足案件の原因調査');
    console.log('  3. 自動同期機能の実装');

    console.log('\n' + '='.repeat(60));
  }

  /**
   * 修正後の検証
   */
  async verifyFixes() {
    console.log('\n🔍 修正結果の検証中...');

    try {
      const exchange = config.exchanges.bitbank.instance;
      const balance = await exchange.fetchBalance();

      // LINK/JPY ゾンビポジション確認
      const linkPositions = await getStrategyPositionsRedis('bitbank', 'LINK/JPY', 'BOLLINGER_BANDS');
      console.log(`LINK/JPY ポジション数: ${linkPositions.length} (期待値: 0)`);

      // GALA/JPY ポジション確認
      const galaPositions = await getStrategyPositionsRedis('bitbank', 'GALA/JPY', 'OSCILLATOR');
      const galaUsed = balance.used.GALA || 0;
      if (galaPositions.length > 0) {
        console.log(`GALA/JPY ポジション: ${galaPositions[0].amount}, 実残高: ${galaUsed}`);
      } else {
        console.log(`GALA/JPY ポジション: 削除済み, 実残高: ${galaUsed}`);
      }

    } catch (error) {
      console.error('検証エラー:', error.message);
    }
  }
}

/**
 * メイン実行
 */
async function main() {
  const fixer = new BalanceDiscrepancyFixer();

  try {
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('Redis接続完了\n');

    await fixer.executeEmergencyFixes();
    await fixer.verifyFixes();

  } catch (error) {
    console.error('修正実行エラー:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BalanceDiscrepancyFixer };