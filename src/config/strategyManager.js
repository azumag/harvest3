/**
 * 戦略設定管理モジュール
 * 戦略設定の統一化と一元管理を提供
 */
const { getStrategyParametersRedis, saveStrategyParametersRedis } = require('../database/redisDatabase');

/**
 * 戦略設定を統一化して取得する関数
 * 信頼できる単一ソースとして機能
 * @param {Object} config - config.js からの設定オブジェクト
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {Promise<Object|null>} 統一化された戦略設定またはnull
 */
async function getUnifiedStrategyConfig(config, exchangeId, symbol, strategyKey) {
  try {
    // config.js からデフォルト設定を取得
    const defaultConfig = config.strategies[strategyKey];

    if (!defaultConfig) {
      console.warn(`戦略 ${strategyKey} の設定が config.js に存在しません`);
      return null;
    }

    // データベースから個別設定を取得
    const dbParams = await getStrategyParametersRedis(exchangeId, symbol, strategyKey);

    // 統一化された設定を作成
    const unifiedConfig = {
      ...config.global,
      ...defaultConfig,
      ...(dbParams || {})
    };

    // enabled フィールドの統一化
    // 優先順位: データベース設定 > config.js設定 > false(デフォルト)
    unifiedConfig.enabled = dbParams?.enabled ?? defaultConfig.enabled ?? false;

    return unifiedConfig;
  } catch (error) {
    console.error(`戦略設定の統一化中にエラーが発生しました: ${strategyKey}`, error);
    return null;
  }
}

/**
 * 戦略設定を保存する関数
 * 信頼できる単一ソースとして機能
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @param {Object} params - 保存するパラメータ
 * @returns {Promise<boolean>} 保存成功/失敗
 */
async function saveUnifiedStrategyConfig(exchangeId, symbol, strategyKey, params) {
  try {
    // enabled フィールドの検証
    if (params.enabled !== undefined && typeof params.enabled !== 'boolean') {
      throw new Error('enabled フィールドはboolean型である必要があります');
    }

    // 関数やexchangesプロパティを除去
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([key, value]) =>
        typeof value !== 'function' && key !== 'exchanges'
      )
    );

    await saveStrategyParametersRedis(exchangeId, symbol, strategyKey, cleanParams);
    console.log(`戦略設定を保存しました: ${strategyKey} (${exchangeId}:${symbol})`);
    return true;
  } catch (error) {
    console.error(`戦略設定の保存中にエラーが発生しました: ${strategyKey}`, error);
    return false;
  }
}

/**
 * 戦略を有効化する関数
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {Promise<boolean>} 有効化成功/失敗
 */
async function enableStrategy(exchangeId, symbol, strategyKey) {
  try {
    const currentParams = await getStrategyParametersRedis(exchangeId, symbol, strategyKey) || {};
    currentParams.enabled = true;

    const success = await saveUnifiedStrategyConfig(exchangeId, symbol, strategyKey, currentParams);
    if (success) {
      console.log(`戦略を有効化しました: ${strategyKey} (${exchangeId}:${symbol})`);
    }
    return success;
  } catch (error) {
    console.error(`戦略の有効化中にエラーが発生しました: ${strategyKey}`, error);
    return false;
  }
}

/**
 * 戦略を無効化する関数（権限チェック付き）
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @param {Object} config - 設定オブジェクト
 * @param {boolean} isBacktestParameterUpdate - バックテストのパラメータ更新による無効化かどうか
 * @returns {Promise<boolean>} 無効化成功/失敗
 */
async function disableStrategy(exchangeId, symbol, strategyKey, config = null, isBacktestParameterUpdate = false) {
  try {
    // 設定が提供されている場合は権限チェックを実行
    if (config) {
      const invalidationConfig = config.global?.backtest?.strategyInvalidation;
      if (invalidationConfig) {
        // 手動無効化が禁止されている場合
        if (!invalidationConfig.allowManualDisable && !isBacktestParameterUpdate) {
          console.log(`戦略 ${strategyKey} の手動無効化は禁止されています`);
          return false;
        }
        // バックテストパラメータ更新による無効化が禁止されている場合
        if (!invalidationConfig.allowBacktestParameterDisable && isBacktestParameterUpdate) {
          console.log(`戦略 ${strategyKey} のバックテストパラメータ更新による無効化は禁止されています`);
          return false;
        }
      }
    }

    const currentParams = await getStrategyParametersRedis(exchangeId, symbol, strategyKey) || {};
    currentParams.enabled = false;

    const success = await saveUnifiedStrategyConfig(exchangeId, symbol, strategyKey, currentParams);
    if (success) {
      const reason = isBacktestParameterUpdate ? '(バックテストパラメータ更新)' : '(手動)';
      console.log(`戦略を無効化しました: ${strategyKey} (${exchangeId}:${symbol}) ${reason}`);
    }
    return success;
  } catch (error) {
    console.error(`戦略の無効化中にエラーが発生しました: ${strategyKey}`, error);
    return false;
  }
}

/**
 * 戦略を無効化する関数（後方互換性のため）
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {Promise<boolean>} 無効化成功/失敗
 */
async function disableStrategyLegacy(exchangeId, symbol, strategyKey) {
  try {
    const currentParams = await getStrategyParametersRedis(exchangeId, symbol, strategyKey) || {};
    currentParams.enabled = false;

    const success = await saveUnifiedStrategyConfig(exchangeId, symbol, strategyKey, currentParams);
    if (success) {
      console.log(`戦略を無効化しました: ${strategyKey} (${exchangeId}:${symbol})`);
    }
    return success;
  } catch (error) {
    console.error(`戦略の無効化中にエラーが発生しました: ${strategyKey}`, error);
    return false;
  }
}

/**
 * 戦略の有効性を確認する関数
 * @param {Object} config - config.js からの設定オブジェクト
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {Promise<boolean>} 戦略が有効かどうか
 */
async function isStrategyEnabled(config, exchangeId, symbol, strategyKey) {
  try {
    const unifiedConfig = await getUnifiedStrategyConfig(config, exchangeId, symbol, strategyKey);
    return unifiedConfig?.enabled ?? false;
  } catch (error) {
    console.error(`戦略の有効性確認中にエラーが発生しました: ${strategyKey}`, error);
    return false;
  }
}

module.exports = {
  getUnifiedStrategyConfig,
  saveUnifiedStrategyConfig,
  enableStrategy,
  disableStrategy,
  disableStrategyLegacy,
  isStrategyEnabled
};