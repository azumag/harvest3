const axios = require('axios');
const dotenv = require('dotenv');
const rateLimiter = require('./discordRateLimiter');
const crypto = require('crypto');
const { checkWebhookUrl } = require('./webhookUtils');
dotenv.config();

// 残高チェック機能は balanceChecker.js に分離

const discordErrorWebhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL; // Discord Webhook URL
const discordOrderWebhookUrl = process.env.DISCORD_ORDER_WEBHOOK_URL; // Discord Webhook URL
const discordResultWebhookUrl = process.env.DISCORD_RESULT_WEBHOOK_URL; // Discord Webhook URL
const discordWebWebhookUrl = process.env.DISCORD_WEB_WEBHOOK_URL; // Discord Webhook URL
const discordBacktestURL = process.env.DISCORD_BACKTEST_WEBHOOK_URL; // Discord Webhook URL

/**
 * MongoDB接続エラーをDiscordに通知する関数
 * @param {String} errorMessage - エラーメッセージ
 * @param {String} mongoUrl - MongoDB接続URL
 */
async function postMongoConnectionErrorToDiscord(errorMessage, mongoUrl) {
  const message = `🚨 **MongoDB接続エラー**\n\`\`\`\nエラー: ${errorMessage}\n接続先: ${mongoUrl}\n時刻: ${new Date().toISOString()}\n\`\`\``;

  // 重複防止のためのキーを生成
  const deduplicationKey = crypto.createHash('sha256').update(`mongodb_error_${errorMessage}_${mongoUrl}`).digest('hex');

  await rateLimiter.send(discordErrorWebhookUrl, message, {
    priority: rateLimiter.notificationPriorities.CRITICAL,
    deduplicationKey,
    deduplicationWindow: 1800000 // 30分間の重複防止
  });
}

/**
 * エラーメッセージをDiscordに投稿する関数（統一レートリミット対応）
 * @param {String} message - 投稿するメッセージ
 * @param {Object} options - 通知オプション
 */
async function postErrorToDiscord(message, options = {}) {
  if (!checkWebhookUrl(discordErrorWebhookUrl)) {
    return;
  }

  // メッセージから重複防止キーを生成
  const deduplicationKey = options.deduplicationKey ||
    crypto.createHash('sha256').update(message.substring(0, 200)).digest('hex');

  await rateLimiter.send(discordErrorWebhookUrl, message, {
    priority: options.priority || rateLimiter.notificationPriorities.WARNING,
    deduplicationKey,
    deduplicationWindow: options.deduplicationWindow || 3600000, // 1時間
    maxRetries: options.maxRetries || 3
  });
}

/**
 * 注文情報をDiscordに投稿する関数（統一レートリミット対応）
 * @param {String} message - 投稿するメッセージ
 * @param {Object} options - 通知オプション
 */
async function postOrderToDiscord(message, options = {}) {
  if (!checkWebhookUrl(discordOrderWebhookUrl, 'Order')) {
    return;
  }

  // 注文情報の重複防止キーを生成
  const deduplicationKey = options.deduplicationKey ||
    crypto.createHash('sha256').update(`order_${message.substring(0, 100)}`).digest('hex');

  await rateLimiter.send(discordOrderWebhookUrl, message, {
    priority: options.priority || rateLimiter.notificationPriorities.WARNING,
    deduplicationKey,
    deduplicationWindow: options.deduplicationWindow || 600000, // 10分間
    maxRetries: options.maxRetries || 3
  });
}

/**
 * 結果情報をDiscordに投稿する関数（2000文字制限対応、統一レートリミット使用）
 * @param {String} message - 投稿するメッセージ
 * @param {String} discordWebhookURL - Webhook URL
 * @param {Object} options - 通知オプション
 */
async function postResultToDiscord(message, discordWebhookURL = discordResultWebhookUrl, options = {}) {
  if (!checkWebhookUrl(discordWebhookURL, 'Result')) {
    return;
  }

  const MAX_LENGTH = 2000;
  const chunks = [];
  let currentChunk = '';

  // メッセージを行ごとに分割
  const lines = message.split('\n');

  for (const line of lines) {
    // 現在のチャンクに次の行を追加しても制限を超えない場合
    if (currentChunk.length + line.length + 1 <= MAX_LENGTH) { // +1 は改行文字分
      currentChunk += (currentChunk ? '\n' : '') + line;
    } else {
      // 1行だけで制限を超える場合、その行を強制的に分割
      if (line.length > MAX_LENGTH) {
        // まず現在のチャンクがあれば送信
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        // 長い行を分割してチャンクに追加
        for (let i = 0; i < line.length; i += MAX_LENGTH) {
          chunks.push(line.substring(i, i + MAX_LENGTH));
        }
        currentChunk = ''; // 新しいチャンクを開始
      } else {
        // 現在のチャンクを送信リストに追加し、新しいチャンクを開始
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = line;
      }
    }
  }

  // 最後のチャンクを追加
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // 各チャンクを統一レートリミッターで順番に送信
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkDeduplicationKey = options.deduplicationKey ?
      `${options.deduplicationKey}_chunk_${i}` :
      crypto.createHash('sha256').update(`result_${chunk.substring(0, 100)}_${i}`).digest('hex');

    await rateLimiter.send(discordWebhookURL, chunk, {
      priority: options.priority || rateLimiter.notificationPriorities.INFO,
      deduplicationKey: chunkDeduplicationKey,
      deduplicationWindow: options.deduplicationWindow || 1800000, // 30分間
      maxRetries: options.maxRetries || 3
    });
  }
}

// 残高チェック機能は balanceChecker.js に分離されました

module.exports = {
  postErrorToDiscord,
  postMongoConnectionErrorToDiscord,
  postOrderToDiscord,
  postResultToDiscord,
  discordWebWebhookUrl,
  discordBacktestURL
};
