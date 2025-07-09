#!/usr/bin/env node

/**
 * Redis ポジション自動クリーンアップスクリプト
 *
 * 古い完了ポジションをRedisから削除し、MongoDBに履歴として保存する
 * Issue #162: Redis ポジション管理の最適化対応
 *
 * 使用方法:
 *   node scripts/cleanupOldPositions.js [時間] [--no-history] [--dry-run]
 *
 * 引数:
 *   時間 (optional): この時間より古いポジションを削除（時間単位、デフォルト: 24）
 *   --no-history: 履歴保存をスキップ
 *   --dry-run: 実際には削除せず、削除対象のポジションを表示のみ
 *
 * 例:
 *   node scripts/cleanupOldPositions.js 48          # 48時間より古いポジションを削除
 *   node scripts/cleanupOldPositions.js --dry-run   # 削除対象を確認のみ
 *   node scripts/cleanupOldPositions.js 12 --no-history  # 12時間で履歴保存なし
 */

const { config } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const {
  cleanupOldClosedPositions,
  savePositionHistoryToMongoDB
} = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

// デフォルト設定
const DEFAULT_HOURS = 24;
const VERBOSE_LOGGING = process.env.NODE_ENV !== 'production';

/**
 * コマンドライン引数を解析
 */
function parseArguments() {
  const args = process.argv.slice(2);

  let hours = DEFAULT_HOURS;
  let saveHistory = true;
  let dryRun = false;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
    case '--help':
    case '-h':
      showHelp = true;
      break;
    case '--no-history':
      saveHistory = false;
      break;
    case '--dry-run':
      dryRun = true;
      break;
    default:
      // 数値引数（時間）
      const parsed = parseInt(arg);
      if (!isNaN(parsed) && parsed > 0) {
        hours = parsed;
      } else {
        console.error(`無効な引数: ${arg}`);
        showHelp = true;
      }
      break;
    }
  }

  return { hours, saveHistory, dryRun, showHelp };
}

/**
 * ヘルプメッセージを表示
 */
function showHelpMessage() {
  console.log(`
🧹 Redis ポジション自動クリーンアップスクリプト

使用方法:
  node scripts/cleanupOldPositions.js [時間] [オプション]

引数:
  時間                この時間より古いポジションを削除（時間単位、デフォルト: ${DEFAULT_HOURS}）

オプション:
  --no-history       履歴保存をスキップ
  --dry-run          実際には削除せず、削除対象のポジションを表示のみ
  --help, -h         このヘルプメッセージを表示

例:
  node scripts/cleanupOldPositions.js                    # 24時間より古いポジションを削除
  node scripts/cleanupOldPositions.js 48                 # 48時間より古いポジションを削除
  node scripts/cleanupOldPositions.js --dry-run          # 削除対象を確認のみ
  node scripts/cleanupOldPositions.js 12 --no-history    # 12時間で履歴保存なし

説明:
  このスクリプトは Redis に保存されている古い完了ポジションを自動削除し、
  MongoDB に履歴として保存します。定期実行により Redis のメモリ使用量を
  最適化し、システムのパフォーマンスを向上させます。
`);
}

/**
 * Dry-run モードで削除対象ポジションを表示
 */
async function showCleanupTargets(olderThanHours) {
  const { client } = require('../src/database/redisClient');

  try {
    const pattern = 'position:*';
    const keys = await client.keys(pattern);

    let totalProcessed = 0;
    let totalTargets = 0;
    const targets = [];

    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);

    console.log('🔍 削除対象ポジション検索中...');
    console.log(`   基準時刻: ${new Date(cutoffTime).toLocaleString('ja-JP')}`);
    console.log(`   対象: ${olderThanHours}時間以上前の完了ポジション\n`);

    for (const key of keys) {
      try {
        const position = await client.hGetAll(key);

        if (Object.keys(position).length > 0) {
          totalProcessed++;

          const closedAt = parseInt(position.closedAt || 0);
          const updatedAt = parseInt(position.updatedAt || 0);
          const isOld = Math.max(closedAt, updatedAt) < cutoffTime;

          if (position.status === 'closed' && isOld) {
            totalTargets++;
            const positionKey = key.replace('position:', '');

            targets.push({
              key: positionKey,
              exchangeId: position.exchangeId,
              symbol: position.symbol,
              strategyKey: position.strategyKey,
              orderId: position.orderId,
              amount: parseFloat(position.amount || 0),
              status: position.status,
              closedAt: closedAt ? new Date(closedAt).toLocaleString('ja-JP') : 'N/A',
              updatedAt: updatedAt ? new Date(updatedAt).toLocaleString('ja-JP') : 'N/A'
            });
          }
        }
      } catch (error) {
        console.error(`ポジション処理エラー: ${key}`, error.message);
      }
    }

    console.log('📊 検索結果:');
    console.log(`   処理対象件数: ${totalProcessed}`);
    console.log(`   削除対象件数: ${totalTargets}\n`);

    if (totalTargets > 0) {
      console.log('🗑️ 削除対象ポジション一覧:');
      console.log(`${'─'.repeat(120)}`);
      console.log(`| ${'取引所'.padEnd(10)} | ${'通貨ペア'.padEnd(12)} | ${'戦略'.padEnd(15)} | ${'注文ID'.padEnd(15)} | ${'数量'.padEnd(12)} | ${'クローズ日時'.padEnd(20)} |`);
      console.log(`${'─'.repeat(120)}`);

      targets.forEach(target => {
        console.log(`| ${target.exchangeId.padEnd(10)} | ${target.symbol.padEnd(12)} | ${target.strategyKey.padEnd(15)} | ${target.orderId.padEnd(15)} | ${target.amount.toFixed(6).padEnd(12)} | ${target.closedAt.padEnd(20)} |`);
      });

      console.log(`${'─'.repeat(120)}`);
      console.log('\n💡 実際に削除するには --dry-run オプションを外して実行してください。');
    } else {
      console.log('✅ 削除対象のポジションはありません。');
    }

    return { totalProcessed, totalTargets };
  } catch (error) {
    console.error('Dry-run モードでエラーが発生しました:', error);
    throw error;
  }
}

/**
 * メイン実行関数
 */
async function main() {
  const { hours, saveHistory, dryRun, showHelp } = parseArguments();

  if (showHelp) {
    showHelpMessage();
    process.exit(0);
  }

  console.log('🧹 Redis ポジションクリーンアップスクリプト');
  console.log(`📅 実行時刻: ${new Date().toLocaleString('ja-JP')}`);
  console.log(`⏰ 対象期間: ${hours}時間以上前の完了ポジション`);
  console.log(`💾 履歴保存: ${saveHistory ? '有効' : '無効'}`);
  console.log(`🔍 Dry-run: ${dryRun ? '有効（削除は実行されません）' : '無効'}`);
  console.log('');

  try {
    // Redis接続初期化
    console.log('🔗 Redis接続を初期化中...');
    await initRedisClient();
    console.log('✅ Redis接続完了\n');

    if (dryRun) {
      // Dry-run モード
      console.log('🔍 Dry-run モード: 削除対象ポジションを確認中...\n');
      const result = await showCleanupTargets(hours);

      console.log('\n📊 Dry-run 結果:');
      console.log(`   処理対象: ${result.totalProcessed}件`);
      console.log(`   削除対象: ${result.totalTargets}件`);

    } else {
      // 実際のクリーンアップ実行
      console.log('🧹 ポジションクリーンアップを実行中...\n');

      const result = await cleanupOldClosedPositions(hours, saveHistory);

      if (result.success) {
        console.log('\n✅ クリーンアップ完了:');
        console.log(`   処理件数: ${result.processed}`);
        console.log(`   削除件数: ${result.deleted}`);
        console.log(`   履歴保存件数: ${result.historySaved}`);
        console.log(`   エラー件数: ${result.errors}`);
        console.log(`   基準時刻: ${result.cutoffTime}`);

        // Discord通知（削除件数が0でない場合）
        if (result.deleted > 0) {
          const message = '🧹 [自動クリーンアップ] ポジション削除完了\n' +
                         `📊 処理件数: ${result.processed}\n` +
                         `🗑️ 削除件数: ${result.deleted}\n` +
                         `💾 履歴保存件数: ${result.historySaved}\n` +
                         `⚠️ エラー件数: ${result.errors}\n` +
                         `⏰ 対象期間: ${hours}時間以上前\n` +
                         `📅 実行時刻: ${new Date().toLocaleString('ja-JP')}`;

          try {
            if (postOrderToDiscord) {
              await postOrderToDiscord(message);
            }
          } catch (notificationError) {
            console.warn('Discord通知の送信に失敗しました:', notificationError.message);
          }
        }

        if (result.errors > 0) {
          console.warn(`⚠️ ${result.errors}件のエラーが発生しました。ログを確認してください。`);
        }

      } else {
        console.error(`❌ クリーンアップに失敗しました: ${result.error}`);

        const errorMessage = '❌ [自動クリーンアップ] ポジション削除失敗\n' +
                            `エラー: ${result.error}\n` +
                            `📅 実行時刻: ${new Date().toLocaleString('ja-JP')}`;

        try {
          if (postErrorToDiscord) {
            await postErrorToDiscord(errorMessage);
          }
        } catch (notificationError) {
          console.warn('Discord通知の送信に失敗しました:', notificationError.message);
        }

        process.exit(1);
      }
    }

  } catch (error) {
    console.error('❌ スクリプト実行中にエラーが発生しました:', error);

    const errorMessage = '❌ [自動クリーンアップ] スクリプト実行エラー\n' +
                        `エラー: ${error.message}\n` +
                        `📅 実行時刻: ${new Date().toLocaleString('ja-JP')}`;

    try {
      if (postErrorToDiscord) {
        await postErrorToDiscord(errorMessage);
      }
    } catch (notificationError) {
      console.warn('Discord通知の送信に失敗しました:', notificationError.message);
    }

    process.exit(1);

  } finally {
    console.log('\n🔍 ポジションクリーンアップスクリプト完了');
    process.exit(0);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(error => {
    console.error('予期しないエラーが発生しました:', error);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArguments,
  showCleanupTargets
};