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
  RATE_LIMIT_EXCEEDED: '50429',    // レート制限超過
};

/**
 * bitbank APIエラーを堅牢に判定する関数
 * 文字列検索の脆弱性を回避し、複数の方法でエラーを特定
 * @param {Error} error - CCXTエラーオブジェクト
 * @param {string} targetCode - 対象エラーコード
 * @returns {boolean} エラーコードが一致するかどうか
 */
function isBitbankError(error, targetCode) {
  if (!error) return false;
  
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
  
  // 方法3: 文字列検索（フォールバック、後方互換性のため）
  if (error.message && error.message.includes(`code":"${targetCode}"`)) {
    return true;
  }
  
  return false;
}

// bitflyer APIエラーコード（将来的に追加予定）
const BITFLYER_ERRORS = {
  // TODO: bitflyerのエラーコードを追加
};

module.exports = {
  BITBANK_ERRORS,
  BITFLYER_ERRORS,
  isBitbankError,
};