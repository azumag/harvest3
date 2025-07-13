/**
 * 取引所APIエラーコード定数定義
 * マジックナンバーの排除とエラー処理の一貫性向上のため
 */

// bitbank APIエラーコード
const BITBANK_ERRORS = {
  SYSTEM_ERROR: '10009',           // システムエラー（シンボル無効等）
  AUTHENTICATION_ERROR: '20001',   // 認証エラー
  INSUFFICIENT_FUNDS: '20003',     // 残高不足
  INVALID_PARAMETER: '30001',      // パラメータ無効
  MARKET_CLOSED: '40001',          // 市場クローズ
  ORDER_NOT_FOUND: '40404',        // 注文が見つからない
  RATE_LIMIT_EXCEEDED: '50429'    // レート制限超過
};

/**
 * bitbank APIエラーを堅牢に判定する関数
 * 文字列検索の脆弱性を回避し、複数の方法でエラーを特定
 * @param {Error} error - CCXTエラーオブジェクト
 * @param {string} targetCode - 対象エラーコード
 * @returns {boolean} エラーコードが一致するかどうか
 */
function isBitbankError(error, targetCode) {
  if (!error) {
    return false;
  }

  // 方法1: CCXTのcodeプロパティを直接確認（最も堅牢）
  if (error.code === targetCode) {
    return true;
  }

  // 方法2: JSONパースしてエラーコードを抽出（APIレスポンス解析）
  try {
    if (error.message) {
      const jsonMatch = error.message.match(/\{.*\}/);
      if (jsonMatch) {
        const errorData = JSON.parse(jsonMatch[0]);
        if (errorData.data && errorData.data.code === parseInt(targetCode)) {
          return true;
        }
      }
    }
  } catch (parseError) {
    // JSON解析に失敗した場合は次の方法へ
  }

  // 方法3: エラーメッセージ内での基本的な文字列検索
  if (error.message && error.message.includes(targetCode)) {
    return true;
  }

  // 方法4: レスポンスボディでのエラーコード確認
  if (error.response && error.response.error && error.response.error.includes(targetCode)) {
    return true;
  }

  // 方法5: 従来の詳細JSON形式の文字列検索（後方互換性のため）
  if (error.message && error.message.includes(`code":"${targetCode}"`)) {
    return true;
  }

  return false;
}

// bitflyer APIエラーコード
const BITFLYER_ERRORS = {
  // 一般的なエラー
  INVALID_API_KEY: 'INVALID_API_KEY',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE', 
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_NONCE: 'INVALID_NONCE',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_FIELD_FORMAT: 'INVALID_FIELD_FORMAT',
  INVALID_FIELD_VALUE: 'INVALID_FIELD_VALUE',
  
  // 注文関連エラー
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_TIMEOUT: 'ORDER_TIMEOUT',
  CANCEL_TIMEOUT: 'CANCEL_TIMEOUT',
  INVALID_SIZE: 'INVALID_SIZE',
  INVALID_PRICE: 'INVALID_PRICE',
  INVALID_PRODUCT_CODE: 'INVALID_PRODUCT_CODE',
  INVALID_SIDE: 'INVALID_SIDE',
  INVALID_ORDER_TYPE: 'INVALID_ORDER_TYPE',
  INVALID_TIME_IN_FORCE: 'INVALID_TIME_IN_FORCE',
  
  // 残高・資金関連エラー
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INSUFFICIENT_MARGIN: 'INSUFFICIENT_MARGIN',
  EXCEED_MAX_POSITION_SIZE: 'EXCEED_MAX_POSITION_SIZE',
  TRADING_RESTRICTED: 'TRADING_RESTRICTED',
  
  // システム・レート制限エラー
  SYSTEM_BUSY: 'SYSTEM_BUSY',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  MAINTENANCE: 'MAINTENANCE',
  
  // 市場関連エラー
  MARKET_CLOSED: 'MARKET_CLOSED',
  TRADE_SUSPENDED: 'TRADE_SUSPENDED',
  PRICE_LIMIT: 'PRICE_LIMIT'
};

/**
 * bitflyer APIエラーを堅牢に判定する関数
 * @param {Error} error - CCXTエラーオブジェクト
 * @param {string} targetCode - 対象エラーコード
 * @returns {boolean} エラーコードが一致するかどうか
 */
function isBitflyerError(error, targetCode) {
  if (!error) {
    return false;
  }

  // エラーメッセージ内での文字列検索
  const errorMessage = error.message || '';
  const lowerMessage = errorMessage.toLowerCase();
  const lowerTarget = targetCode.toLowerCase();

  // 直接的な文字列マッチング
  if (lowerMessage.includes(lowerTarget)) {
    return true;
  }

  // CCXTのHTTPエラーコード確認
  if (error.code && error.code.toString() === targetCode) {
    return true;
  }

  // レスポンスボディ内のエラーコード確認
  if (error.response && error.response.error && error.response.error.includes(targetCode)) {
    return true;
  }

  return false;
}

module.exports = {
  BITBANK_ERRORS,
  BITFLYER_ERRORS,
  isBitbankError,
  isBitflyerError
};