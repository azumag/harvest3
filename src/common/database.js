/**
 * データベース操作の共通化ライブラリ
 * Redis/MongoDB操作の統一アクセス層とキャッシュ戦略を提供
 */

const { handleStrategyError, executeWithRetry } = require('./utils');

/**
 * 共通キー生成関数（Redis用）
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} keyType - キーの種類 (params, signal, position, etc.)
 * @param {string} [suffix] - 追加のサフィックス
 * @returns {string} 生成されたキー
 */
function generateRedisKey(exchangeId, symbol, keyType, suffix = '') {
  const baseKey = `${keyType}:${exchangeId}:${symbol}`;
  return suffix ? `${baseKey}:${suffix}` : baseKey;
}

/**
 * 安全なJSON解析
 * @param {string} jsonString - JSON文字列
 * @param {any} defaultValue - デフォルト値
 * @returns {any} パース結果またはデフォルト値
 */
function safeJsonParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn(`JSON解析に失敗: ${error.message}`);
    return defaultValue;
  }
}

/**
 * パラメータ値の安全な変換
 * @param {any} value - 変換する値
 * @returns {any} 変換された値
 */
function parseParamValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  
  if (typeof value === 'string') {
    // 数値として解析を試行
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      return numValue;
    }
    
    // ブール値として解析を試行
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  
  return value;
}

/**
 * Redis操作の共通エラーハンドリング
 * @param {Function} operation - Redis操作関数
 * @param {string} context - エラーコンテキスト
 * @param {any} defaultValue - エラー時のデフォルト値
 * @returns {Promise<any>} 操作結果またはデフォルト値
 */
async function safeRedisOperation(operation, context, defaultValue = null) {
  try {
    return await executeWithRetry(operation, 3, 500, context);
  } catch (error) {
    await handleStrategyError(error, 'Redis操作', context, '', false);
    return defaultValue;
  }
}

/**
 * MongoDB操作の共通エラーハンドリング
 * @param {Function} operation - MongoDB操作関数
 * @param {string} context - エラーコンテキスト
 * @param {any} defaultValue - エラー時のデフォルト値
 * @returns {Promise<any>} 操作結果またはデフォルト値
 */
async function safeMongoOperation(operation, context, defaultValue = null) {
  try {
    return await executeWithRetry(operation, 3, 1000, context);
  } catch (error) {
    await handleStrategyError(error, 'MongoDB操作', context, '', false);
    return defaultValue;
  }
}

/**
 * バッチ処理の共通実装
 * @param {Array} items - 処理対象のアイテム配列
 * @param {Function} processor - 各アイテムを処理する関数
 * @param {number} batchSize - バッチサイズ
 * @param {number} delayMs - バッチ間の待機時間
 * @param {string} context - コンテキスト
 * @returns {Promise<Array>} 処理結果の配列
 */
async function processBatch(items, processor, batchSize = 100, delayMs = 100, context = 'batch') {
  const results = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    try {
      const batchResults = await Promise.all(
        batch.map(item => processor(item))
      );
      results.push(...batchResults);
      
      // バッチ間の待機
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      await handleStrategyError(error, 'バッチ処理', context, '', false);
      // エラーが発生しても処理を継続（個別アイテムでリトライ）
      for (const item of batch) {
        try {
          const result = await processor(item);
          results.push(result);
        } catch (itemError) {
          console.warn(`[${context}] 個別アイテム処理失敗:`, itemError.message);
          results.push(null); // 失敗したアイテムにはnullを追加
        }
      }
    }
  }
  
  return results;
}

/**
 * データベース接続の健全性チェック
 * @param {Object} client - データベースクライアント
 * @param {string} dbType - データベースタイプ ('redis' | 'mongodb')
 * @returns {Promise<boolean>} 接続状態
 */
async function checkConnection(client, dbType) {
  try {
    if (dbType === 'redis') {
      await client.ping();
      return true;
    } else if (dbType === 'mongodb') {
      await client.admin().ping();
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`[${dbType}] 接続チェック失敗:`, error.message);
    return false;
  }
}

/**
 * タイムスタンプ生成ユーティリティ
 * @param {Date} [date] - 基準日時（省略時は現在時刻）
 * @returns {Object} 各種フォーマットのタイムスタンプ
 */
function generateTimestamps(date = new Date()) {
  return {
    unix: Math.floor(date.getTime() / 1000),
    unixMs: date.getTime(),
    iso: date.toISOString(),
    local: date.toLocaleString('ja-JP'),
    date: date
  };
}

/**
 * レート制限対応の実行制御
 * @param {Function} operation - 実行する操作
 * @param {number} rateLimit - レート制限（操作/秒）
 * @param {string} context - コンテキスト
 * @returns {Promise<any>} 操作結果
 */
async function executeWithRateLimit(operation, rateLimit = 10, context = 'operation') {
  const minInterval = 1000 / rateLimit; // ミリ秒
  const startTime = Date.now();
  
  try {
    const result = await operation();
    
    const elapsed = Date.now() - startTime;
    const remainingDelay = minInterval - elapsed;
    
    if (remainingDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingDelay));
    }
    
    return result;
  } catch (error) {
    await handleStrategyError(error, 'レート制限実行', context, '', true);
  }
}

/**
 * データ検証とサニタイゼーション
 * @param {any} data - 検証対象データ
 * @param {Object} schema - 検証スキーマ
 * @param {string} context - コンテキスト
 * @returns {Object} 検証とサニタイズされたデータ
 */
function validateAndSanitizeData(data, schema, context = 'data') {
  const sanitized = {};
  const errors = [];
  
  for (const [key, rules] of Object.entries(schema)) {
    const value = data[key];
    
    // 必須チェック
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`${key} is required`);
      continue;
    }
    
    // 値が存在しない場合のデフォルト値設定
    if (value === undefined || value === null) {
      if (rules.default !== undefined) {
        sanitized[key] = rules.default;
      }
      continue;
    }
    
    // 型チェックと変換
    if (rules.type === 'number') {
      const numValue = parseFloat(value);
      if (isNaN(numValue)) {
        errors.push(`${key} must be a number`);
        continue;
      }
      sanitized[key] = numValue;
    } else if (rules.type === 'string') {
      sanitized[key] = String(value);
    } else if (rules.type === 'boolean') {
      sanitized[key] = Boolean(value);
    } else {
      sanitized[key] = value;
    }
    
    // 範囲チェック
    if (rules.min !== undefined && sanitized[key] < rules.min) {
      errors.push(`${key} must be >= ${rules.min}`);
    }
    if (rules.max !== undefined && sanitized[key] > rules.max) {
      errors.push(`${key} must be <= ${rules.max}`);
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`[${context}] データ検証エラー: ${errors.join(', ')}`);
  }
  
  return sanitized;
}

module.exports = {
  generateRedisKey,
  safeJsonParse,
  parseParamValue,
  safeRedisOperation,
  safeMongoOperation,
  processBatch,
  checkConnection,
  generateTimestamps,
  executeWithRateLimit,
  validateAndSanitizeData
};