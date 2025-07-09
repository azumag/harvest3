/**
 * 戦略Period抽出エンジン
 * GitHub Issue #184: バックテスト改善 - Periodの動的設定
 *
 * 有効な戦略設定からperiod関連パラメータを動的に抽出し、
 * 最適なバッファサイズを自動計算する
 */

/**
 * 戦略設定からperiod関連パラメータを抽出する
 * @param {Object} config 設定オブジェクト
 * @param {string} symbol 対象シンボル（将来の拡張用）
 * @returns {Object} 抽出結果 { maxPeriod: number, requiredPeriods: Object, details: Array }
 */
function extractStrategyPeriods(config, symbol = null) {
  try {
    if (!config || !config.strategies) {
      console.warn('[Period Extractor] 戦略設定が無効です');
      return {
        maxPeriod: 0,
        requiredPeriods: {},
        details: [],
        enabledStrategies: 0,
        totalStrategies: 0,
        error: '戦略設定が見つかりません'
      };
    }

    const results = {
      maxPeriod: 0,
      requiredPeriods: {},
      details: [],
      enabledStrategies: 0,
      totalStrategies: 0
    };

    // 有効な戦略のみを対象とする
    const strategies = config.strategies;
    const strategyKeys = Object.keys(strategies);
    results.totalStrategies = strategyKeys.length;

    for (const strategyKey of strategyKeys) {
      const strategy = strategies[strategyKey];

      // 戦略が有効でない場合はスキップ
      if (!strategy.enabled) {
        continue;
      }

      results.enabledStrategies++;

      // 戦略固有のperiod設定を抽出
      const periodData = extractPeriodFromStrategy(strategyKey, strategy);

      if (periodData.periods.length > 0) {
        results.requiredPeriods[strategyKey] = periodData.periods;
        results.details.push({
          strategy: strategyKey,
          type: strategy.type || 'unknown',
          periods: periodData.periods,
          maxPeriod: periodData.maxPeriod,
          parameters: periodData.parameters
        });

        // 全体の最大period値を更新
        if (periodData.maxPeriod > results.maxPeriod) {
          results.maxPeriod = periodData.maxPeriod;
        }
      }
    }

    console.log(`[Period Extractor] 抽出完了: ${results.enabledStrategies}/${results.totalStrategies}戦略, 最大Period: ${results.maxPeriod}`);

    return results;
  } catch (error) {
    console.error('[Period Extractor] エラー:', error);
    return {
      maxPeriod: 0,
      requiredPeriods: {},
      details: [],
      enabledStrategies: 0,
      totalStrategies: 0,
      error: error.message
    };
  }
}

/**
 * 個別戦略からperiod関連パラメータを抽出する
 * @param {string} strategyKey 戦略キー
 * @param {Object} strategy 戦略設定
 * @returns {Object} 抽出されたperiod情報
 */
function extractPeriodFromStrategy(strategyKey, strategy) {
  const periods = [];
  const parameters = {};

  // 戦略タイプ別のperiod抽出ロジック
  switch (strategyKey) {
  case 'MUTUAL_INFO':
    // 相互情報量戦略: period(30), correlationWindow(20)
    if (strategy.period) {
      periods.push(strategy.period);
      parameters.period = strategy.period;
    }
    if (strategy.correlationWindow) {
      periods.push(strategy.correlationWindow);
      parameters.correlationWindow = strategy.correlationWindow;
    }
    break;

  case 'MEAN_REVERSION':
  case 'BOLLINGER_BANDS':
  case 'OSCILLATOR':
  case 'RSI':
    // 平均回帰系戦略: period(14-20)
    if (strategy.period) {
      periods.push(strategy.period);
      parameters.period = strategy.period;
    }
    break;

  case 'MACD':
    // MACD戦略: fastPeriod(12), slowPeriod(26), signalPeriod(9)
    if (strategy.fastPeriod) {
      periods.push(strategy.fastPeriod);
      parameters.fastPeriod = strategy.fastPeriod;
    }
    if (strategy.slowPeriod) {
      periods.push(strategy.slowPeriod);
      parameters.slowPeriod = strategy.slowPeriod;
    }
    if (strategy.signalPeriod) {
      periods.push(strategy.signalPeriod);
      parameters.signalPeriod = strategy.signalPeriod;
    }
    break;

  case 'MA':
    // 移動平均戦略: shortPeriod(5), longPeriod(20)
    if (strategy.shortPeriod) {
      periods.push(strategy.shortPeriod);
      parameters.shortPeriod = strategy.shortPeriod;
    }
    if (strategy.longPeriod) {
      periods.push(strategy.longPeriod);
      parameters.longPeriod = strategy.longPeriod;
    }
    break;

  case 'MULTI_INDICATOR':
    // マルチ指標戦略: 複数のperiod設定
    const multiParams = [
      'macdFastPeriod', 'macdSlowPeriod', 'macdSignalPeriod',
      'emaShortPeriod', 'emaLongPeriod', 'rsiPeriod',
      'adxPeriod', 'volumeMAPeriod'
    ];

    multiParams.forEach(param => {
      if (strategy[param]) {
        periods.push(strategy[param]);
        parameters[param] = strategy[param];
      }
    });
    break;

  default:
    // 汎用period検出: 一般的なパラメータ名をチェック
    const commonPeriodParams = [
      'period', 'shortPeriod', 'longPeriod', 'fastPeriod', 'slowPeriod',
      'signalPeriod', 'atrPeriod', 'correlationWindow', 'rsiPeriod'
    ];

    commonPeriodParams.forEach(param => {
      if (strategy[param] && typeof strategy[param] === 'number') {
        periods.push(strategy[param]);
        parameters[param] = strategy[param];
      }
    });
    break;
  }

  // 数値でないまたは範囲外の値をフィルタ
  const validPeriods = periods.filter(p =>
    typeof p === 'number' && p > 0 && p <= 200
  );

  return {
    periods: validPeriods,
    maxPeriod: validPeriods.length > 0 ? Math.max(...validPeriods) : 0,
    parameters
  };
}

/**
 * 動的なlimit値を計算する
 * @param {string} timeframe タイムフレーム ('5m', '15m', '1h', etc.)
 * @param {number} days バックテスト日数
 * @param {number} maxPeriod 最大期間
 * @param {Object} options オプション設定
 * @returns {number} 計算されたlimit値
 */
function calculateDynamicLimit(timeframe, days, maxPeriod, options = {}) {
  const {
    bufferPercent = 0.3,     // 30%バッファ
    minBuffer = 50,          // 最小バッファ
    maxBuffer = 500,         // 最大バッファ
    fallbackBuffer = 200     // フォールバック値
  } = options;

  try {
    // 基本的なバリデーション
    if (!timeframe || typeof days !== 'number' || typeof maxPeriod !== 'number') {
      console.warn('[Dynamic Limit] パラメータが無効です、フォールバック値を使用');
      return fallbackBuffer;
    }

    if (maxPeriod <= 0) {
      console.warn('[Dynamic Limit] 有効なperiodが見つかりません、フォールバック値を使用');
      return fallbackBuffer;
    }

    // 基本バッファを計算
    const basicBuffer = Math.ceil(maxPeriod * (1 + bufferPercent));

    // 制限値を適用
    let finalBuffer = Math.max(minBuffer, Math.min(maxBuffer, basicBuffer));

    // タイムフレーム別の調整（将来の拡張用）
    const timeframeMultiplier = getTimeframeMultiplier(timeframe);
    finalBuffer = Math.ceil(finalBuffer * timeframeMultiplier);

    // 最終制限チェック
    finalBuffer = Math.max(minBuffer, Math.min(maxBuffer, finalBuffer));

    console.log(`[Dynamic Limit] 計算完了: maxPeriod=${maxPeriod}, buffer=${finalBuffer} (${bufferPercent*100}%+)`);

    return finalBuffer;
  } catch (error) {
    console.error('[Dynamic Limit] 計算エラー:', error);
    return fallbackBuffer;
  }
}

/**
 * タイムフレーム別の調整倍率を取得
 * @param {string} timeframe タイムフレーム
 * @returns {number} 調整倍率
 */
function getTimeframeMultiplier(timeframe) {
  const multipliers = {
    '1m': 1.2,   // 短期間では多めのバッファ
    '5m': 1.1,
    '15m': 1.0,  // ベースライン
    '30m': 0.9,
    '1h': 0.8,
    '4h': 0.7,
    '1d': 0.6    // 長期間では少なめのバッファ
  };

  return multipliers[timeframe] || 1.0;
}

/**
 * period要件を検証する
 * @param {Object} strategies 戦略設定
 * @param {string} symbol 対象シンボル
 * @returns {Object} 検証結果
 */
function validatePeriodRequirements(strategies, symbol = null) {
  try {
    const extraction = extractStrategyPeriods({ strategies }, symbol);

    const validation = {
      isValid: true,
      maxPeriod: extraction.maxPeriod,
      warnings: [],
      recommendations: []
    };

    // 基本検証
    if (extraction.enabledStrategies === 0) {
      validation.isValid = false;
      validation.warnings.push('有効な戦略が見つかりません');
    }

    if (extraction.maxPeriod === 0) {
      validation.isValid = false;
      validation.warnings.push('有効なperiod設定が見つかりません');
    }

    // 異常値チェック
    if (extraction.maxPeriod > 100) {
      validation.warnings.push(`期間が長すぎます: ${extraction.maxPeriod}`);
      validation.recommendations.push('period値を100以下に調整することを推奨');
    }

    // 戦略別の詳細チェック
    extraction.details.forEach(detail => {
      if (detail.maxPeriod > 50) {
        validation.warnings.push(`${detail.strategy}: 期間が長め (${detail.maxPeriod})`);
      }
    });

    return validation;
  } catch (error) {
    return {
      isValid: false,
      maxPeriod: 0,
      warnings: [error.message],
      recommendations: ['設定を確認してください']
    };
  }
}

/**
 * 特定シンボルの有効戦略を取得する（将来の拡張用）
 * @param {string} symbol シンボル
 * @param {Object} config 設定
 * @returns {Object} フィルタされた戦略設定
 */
function getEnabledStrategiesForSymbol(symbol, config) {
  if (!config || !config.strategies) {
    return {};
  }

  // 現在は全戦略を返すが、将来的にシンボル固有のフィルタリングを実装可能
  const enabledStrategies = {};

  Object.keys(config.strategies).forEach(key => {
    const strategy = config.strategies[key];
    if (strategy.enabled) {
      enabledStrategies[key] = strategy;
    }
  });

  return enabledStrategies;
}

module.exports = {
  extractStrategyPeriods,
  calculateDynamicLimit,
  validatePeriodRequirements,
  getEnabledStrategiesForSymbol,
  extractPeriodFromStrategy,
  getTimeframeMultiplier
};