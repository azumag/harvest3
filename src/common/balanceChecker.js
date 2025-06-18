/**
 * 残高チェッカー - 取引所残高とbot管理残高の比較・監視
 * 完全再構築テスト用
 */
const { config } = require('../config');
const { postErrorToDiscord } = require('./notifications');
const { getAllPositionsRedis } = require('../database/redisDatabase');

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
  getExchangeBalance,
  getBotManagedBalance,
  compareBalances,
  checkAllExchangeBalances
};