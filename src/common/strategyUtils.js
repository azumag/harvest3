/**
 * 戦略関連のユーティリティ関数
 * 戦略の型チェック、フィルタリングなどの共通処理を提供
 */

const { config: defaultConfig } = require('../config');

/**
 * 残高チェック対象の戦略を取得する
 * @param {Object} config - 設定オブジェクト（テスト用にオプショナル）
 * @param {Object} options - フィルタリングオプション
 * @param {Array<string>} options.types - 対象とする戦略タイプの配列
 * @returns {Array<string>} 残高チェック対象の戦略キーの配列
 */
function getBalanceCheckEligibleStrategies(config = defaultConfig, options = {}) {
  // configやstrategiesがnullの場合は空配列を返す
  if (!config || !config.strategies) {
    return [];
  }
  
  const strategies = config.strategies;
  const eligibleStrategies = [];

  // 高頻度取引戦略は自動的に除外（type-based filtering）
  const excludedTypes = ['high_frequency'];

  for (const [strategyKey, strategy] of Object.entries(strategies)) {
    // 基本条件のチェック
    if (!strategy.enabled) continue;

    // 型による除外チェック（pure type-based filtering）
    if (excludedTypes.includes(strategy.type)) continue;

    // オプションで指定された型フィルタリング
    if (options.types && options.types.length > 0) {
      if (!options.types.includes(strategy.type)) continue;
    }

    eligibleStrategies.push(strategyKey);
  }

  return eligibleStrategies;
}

/**
 * 指定した型の戦略を取得する
 * @param {Object} config - 設定オブジェクト
 * @param {string} type - 戦略タイプ
 * @returns {Object} 指定した型の戦略（キーと値のペア）
 */
function getStrategiesByType(config = defaultConfig, type) {
  const strategies = config.strategies || {};
  const filteredStrategies = {};

  for (const [key, strategy] of Object.entries(strategies)) {
    if (strategy.type === type) {
      filteredStrategies[key] = strategy;
    }
  }

  return filteredStrategies;
}

/**
 * 有効な戦略のみを取得する
 * @param {Object} config - 設定オブジェクト
 * @returns {Object} 有効な戦略（キーと値のペア）
 */
function getEnabledStrategies(config = defaultConfig) {
  const strategies = config.strategies || {};
  const enabledStrategies = {};

  for (const [key, strategy] of Object.entries(strategies)) {
    if (strategy.enabled) {
      enabledStrategies[key] = strategy;
    }
  }

  return enabledStrategies;
}

/**
 * 戦略が特定の機能を持っているかチェック
 * @param {Object} strategy - 戦略オブジェクト
 * @param {string} feature - チェックする機能名（例: 'enableRiskManagement', 'enableBalanceCheck'）
 * @returns {boolean} 機能が有効かどうか
 */
function hasFeature(strategy, feature) {
  return strategy && strategy[feature] === true;
}

module.exports = {
  getBalanceCheckEligibleStrategies,
  getStrategiesByType,
  getEnabledStrategies,
  hasFeature
};