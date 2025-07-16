/**
 * 残高チェッカー設定
 * geminiレビュー指摘対応：ハードコーディング問題の解決
 */

const BALANCE_CHECKER_CONFIG = {
  // 残高比較の閾値設定
  thresholds: {
    significantBalance: 0.00001,     // 有意な残高とする最小値
    highDiscrepancyPercent: 10,      // 高度不整合とする閾値（パーセント）
    balanceComparisonTolerance: 2,   // 残高比較の許容誤差（パーセント、デフォルト2%）
    externalTradeThreshold: 50,      // 外部取引と判定する閾値（パーセント）
    veryHighExternalTradeThreshold: 90, // 明らかな外部取引と判定する閾値（パーセント）
    // 通貨別の許容誤差設定（パーセント）
    currencySpecificTolerance: {
      // 例: BTC: 0.5,    // 高精度通貨（手数料が低い）
      // 例: ETH: 1.0,    // 主要アルトコイン
      // 例: MANA: 5.0,   // ボラティリティ高い通貨
      // 例: SHIB: 10.0,  // 極小価格通貨（精度の問題）
    }
  },

  // 分散ロック設定
  distributedLock: {
    lockKeyPrefix: 'balance_checker_lock',
    stateKey: 'balance_checker_state',
    defaultTtl: 300000,              // 5分（ミリ秒）
    maxRetryAttempts: 3,
    retryDelay: 1000                 // 1秒
  },

  // 定期実行設定
  intervals: {
    lightweightCheck: 5 * 60 * 1000,   // 5分間隔（軽量チェック）
    robustCheck: 60 * 60 * 1000,       // 1時間間隔（堅牢チェック）
    exchangeCheckDelay: 2000            // 取引所間チェック間隔（2秒）
  },

  // 通知設定
  notifications: {
    maxCurrenciesToShow: 5,             // Discord通知で表示する最大通貨数
    maxInconsistenciesToShow: 3,        // 表示する最大内部不整合数
    enableRecoveryNotification: true    // 回復時通知の有効化
  },

  // 戦略関連設定
  strategies: {
    // 戦略取得方法の設定
    dynamicStrategyLoading: true,       // 動的戦略読み込みの有効化
    includeDisabledStrategies: true     // 無効化された戦略も含める
    // 注意: additionalStrategies と enableBalanceCheck は廃止
    // 新アプローチ: strategy.type による自動フィルタリング
    // - type: 'high_frequency' の戦略は自動的に残高チェックから除外
    // - その他のtype（または未定義）の戦略は自動的に残高チェック対象
  },

  // データソース設定
  dataSources: {
    enableMongoDbComparison: true,      // MongoDB履歴との比較
    enableRedisSummaryComparison: true, // Redisサマリーとの比較
    enablePositionComparison: true,     // ポジションデータとの比較

    // データソース優先度（エラー時のフォールバック順）
    fallbackPriority: ['exchange', 'mongodb', 'redisSummary', 'redisPositions']
  },

  // デバッグ設定
  debug: {
    enableDetailedLogging: false,       // 詳細ログの有効化
    logDataSnapshots: false,            // データスナップショットのログ出力
    enablePerformanceMetrics: false     // パフォーマンス測定の有効化
  }
};

/**
 * 環境変数からの設定オーバーライド
 */
function getBalanceCheckerConfig() {
  const config = { ...BALANCE_CHECKER_CONFIG };

  // 環境変数による設定のオーバーライド
  if (process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD) {
    config.thresholds.significantBalance = parseFloat(process.env.BALANCE_CHECKER_SIGNIFICANT_THRESHOLD);
  }

  if (process.env.BALANCE_CHECKER_HIGH_DISCREPANCY_PERCENT) {
    config.thresholds.highDiscrepancyPercent = parseInt(process.env.BALANCE_CHECKER_HIGH_DISCREPANCY_PERCENT);
  }

  if (process.env.BALANCE_CHECKER_TOLERANCE_PERCENT) {
    config.thresholds.balanceComparisonTolerance = parseFloat(process.env.BALANCE_CHECKER_TOLERANCE_PERCENT);
  }

  if (process.env.BALANCE_CHECKER_EXTERNAL_TRADE_THRESHOLD) {
    config.thresholds.externalTradeThreshold = parseFloat(process.env.BALANCE_CHECKER_EXTERNAL_TRADE_THRESHOLD);
  }

  if (process.env.BALANCE_CHECKER_VERY_HIGH_EXTERNAL_THRESHOLD) {
    config.thresholds.veryHighExternalTradeThreshold = parseFloat(process.env.BALANCE_CHECKER_VERY_HIGH_EXTERNAL_THRESHOLD);
  }

  if (process.env.BALANCE_CHECKER_LOCK_TTL) {
    config.distributedLock.defaultTtl = parseInt(process.env.BALANCE_CHECKER_LOCK_TTL);
  }

  if (process.env.BALANCE_CHECKER_LIGHTWEIGHT_INTERVAL) {
    config.intervals.lightweightCheck = parseInt(process.env.BALANCE_CHECKER_LIGHTWEIGHT_INTERVAL);
  }

  if (process.env.BALANCE_CHECKER_ROBUST_INTERVAL) {
    config.intervals.robustCheck = parseInt(process.env.BALANCE_CHECKER_ROBUST_INTERVAL);
  }

  // デバッグ設定
  if (process.env.BALANCE_CHECKER_DEBUG === 'true') {
    config.debug.enableDetailedLogging = true;
    config.debug.logDataSnapshots = true;
    config.debug.enablePerformanceMetrics = true;
  }

  return config;
}

/**
 * 設定の妥当性検証
 */
function validateConfig(config) {
  const errors = [];

  if (config.thresholds.significantBalance < 0) {
    errors.push('significantBalance must be non-negative');
  }

  if (config.thresholds.highDiscrepancyPercent < 0 || config.thresholds.highDiscrepancyPercent > 100) {
    errors.push('highDiscrepancyPercent must be between 0 and 100');
  }

  if (config.thresholds.balanceComparisonTolerance < 0 || config.thresholds.balanceComparisonTolerance > 100) {
    errors.push('balanceComparisonTolerance must be between 0 and 100');
  }

  if (config.thresholds.externalTradeThreshold < 0 || config.thresholds.externalTradeThreshold > 100) {
    errors.push('externalTradeThreshold must be between 0 and 100');
  }

  if (config.thresholds.veryHighExternalTradeThreshold < 0 || config.thresholds.veryHighExternalTradeThreshold > 100) {
    errors.push('veryHighExternalTradeThreshold must be between 0 and 100');
  }

  if (config.distributedLock.defaultTtl < 1000) {
    errors.push('defaultTtl must be at least 1000ms');
  }

  if (config.intervals.lightweightCheck < 60000) {
    errors.push('lightweightCheck interval must be at least 60 seconds');
  }

  if (config.intervals.robustCheck < 300000) {
    errors.push('robustCheck interval must be at least 5 minutes');
  }

  if (errors.length > 0) {
    throw new Error(`Balance checker configuration validation failed: ${errors.join(', ')}`);
  }

  return true;
}

/**
 * 検証済み設定の取得
 */
function getValidatedConfig() {
  const config = getBalanceCheckerConfig();
  validateConfig(config);
  return config;
}

module.exports = {
  BALANCE_CHECKER_CONFIG,
  getBalanceCheckerConfig,
  validateConfig,
  getValidatedConfig
};