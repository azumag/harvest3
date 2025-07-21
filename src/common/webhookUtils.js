/**
 * Discord Webhook ユーティリティ関数
 * バックテストモードでのWebhook URLチェックとログ出力の共通処理
 */

const Logger = require('../hft/utils/Logger');

/**
 * Loggerインスタンスを作成（フォールバック対応）
 * @returns {Object|null} Loggerインスタンスまたはnull
 */
function createLogger() {
  try {
    return new Logger('WebhookUtils');
  } catch (error) {
    return null; // フォールバック用
  }
}

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
  // 入力検証
  if (typeof context !== 'string') {
    context = '';
  }
  
  const message = getWebhookNotSetMessage(context);
  const logger = createLogger();
  const isBacktestMode = process.env.BACKTEST_MODE === 'true';
  
  if (logger) {
    logger[isBacktestMode ? 'warn' : 'error'](message);
  } else {
    // フォールバック: Loggerが利用できない場合
    console[isBacktestMode ? 'warn' : 'error'](`[WebhookUtils] ${message}`);
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