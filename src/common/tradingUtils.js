/**
 * 安全な取引ユーティリティ関数
 * Safe Trading Utility Functions
 *
 * これらの関数は戦略間で共通する安全なパターンを統合します
 * 核心的な取引実行ロジック（executeBuyOrder/executeSellOrder）は
 * 金融安全性のため意図的に保持されています
 */

/**
 * 設定パラメータを安全に抽出する
 * @param {Object} config - 設定オブジェクト
 * @param {Object} parameterMap - パラメータ名とデフォルト値のマッピング
 * @returns {Object} 抽出されたパラメータ
 */
function extractConfigParameters(config, parameterMap) {
  const extractedParams = {};

  // Handle null, undefined, or non-plain-object parameters safely
  if (!parameterMap || typeof parameterMap !== 'object' || Array.isArray(parameterMap)) {
    return extractedParams;
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    // If config is null/undefined/array, return default values
    for (const [key, defaultValue] of Object.entries(parameterMap)) {
      extractedParams[key] = defaultValue;
    }
    return extractedParams;
  }

  for (const [key, defaultValue] of Object.entries(parameterMap)) {
    extractedParams[key] = config[key] !== undefined ? config[key] : defaultValue;
  }

  return extractedParams;
}

/**
 * マーケットパラメータを安全に抽出する
 * @param {Object} marketParameters - マーケットパラメータオブジェクト
 * @param {Array} requiredFields - 必須フィールドリスト
 * @returns {Object} 抽出されたマーケットパラメータ
 */
function extractMarketParameters(marketParameters, requiredFields = []) {
  const extracted = {};

  // Handle null or undefined marketParameters safely
  if (!marketParameters) {
    return extracted;
  }

  requiredFields.forEach(field => {
    if (marketParameters[field] !== undefined) {
      extracted[field] = marketParameters[field];
    }
  });

  return extracted;
}

/**
 * シグナルタイプを決定する
 * @param {boolean} buySignal - 買いシグナル
 * @param {boolean} sellSignal - 売りシグナル
 * @returns {string} 'buy', 'sell', または 'none'
 */
function determineSignalType(buySignal, sellSignal) {
  return buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
}

/**
 * 戦略結果オブジェクトを作成する
 * @param {Object} baseData - 基本データ
 * @param {Object} specificData - 戦略固有データ
 * @returns {Object} 統合された戦略結果
 */
function createStrategyResults(baseData, specificData = {}) {
  return {
    ...baseData,
    ...specificData
  };
}

/**
 * 標準的なログフォーマットを作成する
 * @param {Object} signalResult - シグナル計算結果
 * @param {Object} messageTemplates - メッセージテンプレート {buy, sell, none}
 * @param {Function} dataExtractor - データ抽出関数
 * @returns {Object} フォーマットされたログ情報
 */
function createStandardLogFormat(signalResult, messageTemplates, dataExtractor) {
  const extractedData = dataExtractor(signalResult);

  return {
    buy: messageTemplates.buy(extractedData),
    sell: messageTemplates.sell(extractedData),
    none: messageTemplates.none(extractedData),
    orderInfo: extractedData,
    result: { ...extractedData, currentPrice: signalResult.currentPrice }
  };
}

/**
 * OHLCV データを取得して検証する（ラッパー関数）
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} ohlcvInterval - インターバル
 * @param {number} period - 期間
 * @param {string} strategyName - 戦略名
 * @param {Object} options - オプション
 * @returns {Promise<Object|null>} 検証済みデータまたはnull
 */
async function fetchAndValidateStrategyData(exchange, symbol, ohlcvInterval, period, strategyName, options = {}) {
  // 共通のfetchAndValidateOHLCVWithBacktestSetupを使用
  const { fetchAndValidateOHLCVWithBacktestSetup } = require('../strategies/utils/common');

  const validatedData = await fetchAndValidateOHLCVWithBacktestSetup(
    exchange, symbol, ohlcvInterval, period, strategyName, options
  );

  return validatedData;
}

/**
 * 数値を安全にフォーマットする
 * @param {number} value - フォーマットする値
 * @param {number} decimals - 小数点以下桁数
 * @returns {string} フォーマットされた文字列またはN/A
 */
function safeNumberFormat(value, decimals = 2) {
  return (value !== null && value !== undefined && !isNaN(value))
    ? value.toFixed(decimals)
    : 'N/A';
}

/**
 * パーセンテージを安全にフォーマットする
 * @param {number} value - パーセンテージ値
 * @param {number} decimals - 小数点以下桁数
 * @returns {string} フォーマットされた文字列
 */
function safePercentageFormat(value, decimals = 2) {
  const formatted = safeNumberFormat(value, decimals);
  return formatted === 'N/A' ? 'N/A' : `${formatted}%`;
}

/**
 * 戦略パラメータの妥当性を検証する
 * @param {Object} config - 設定オブジェクト
 * @param {Object} validationRules - バリデーションルール
 * @returns {Object} 検証結果 {isValid, errors}
 */
function validateStrategyConfig(config, validationRules) {
  const errors = [];

  for (const [param, rules] of Object.entries(validationRules)) {
    const value = config[param];

    if (rules.required && (value === undefined || value === null)) {
      errors.push(`${param} is required`);
      continue;
    }

    if (value !== undefined && value !== null) {
      if (rules.type && typeof value !== rules.type) {
        errors.push(`${param} must be of type ${rules.type}`);
      }

      if (rules.min !== undefined && value < rules.min) {
        errors.push(`${param} must be >= ${rules.min}`);
      }

      if (rules.max !== undefined && value > rules.max) {
        errors.push(`${param} must be <= ${rules.max}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * 閾値との比較結果を取得する
 * @param {number} value - 比較する値
 * @param {number} lowerThreshold - 下限閾値
 * @param {number} upperThreshold - 上限閾値
 * @returns {Object} 比較結果 {isAboveUpper, isBelowLower, isWithinRange}
 */
function compareWithThresholds(value, lowerThreshold, upperThreshold) {
  return {
    isAboveUpper: value > upperThreshold,
    isBelowLower: value < lowerThreshold,
    isWithinRange: value >= lowerThreshold && value <= upperThreshold,
    value,
    lowerThreshold,
    upperThreshold
  };
}

module.exports = {
  extractConfigParameters,
  extractMarketParameters,
  determineSignalType,
  createStrategyResults,
  createStandardLogFormat,
  fetchAndValidateStrategyData,
  safeNumberFormat,
  safePercentageFormat,
  validateStrategyConfig,
  compareWithThresholds
};