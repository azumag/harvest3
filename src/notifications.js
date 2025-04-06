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
 * 結果情報をDiscordに投稿する関数（2000文字制限対応）
 * @param {String} message - 投稿するメッセージ
 */
async function postResultToDiscord(message) {
  if (!discordResultWebhookUrl) {
    console.error('Discord Webhook URLが設定されていません');
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

  // 各チャンクを順番に送信
  for (const chunk of chunks) {
    try {
      // Discord APIのレート制限を考慮して少し待機（必要に応じて調整）
      await new Promise(resolve => setTimeout(resolve, 500));
      await axios.post(discordResultWebhookUrl, { content: chunk });
    } catch (error) {
      console.error(`Discordへの通知チャンク送信に失敗しました: ${error.message}`);
      // エラーが発生しても次のチャンクの送信を試みる
    }
  }
}

module.exports = {
  postErrorToDiscord,
  postOrderToDiscord,
  postResultToDiscord
};
