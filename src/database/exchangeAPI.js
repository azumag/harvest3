const https = require('https');
const { postErrorToDiscord } = require('../common/notifications');
const { recordError } = require('../api/controllers/errorStats');
const { isBacktestMode } = require('../common/utils');
const { throttleMonitor } = require('../common/throttleMonitor');
const Logger = require('../hft/utils/Logger');

// Logger instance for exchange API operations
const logger = new Logger('ExchangeAPI');

// Bitbank API関連の定数
const BITBANK_PUBLIC_API_URL = 'https://public.bitbank.cc';

// 連続失敗カウンターと制限値
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

// ccxtのtimeframeとbitbankのcandle-typeのマッピング
// 実際にサポートされているタイムフレームのみ
const TIMEFRAME_TO_CANDLE_TYPE = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1hour'
  // 注意: 4h, 8h, 12h, 1d, 1w, 1monthはBitbank APIでサポートされていない
};

/**
 * API制限のための待機処理
 * Bitbank API制限: 取得系 10回/秒、更新系 6回/秒
 * @param {Number} waitTime - 待機時間（ミリ秒）
 * @returns {Promise<void>}
 */
async function waitForAPILimit(waitTime = 100) {
  return new Promise(resolve => setTimeout(resolve, waitTime));
}

// Bitbank Public APIレートリミット管理（CCXT経由ではないPublic API用）
// Issue #210: CCXT標準機能を使用し、Public API用は最小限の制御のみ
let lastBitbankRequestTime = 0;
const BITBANK_RATE_LIMIT_MS = 120; // Public API用の最小制御

/**
 * Bitbank APIのレートリミットを管理しながら実行する
 */
async function executeBitbankAPIWithRateLimit(apiCall) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastBitbankRequestTime;

  if (timeSinceLastRequest < BITBANK_RATE_LIMIT_MS) {
    const waitTime = BITBANK_RATE_LIMIT_MS - timeSinceLastRequest;
    logger.info(`[Bitbank API Rate Limit] ${waitTime}ms待機中...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  try {
    const result = await apiCall();
    lastBitbankRequestTime = Date.now();
    consecutiveFailures = 0; // 成功時は失敗カウンターをリセット
    throttleMonitor.recordRequest(false); // 成功を記録
    return result;
  } catch (error) {
    lastBitbankRequestTime = Date.now();
    consecutiveFailures++;
    logger.error(`[Bitbank API Error] 連続失敗: ${consecutiveFailures}回`, error.message);
    throttleMonitor.recordRequest(true, error.message); // エラーを記録

    // レートリミットエラーの場合はスマートな待機時間を使用
    if (error.message.includes('rate limit') || error.message.includes('429') || error.message.includes('throttle') || error.message.includes('maxCapacity')) {
      const recommendedDelay = throttleMonitor.getRecommendedDelay();
      const throttleDelay = Math.max(recommendedDelay, Math.min(1000 * consecutiveFailures, 30000)); // 最大 30秒
      logger.warn(`[Bitbank API Throttle] スロットリングエラーのため${throttleDelay}ms待機...`);
      await new Promise(resolve => setTimeout(resolve, throttleDelay));
    }

    // 連続失敗が多い場合はエラーを抜けて続行
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error(`[Bitbank API Critical] 連続失敗が${MAX_CONSECUTIVE_FAILURES}回を超えました。エラーを抜けて続行します。`);
      return null;
    }

    throw error;
  }
}

// Bitbankの専用APIを呼び出す関数
async function fetchBitbankOHLCV(pair, candleType, dateStr, limit) {
  const options = {
    hostname: 'public.bitbank.cc',
    path: `/${pair}/candlestick/${candleType}/${dateStr}`,
    method: 'GET'
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success && parsed.data && parsed.data.candlestick) {
            // Bitbank形式をCCXT形式に変換
            const ccxtData = parsed.data.candlestick[0].ohlcv.map(candle => [
              new Date(candle[5]).getTime(), // timestamp (index 5)
              parseFloat(candle[0]),         // open
              parseFloat(candle[1]),         // high
              parseFloat(candle[2]),         // low
              parseFloat(candle[3]),         // close
              parseFloat(candle[4])          // volume
            ]);
            resolve(ccxtData);
          } else {
            reject(new Error(`Bitbank API error: ${JSON.stringify(parsed)}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * 日付形式を決定するヘルパー関数
 */
function getDateFormat(candleType) {
  // YYYYMMDD形式が必要なもの
  const dailyFormats = ['1min', '5min', '15min', '30min', '1hour'];
  return dailyFormats.includes(candleType) ? 'YYYYMMDD' : 'YYYY';
}

/**
 * 指定された日付形式でYYYYMMDD文字列を生成
 */
function formatDateString(date, format) {
  if (format === 'YYYYMMDD') {
    return date.getFullYear().toString() +
           (date.getMonth() + 1).toString().padStart(2, '0') +
           date.getDate().toString().padStart(2, '0');
  } else {
    return date.getFullYear().toString();
  }
}

/**
 * 日付に基づいてBCH/BCC変換を行う
 * @param {String} pair - 元の通貨ペア
 * @param {Date} targetDate - 対象日付
 * @returns {String} 変換後の通貨ペア
 */
function convertPairForHistoricalData(pair, targetDate) {
  // BCH は 2018年以前は BCC として取引されていた
  if (pair === 'bch_jpy' && targetDate.getFullYear() <= 2018) {
    logger.info(`[Bitbank API] ${targetDate.getFullYear()}年のBCHデータをBCCとして取得`);
    return 'bcc_jpy';
  }
  return pair;
}

/**
 * Bitbank専用の複数期間にわたるOHLCVデータ取得
 * @param {String} pair - 通貨ペア（bitbank形式: btc_jpy）
 * @param {String} candleType - ローソク足タイプ
 * @param {Number} limit - 取得データ数
 * @returns {Promise<Array>} - OHLCV配列
 */
async function fetchBitbankHistoricalOHLCVData(pair, candleType, limit) {
  const allData = [];
  const dateFormat = getDateFormat(candleType);

  // バックテストモード時はログを簡略化
  const isBacktest = isBacktestMode();
  if (!isBacktest) {
    logger.info(`[Bitbank API] データ取得開始: ${pair} ${candleType} ${limit}件 (形式: ${dateFormat})`);
  }

  // 開始日を設定
  const currentDate = new Date();

  // 必要な期間数を計算
  const periodsNeeded = dateFormat === 'YYYYMMDD' ? Math.min(limit, 30) : 3; // 最大30日または3年

  for (let i = 0; i < periodsNeeded && allData.length < limit; i++) {
    const targetDate = new Date(currentDate);

    if (dateFormat === 'YYYYMMDD') {
      targetDate.setDate(currentDate.getDate() - i);
    } else {
      targetDate.setFullYear(currentDate.getFullYear() - i);
    }

    const dateStr = formatDateString(targetDate, dateFormat);

    // 日付に基づいてシンボル変換（BCH → BCC）
    const actualPair = convertPairForHistoricalData(pair, targetDate);

    try {
      if (!isBacktest) {
        logger.info(`[Bitbank API] ${dateStr}のデータ取得中... (ペア: ${actualPair})`);
      }
      const periodData = await fetchBitbankOHLCV(actualPair, candleType, dateStr, limit - allData.length);

      if (periodData.length === 0) {
        if (!isBacktest) {
          logger.info(`[Bitbank API] ${dateStr}: データなし`);
        }

        // BCCで失敗した場合、BCHを試す（または逆）
        if (actualPair !== pair) {
          if (!isBacktest) {
            logger.info(`[Bitbank API] ${dateStr}: ${actualPair}でデータなし、${pair}で再試行`);
          }
          try {
            const fallbackData = await fetchBitbankOHLCV(pair, candleType, dateStr, limit - allData.length);
            if (fallbackData.length > 0) {
              allData.unshift(...fallbackData);
              if (!isBacktest) {
                logger.info(`[Bitbank API] ${dateStr}: ${fallbackData.length}件取得 (フォールバック: ${pair})`);
              }
            }
          } catch (fallbackError) {
            if (!isBacktest) {
              logger.warn(`[Bitbank API] ${dateStr}: フォールバックも失敗`);
            }
          }
        }
        continue;
      }

      // 新しいデータを古いデータの前に追加（時系列順を保持）
      allData.unshift(...periodData);

      if (!isBacktest) {
        logger.info(`[Bitbank API] ${dateStr}: ${periodData.length}件取得 (合計: ${allData.length}件)`);
      }

      // API制限対策: Bitbank制限 10回/秒 = 100ms間隔
      await waitForAPILimit(150);
    } catch (error) {
      // エラーコード10000（サポートされていないタイムフレームまたはペア）の場合
      if (error.message && error.message.includes('10000')) {
        logger.warn(`[Bitbank API] ${dateStr}: サポートされていないリクエスト (ペア: ${actualPair}, タイムフレーム: ${candleType})`);
        if (i === 0) {
          // 最新期間でサポートされていない場合はログのみ
          logger.warn(`[Bitbank API] ${pair} ${candleType} はサポートされていません`);
          return [];
        }
        continue;
      }

      logger.error(`[Bitbank API] ${dateStr}のデータ取得エラー:`, error.message);
      if (i === 0) {
        // 最新期間で重大なエラーの場合は中断
        throw error;
      }
      // 過去期間のエラーは無視して続行
      continue;
    }
  }

  // 時系列順にソート（古い→新しい）
  allData.sort((a, b) => a[0] - b[0]);

  // 必要な件数だけ返す（最新のデータから）
  const result = allData.slice(-limit);

  if (!isBacktest) {
    logger.info(`[Bitbank API] データ取得完了: ${result.length}件`);
  }

  return result;
}

/**
 * 標準的な取引所からのOHLCVデータ取得
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} timeframe - 時間枠
 * @param {Number} limit - 取得データ数
 * @returns {Promise<Array>} - OHLCV配列
 */
async function fetchStandardHistoricalOHLCVData(exchange, symbol, timeframe, limit) {
  const isBacktest = isBacktestMode();

  // Bitbankでサポートされていないタイムフレームの事前チェック
  if (exchange.id === 'bitbank') {
    const supportedTimeframes = ['1m', '5m', '15m', '30m', '1h'];
    if (!supportedTimeframes.includes(timeframe)) {
      if (!isBacktest) {
        logger.warn(`[${exchange.id}] サポートされていないタイムフレーム（事前チェック）: ${symbol} ${timeframe} - Discordエラー送信を防止`);
      }
      recordError(exchange.id, 'unsupported_timeframe_precheck', `${symbol} ${timeframe}`);
      return [];
    }
  }

  if (!isBacktest) {
    logger.info(`[標準API] fetchStandardHistoricalOHLCVData開始: ${exchange.id} ${symbol} ${timeframe} ${limit}`);
  }

  try {
    if (!isBacktest) {
      logger.info(`[標準API] ${exchange.id}のCCXT標準APIを使用`);
    }

    // 標準CCXT API呼び出し
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);

    if (!isBacktest) {
      logger.info(`[標準API] データ取得完了: ${ohlcv.length}件`);
    }

    return ohlcv;
  } catch (error) {
    const errorMessage = `fetchStandardHistoricalOHLCVDataエラー (${symbol} ${timeframe}): ${error.message}`;

    // デバッグ情報をログに出力
    if (!isBacktest) {
      logger.debug(`Error details for ${exchange.id} ${symbol} ${timeframe}:`);
      logger.debug(`error.message: ${error.message}`);
      logger.debug(`error.message includes '10000': ${error.message.includes('10000')}`);
    }

    // Bitbankのエラーコード10000（サポートされていないタイムフレーム）の場合
    if (exchange.id === 'bitbank' && (
      error.message.includes('10000') ||
        error.message.includes('"code":"10000"') ||
        (error.response && error.response.includes && error.response.includes('10000')) ||
        (typeof error.response === 'object' && error.response.data && error.response.data.code === '10000')
    )) {
      logger.warn(`[${exchange.id}] サポートされていないタイムフレーム: ${symbol} ${timeframe} - エラーコード10000 - Discordエラー送信をスキップ`);
      recordError(exchange.id, 'unsupported_timeframe', `${symbol} ${timeframe}`);
      return [];
    }

    // その他のエラーは通常通り処理
    logger.error(errorMessage, error);
    recordError(exchange.id, 'fetchOHLCV', error.message);

    // 重要：10000エラーは既にキャッチされているはずなので、ここに到達した場合はDiscord通知
    try {
      await postErrorToDiscord(errorMessage);
    } catch (discordError) {
      logger.error('Discord通知エラー:', discordError.message);
    }

    return [];
  }
}

/**
 * OHLCVデータ取得の共通関数
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} timeframe - 例: '15m'
 * @param {Number} limit - データ数
 * @returns {Promise<Array>} OHLCV配列
 */
async function fetchOHLCVDataAPI(exchange, symbol, timeframe = '15m', limit = 100) {
  const isBacktest = isBacktestMode();

  if (!isBacktest) {
    logger.debug(`fetchOHLCVDataAPI呼び出し: ${exchange.id} ${symbol} ${timeframe} ${limit}`);
    logger.debug(`exchange.id: ${exchange.id}, timeframe: ${timeframe}, mapping: ${TIMEFRAME_TO_CANDLE_TYPE[timeframe]}`);
  }

  // Bitbankの特定のtimeframeの場合は専用APIを使用（エラー時は標準APIにフォールバック）
  if (exchange.id === 'bitbank' && TIMEFRAME_TO_CANDLE_TYPE[timeframe]) {
    try {
      if (!isBacktest) {
        logger.debug('Bitbank専用API使用');
      }

      // シンボルをBitbank APIで使用する形式に変換（BTC/JPY → btc_jpy）
      const pair = symbol.toLowerCase().replace('/', '_');
      const candleType = TIMEFRAME_TO_CANDLE_TYPE[timeframe];

      const result = await fetchBitbankHistoricalOHLCVData(pair, candleType, limit);

      if (!isBacktest) {
        logger.info(`[BACKTEST] Bitbank専用API結果: ${result.length}件`);
      }

      return result;
    } catch (error) {
      // エラーコード10000（サポートされていないタイムフレーム）の場合
      if (error.message && error.message.includes('10000')) {
        logger.warn(`[BACKTEST] Bitbank専用API: ${symbol} ${timeframe} はサポートされていません、標準APIで試行`);
      } else {
        logger.error('[BACKTEST] Bitbank専用APIエラー、標準APIにフォールバック:', error.message);
      }
      return await fetchStandardHistoricalOHLCVData(exchange, symbol, timeframe, limit);
    }
  }
  // それ以外のケースは標準実装を使用
  else {
    if (!isBacktest) {
      logger.info('[BACKTEST] 標準API使用');
    }
    return await fetchStandardHistoricalOHLCVData(exchange, symbol, timeframe, limit);
  }
}

module.exports = {
  fetchOHLCVDataAPI,
  executeBitbankAPIWithRateLimit,
  waitForAPILimit
};