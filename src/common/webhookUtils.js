/**
 * Discord Webhook ユーティリティ関数
 * バックテストモードでのWebhook URLチェックとログ出力の共通処理
 */

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
  if (process.env.BACKTEST_MODE === 'true') {
    console.warn(message);
  } else {
    console.error(message);
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