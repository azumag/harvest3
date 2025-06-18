const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// 残高チェック機能用インポート
const { config } = require('../config');
const { getAllPositionsRedis } = require('../database/redisDatabase');

const discordErrorWebhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL; // Discord Webhook URL
const discordOrderWebhookUrl = process.env.DISCORD_ORDER_WEBHOOK_URL; // Discord Webhook URL
const discordResultWebhookUrl = process.env.DISCORD_RESULT_WEBHOOK_URL; // Discord Webhook URL
const discordWebWebhookUrl = process.env.DISCORD_WEB_WEBHOOK_URL; // Discord Webhook URL
const discordBacktestURL = process.env.DISCORD_BACKTEST_WEBHOOK_URL; // Discord Webhook URL

/**
 * エラーメッセージをDiscordに投稿する関数（レートリミット対応）
 * @param {String} message - 投稿するメッセージ
 * @param {number} [maxRetries=3] - 最大リトライ回数
 */
async function postErrorToDiscord(message, maxRetries = 3) {
  if (!discordErrorWebhookUrl) {
    console.error('Discord Webhook URLが設定されていません');
    return;
  }

  let retries = 0;
  while (retries <= maxRetries) {
    try {
      await axios.post(discordErrorWebhookUrl, { content: message });
      return; // 成功したら終了
    } catch (error) {
      // Axiosエラーかつレートリミット(429)の場合のみリトライ
      if (axios.isAxiosError(error) && error.response && error.response.status === 429) {
        retries++;
        if (retries > maxRetries) {
          console.error(`Discordエラー通知に失敗しました: ${maxRetries}回リトライしましたが、レートリミットが解消されません。`, error.response.data);
          break; // リトライ上限に達したらループを抜ける
        }

        // retry_afterヘッダーまたはデータから待機時間を取得 (秒単位)
        const retryAfterSeconds = error.response.data?.retry_after || parseInt(error.response.headers['retry-after'], 10) || 1; // デフォルト1秒
        // ミリ秒に変換し、少し余裕を持たせる (最低1秒は待つ)
        const waitTime = Math.max(Math.ceil(retryAfterSeconds * 1000) + 500, 1000);

        console.warn(`Discordエラー通知レートリミット: ${waitTime / 1000}秒待機してリトライします (${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // レートリミット以外のエラー、またはAxiosエラーでない場合
        console.error('Discordエラー通知に失敗しました: ', error.message || error);
        if (error.response) {
          console.error('エラーレスポンス Status:', error.response.status);
          console.error('エラーレスポンス Data:', error.response.data);
        }
        break; // リトライせずにループを抜ける
      }
    }
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

  await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒待機

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

/**
 * 取引所残高を取得する
 * @param {string} exchangeId - 取引所ID
 * @returns {Object} 取引所の残高情報
 */
async function getExchangeBalance(exchangeId) {
  try {
    const exchangeConfig = config.exchanges[exchangeId];
    if (!exchangeConfig) {
      throw new Error(`Exchange ${exchangeId} not found in config`);
    }

    const exchange = exchangeConfig.instance;
    const balance = await exchange.fetchBalance();
    
    console.log(`取引所残高取得完了: ${exchangeId}`);
    return balance;
  } catch (error) {
    console.error(`取引所残高取得エラー (${exchangeId}):`, error.message);
    throw error;
  }
}

/**
 * botで管理している未売却ポジションから計算した残高を取得する
 * @returns {Object} 通貨別の未売却ポジション残高
 */
async function getBotManagedBalance() {
  try {
    // Redisから全ポジションを取得
    const allPositions = await getAllPositionsRedis();
    
    // 買いポジション（未売却）のみを抽出
    const buyPositions = allPositions.filter(position => 
      position.side === 'buy' && 
      position.status !== 'closed' // クローズされていないポジション
    );
    
    // 通貨別に集計
    const currencyBalances = {};
    
    buyPositions.forEach(position => {
      // シンボルから基軸通貨を抽出 (例: BTC/JPY -> BTC)
      const [baseCurrency] = position.symbol.split('/');
      
      if (!currencyBalances[baseCurrency]) {
        currencyBalances[baseCurrency] = 0;
      }
      
      currencyBalances[baseCurrency] += position.amount || 0;
    });
    
    console.log('Bot管理残高計算完了:', currencyBalances);
    return currencyBalances;
  } catch (error) {
    console.error('Bot管理残高取得エラー:', error.message);
    throw error;
  }
}

/**
 * 残高を比較し、不整合があればDiscordに通知する
 * @param {string} exchangeId - 取引所ID
 * @param {number} thresholdPercent - 許容誤差（パーセント）- 完全一致チェックのため0
 */
async function compareBalances(exchangeId, thresholdPercent = 0) {
  try {
    console.log(`残高比較開始: ${exchangeId}`);
    
    // 取引所残高を取得
    const exchangeBalance = await getExchangeBalance(exchangeId);
    
    // Bot管理残高を取得
    const botBalance = await getBotManagedBalance();
    
    // 比較対象の通貨一覧（両方に存在する通貨 + 一定額以上の通貨）
    const significantThreshold = 0.00001; // 0.00001以上を有意とする（完全一致チェックのため閾値を大幅に下げる）
    const exchangeCurrencies = Object.keys(exchangeBalance.total).filter(
      currency => exchangeBalance.total[currency] >= significantThreshold
    );
    const botCurrencies = Object.keys(botBalance);
    const allCurrencies = [...new Set([...exchangeCurrencies, ...botCurrencies])];
    
    const discrepancies = [];
    
    for (const currency of allCurrencies) {
      const exchangeAmount = exchangeBalance.total[currency] || 0;
      const botAmount = botBalance[currency] || 0;
      
      // 有意な差がある場合のみチェック
      if (Math.max(exchangeAmount, botAmount) < significantThreshold) {
        continue;
      }
      
      // 差異の計算（完全一致チェック）
      const difference = Math.abs(exchangeAmount - botAmount);
      const maxAmount = Math.max(exchangeAmount, botAmount);
      const discrepancyPercent = maxAmount > 0 ? (difference / maxAmount) * 100 : 0;
      
      // 完全一致でない場合は全て通知（閾値0%）
      if (difference > 0) {
        discrepancies.push({
          currency,
          exchangeAmount,
          botAmount,
          difference,
          discrepancyPercent: Math.round(discrepancyPercent * 100) / 100
        });
      }
    }
    
    // 不整合があればDiscordに通知
    if (discrepancies.length > 0) {
      const message = createDiscrepancyMessage(exchangeId, discrepancies);
      await postErrorToDiscord(message);
      console.error(`残高不整合検出: ${exchangeId}`, discrepancies);
    } else {
      console.log(`残高チェック正常: ${exchangeId}`);
    }
    
    return {
      exchangeId,
      discrepancies,
      isHealthy: discrepancies.length === 0
    };
    
  } catch (error) {
    const errorMessage = `残高比較エラー (${exchangeId}): ${error.message}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    throw error;
  }
}

/**
 * 不整合メッセージを作成する
 * @param {string} exchangeId - 取引所ID
 * @param {Array} discrepancies - 不整合データ
 * @returns {string} Discord用メッセージ
 */
function createDiscrepancyMessage(exchangeId, discrepancies) {
  let message = `🚨 **残高不整合検出** (${exchangeId})\n`;
  message += `検出時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n\n`;
  
  discrepancies.forEach(disc => {
    message += `**${disc.currency}**\n`;
    message += `・取引所残高: ${disc.exchangeAmount.toFixed(6)}\n`;
    message += `・Bot管理残高: ${disc.botAmount.toFixed(6)}\n`;
    message += `・差異: ${disc.difference.toFixed(6)} (${disc.discrepancyPercent}%)\n\n`;
  });
  
  message += '⚠️ 手動確認と調整が必要です。';
  
  return message;
}

/**
 * 全取引所の残高チェックを実行
 */
async function checkAllExchangeBalances() {
  try {
    console.log('=== 全取引所残高チェック開始 ===');
    
    const results = [];
    const exchangeIds = Object.keys(config.exchanges);
    
    for (const exchangeId of exchangeIds) {
      try {
        const result = await compareBalances(exchangeId);
        results.push(result);
        
        // 各取引所チェック間に1秒待機
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`${exchangeId} の残高チェックに失敗:`, error.message);
        results.push({
          exchangeId,
          error: error.message,
          isHealthy: false
        });
      }
    }
    
    console.log('=== 全取引所残高チェック完了 ===');
    return results;
    
  } catch (error) {
    const errorMessage = `全取引所残高チェックエラー: ${error.message}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    throw error;
  }
}

module.exports = {
  postErrorToDiscord,
  postOrderToDiscord,
  postResultToDiscord,
  discordWebWebhookUrl,
  discordBacktestURL,
  // 残高チェック機能
  getExchangeBalance,
  getBotManagedBalance,
  compareBalances,
  checkAllExchangeBalances
};
