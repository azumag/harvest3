const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const discordErrorWebhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL; // Discord Webhook URL
const discordOrderWebhookUrl = process.env.DISCORD_ORDER_WEBHOOK_URL; // Discord Webhook URL
const discordResultWebhookUrl = process.env.DISCORD_RESULT_WEBHOOK_URL; // Discord Webhook URL
const discordWebWebhookUrl = process.env.DISCORD_WEB_WEBHOOK_URL; // Discord Webhook URL
const discordBacktestURL = process.env.DISCORD_BACKTEST_WEBHOOK_URL; // Discord Webhook URL

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
 * 注文情報をDiscordに投稿する関数（レートリミット対応）
 * @param {String} message - 投稿するメッセージ
 * @param {number} [maxRetries=3] - 最大リトライ回数
 */
async function postOrderToDiscord(message, maxRetries = 3) {
  if (!discordOrderWebhookUrl) {
    console.error('Discord Webhook URLが設定されていません');
    return;
  }

  let retries = 0;
  while (retries <= maxRetries) {
    try {
      await axios.post(discordOrderWebhookUrl, { content: message });
      return; // 成功したら終了
    } catch (error) {
      // Axiosエラーかつレートリミット(429)の場合のみリトライ
      if (axios.isAxiosError(error) && error.response && error.response.status === 429) {
        retries++;
        if (retries > maxRetries) {
          console.error(`Discordへの通知に失敗しました: ${maxRetries}回リトライしましたが、レートリミットが解消されません。`, error.response.data);
          break; // リトライ上限に達したらループを抜ける
        }

        // retry_afterヘッダーまたはデータから待機時間を取得 (秒単位)
        // エラーログから data.retry_after が小数で返ることを確認したので、そちらを優先
        const retryAfterSeconds = error.response.data?.retry_after || parseInt(error.response.headers['retry-after'], 10) || 1; // デフォルト1秒
        // ミリ秒に変換し、少し余裕を持たせる (最低1秒は待つ)
        const waitTime = Math.max(Math.ceil(retryAfterSeconds * 1000) + 500, 1000);

        console.warn(`Discordレートリミット: ${waitTime / 1000}秒待機してリトライします (${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // レートリミット以外のエラー、またはAxiosエラーでない場合
        console.error('Discordへの通知に失敗しました: ', error.message || error);
        if (error.response) {
          // エラーレスポンスの詳細を出力
          console.error('エラーレスポンス Status:', error.response.status);
          console.error('エラーレスポンス Data:', error.response.data);
        } else if (error.request) {
          // リクエストは行われたがレスポンスがない場合
          console.error('エラーリクエスト:', error.request);
        } else {
          // リクエスト設定時のエラー
          console.error('設定エラー:', error.message);
        }
        break; // リトライせずにループを抜ける
      }
    }
  }
}

/**
 * 結果情報をDiscordに投稿する関数（2000文字制限対応）
 * @param {String} message - 投稿するメッセージ
 */
async function postResultToDiscord(message, discordWebhookURL = discordResultWebhookUrl) {
  if (!discordWebhookURL) {
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
      await axios.post(discordWebhookURL, { content: chunk });
    } catch (error) {
      console.error(`Discordへの通知チャンク送信に失敗しました: ${error.message}`);
      // エラーが発生しても次のチャンクの送信を試みる
    }
  }
}

module.exports = {
  postErrorToDiscord,
  postOrderToDiscord,
  postResultToDiscord,
  discordWebWebhookUrl,
  discordBacktestURL
};
