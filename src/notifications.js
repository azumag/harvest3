const axios = require('axios');
const { discordErrorWebhookUrl, discordOrderWebhookUrl, discordResultWebhookUrl } = require('./config');

/**
 * エラーメッセージをDiscordに投稿する関数
 * @param {String} message - 投稿するメッセージ
 */
async function postErrorToDiscord(message) {
  if (discordErrorWebhookUrl) {
    try {
      await axios.post(discordErrorWebhookUrl, { content: message });
    } catch (error) {
      console.error('Discordへの通知に失敗しました: ', error);
    }
  } else {
    console.error('Discord Webhook URLが設定されていません');
  }
}

/**
 * 注文情報をDiscordに投稿する関数
 * @param {String} message - 投稿するメッセージ
 */
async function postOrderToDiscord(message) {
  if (discordOrderWebhookUrl) {
    try {
      await axios.post(discordOrderWebhookUrl, { content: message });
    } catch (error) {
      console.error('Discordへの通知に失敗しました: ', error);
    }
  } else {
    console.error('Discord Webhook URLが設定されていません');
  }
}

/**
 * 結果情報をDiscordに投稿する関数
 * @param {String} message - 投稿するメッセージ
 */
async function postResultToDiscord(message) {
  if (discordResultWebhookUrl) {
    try {
      await axios.post(discordResultWebhookUrl, { content: message });
    } catch (error) {
      console.error('Discordへの通知に失敗しました: ', error);
    }
  } else {
    console.error('Discord Webhook URLが設定されていません');
  }
}

module.exports = {
  postErrorToDiscord,
  postOrderToDiscord,
  postResultToDiscord
};