/**
 * エラー統計API コントローラー
 */

// エラー統計を保存するメモリストレージ（本番環境ではRedisに移行推奨）
let errorStats = {
  bitbankApiErrors: 0,
  ohlcvQueueErrors: 0,
  generalErrors: 0,
  lastErrors: [], // 最新のエラー10件
  startTime: Date.now()
};

/**
 * エラーを記録する関数
 * @param {string} type - エラータイプ
 * @param {string} message - エラーメッセージ
 * @param {string} details - エラー詳細
 */
function recordError(type, message, details = '') {
  const errorRecord = {
    type,
    message,
    details,
    timestamp: Date.now(),
    datetime: new Date().toISOString()
  };

  // エラータイプ別カウント
  switch (type) {
  case 'bitbank_api':
    errorStats.bitbankApiErrors++;
    break;
  case 'ohlcv_queue':
    errorStats.ohlcvQueueErrors++;
    break;
  default:
    errorStats.generalErrors++;
  }

  // 最新エラーリストに追加（最大10件）
  errorStats.lastErrors.unshift(errorRecord);
  if (errorStats.lastErrors.length > 10) {
    errorStats.lastErrors = errorStats.lastErrors.slice(0, 10);
  }

  console.log(`[ErrorStats] ${type}エラーを記録: ${message}`);
}

/**
 * エラー統計情報を取得するAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getErrorStats(req, res) {
  try {
    const uptime = Date.now() - errorStats.startTime;
    const uptimeHours = uptime / (1000 * 60 * 60);

    // エラー率を計算
    const totalErrors = errorStats.bitbankApiErrors + errorStats.ohlcvQueueErrors + errorStats.generalErrors;
    const errorRatePerHour = uptimeHours > 0 ? totalErrors / uptimeHours : 0;

    res.json({
      stats: {
        ...errorStats,
        totalErrors,
        uptime,
        uptimeHours: Math.round(uptimeHours * 100) / 100,
        errorRatePerHour: Math.round(errorRatePerHour * 100) / 100
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching error stats:', error);
    res.status(500).json({
      error: 'Failed to fetch error stats',
      message: error.message
    });
  }
}

/**
 * エラー統計をリセットするAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function resetErrorStats(req, res) {
  try {
    errorStats = {
      bitbankApiErrors: 0,
      ohlcvQueueErrors: 0,
      generalErrors: 0,
      lastErrors: [],
      startTime: Date.now()
    };

    res.json({
      message: 'Error stats reset successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error resetting error stats:', error);
    res.status(500).json({
      error: 'Failed to reset error stats',
      message: error.message
    });
  }
}

module.exports = {
  getErrorStats,
  resetErrorStats,
  recordError
};