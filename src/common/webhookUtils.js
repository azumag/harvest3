/**
 * Discord Webhook ユーティリティ関数
 * バックテストモードでのWebhook URLチェックとログ出力の共通処理
 */

const Logger = require('../hft/utils/Logger');
const logger = new Logger('WebhookUtils');

/**
 * ウェブフック未設定時のメッセージを生成
 * @param {string} context - コンテキスト（'', 'Order', 'Result'など）
 * @returns {string} メッセージ
 */
function getWebhookNotSetMessage(context = '') {
  const baseMessage = `Discord${context ? ` ${context}` : ''} Webhook URLが設定されていません`;
  return process.env.BACKTEST_MODE === 'true' 
    ? `${baseMessage} (バックテストモードのため通知をスキップ)`
    : baseMessage;
}

/**
 * ウェブフック未設定時のログ出力
 * @param {string} context - コンテキスト（'', 'Order', 'Result'など）
 */
function logWebhookNotSet(context = '') {
  const message = getWebhookNotSetMessage(context);
  try {
    if (process.env.BACKTEST_MODE === 'true') {
      logger.warn(message);
    } else {
      logger.error(message);
    }
  } catch (loggerError) {
    // Loggerが利用できない場合のフォールバック（初期化中等）
    if (process.env.BACKTEST_MODE === 'true') {
      console.warn(`[WebhookUtils] ${message}`);
    } else {
      console.error(`[WebhookUtils] ${message}`);
    }
  }
}

/**
 * ウェブフックURLの存在確認とログ出力
 * @param {string} webhookUrl - チェック対象のWebhook URL
 * @param {string} context - コンテキスト（'', 'Order', 'Result'など）
 * @returns {boolean} Webhook URLが設定されている場合true
 */
function checkWebhookUrl(webhookUrl, context = '') {
  if (!webhookUrl) {
    logWebhookNotSet(context);
    return false;
  }
  return true;
}

module.exports = {
  getWebhookNotSetMessage,
  logWebhookNotSet,
  checkWebhookUrl
};