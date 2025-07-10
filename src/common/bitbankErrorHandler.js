/**
 * Bitbank API エラーハンドラー
 * エラーコード10009, 20001等の統一的な処理を提供
 */

const { BITBANK_ERRORS, isBitbankError } = require('./exchangeErrors');

/**
 * Bitbank APIエラーかどうかを判定
 * @param {string} exchangeId - 取引所ID
 * @returns {boolean} bitbankかどうか
 */
function isBitbankExchange(exchangeId) {
  return exchangeId === 'bitbank';
}

/**
 * Bitbank固有のエラーハンドリングを実行
 * @param {Error} error - エラーオブジェクト
 * @param {string} exchangeId - 取引所ID
 * @param {string} operation - 操作名 (fetchBalance, fetchMyTrades, etc.)
 * @param {string} symbol - 通貨ペア (オプション)
 * @returns {Object} { shouldRetry, shouldIgnore, fallbackResult }
 */
function handleBitbankError(error, exchangeId, operation, symbol = '') {
  // Bitbank以外は処理しない
  if (!isBitbankExchange(exchangeId)) {
    return {
      shouldRetry: false,
      shouldIgnore: false,
      fallbackResult: null,
      handled: false
    };
  }

  const contextInfo = symbol ? `${operation} ${symbol}` : operation;
  const errorMessage = error.message || '';

  // エラーコード10009 (システムエラー) の処理
  if (isBitbankError(error, BITBANK_ERRORS.SYSTEM_ERROR)) {
    console.warn(`[BitbankErrorHandler] システムエラー: ${exchangeId} ${contextInfo} - エラーコード10009`);
    return {
      shouldRetry: false,
      shouldIgnore: true,
      fallbackResult: getFallbackResult(operation),
      handled: true,
      errorCode: '10009'
    };
  }

  // エラーコード20001 (認証エラー) の処理
  if (isBitbankError(error, BITBANK_ERRORS.AUTHENTICATION_ERROR)) {
    console.warn(`[BitbankErrorHandler] 認証エラー: ${exchangeId} ${contextInfo} - エラーコード20001`);
    return {
      shouldRetry: false,
      shouldIgnore: true,
      fallbackResult: getFallbackResult(operation),
      handled: true,
      errorCode: '20001'
    };
  }

  // 文字列ベースの認証エラーチェック（CCXTラッパー経由）
  if (errorMessage.includes('authentication') || errorMessage.includes('auth')) {
    console.warn(`[BitbankErrorHandler] 認証エラー: ${exchangeId} ${contextInfo} - ${errorMessage}`);
    return {
      shouldRetry: false,
      shouldIgnore: true,
      fallbackResult: getFallbackResult(operation),
      handled: true,
      errorCode: 'auth_generic'
    };
  }

  // サポートされていないメソッドの処理
  if (errorMessage.includes('not supported')) {
    console.warn(`[BitbankErrorHandler] サポートされていないメソッド: ${exchangeId} ${contextInfo}`);
    return {
      shouldRetry: false,
      shouldIgnore: true,
      fallbackResult: getFallbackResult(operation),
      handled: true,
      errorCode: 'not_supported'
    };
  }

  // レート制限エラーの処理
  if (isBitbankError(error, BITBANK_ERRORS.RATE_LIMIT_EXCEEDED) || 
      errorMessage.includes('rate limit') || 
      errorMessage.includes('429')) {
    console.warn(`[BitbankErrorHandler] レート制限エラー: ${exchangeId} ${contextInfo}`);
    return {
      shouldRetry: true,
      shouldIgnore: false,
      fallbackResult: null,
      handled: true,
      errorCode: '50429',
      retryDelay: 1000 // 1秒待機
    };
  }

  // 残高不足エラーの処理
  if (isBitbankError(error, BITBANK_ERRORS.INSUFFICIENT_FUNDS)) {
    console.warn(`[BitbankErrorHandler] 残高不足エラー: ${exchangeId} ${contextInfo}`);
    return {
      shouldRetry: false,
      shouldIgnore: false,
      fallbackResult: null,
      handled: true,
      errorCode: '20003'
    };
  }

  // その他のエラーは処理しない
  return {
    shouldRetry: false,
    shouldIgnore: false,
    fallbackResult: null,
    handled: false
  };
}

/**
 * 操作別のフォールバック結果を取得
 * @param {string} operation - 操作名
 * @returns {*} フォールバック結果
 */
function getFallbackResult(operation) {
  switch (operation) {
    case 'fetchBalance':
      return { total: {}, free: {}, used: {} };
    
    case 'fetchMyTrades':
      return [];
    
    case 'fetchOrders':
      return [];
    
    case 'fetchOrder':
      return null;
    
    case 'fetchTicker':
      return null;
    
    case 'fetchOHLCV':
      return [];
    
    default:
      return null;
  }
}

/**
 * Bitbank APIエラーを堅牢に処理するラッパー関数
 * @param {Function} apiCall - API呼び出し関数
 * @param {string} exchangeId - 取引所ID
 * @param {string} operation - 操作名
 * @param {string} symbol - 通貨ペア (オプション)
 * @returns {Promise<*>} API結果またはフォールバック結果
 */
async function withBitbankErrorHandling(apiCall, exchangeId, operation, symbol = '') {
  try {
    return await apiCall();
  } catch (error) {
    const result = handleBitbankError(error, exchangeId, operation, symbol);
    
    if (result.handled) {
      if (result.shouldRetry && result.retryDelay) {
        console.log(`[BitbankErrorHandler] ${result.retryDelay}ms後にリトライします...`);
        await new Promise(resolve => setTimeout(resolve, result.retryDelay));
        
        // リトライ実行
        try {
          return await apiCall();
        } catch (retryError) {
          console.error(`[BitbankErrorHandler] リトライも失敗: ${retryError.message}`);
          const retryResult = handleBitbankError(retryError, exchangeId, operation, symbol);
          if (retryResult.shouldIgnore) {
            return retryResult.fallbackResult;
          }
          throw retryError;
        }
      }
      
      if (result.shouldIgnore) {
        return result.fallbackResult;
      }
    }
    
    // 処理されなかったエラーは再スロー
    throw error;
  }
}

module.exports = {
  isBitbankExchange,
  handleBitbankError,
  withBitbankErrorHandling,
  getFallbackResult
};