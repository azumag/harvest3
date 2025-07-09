/**
 * Period Extractor Unit Tests
 * GitHub Issue #184: バックテスト改善 - Periodの動的設定
 *
 * t-wada style TDD テスト実装
 */

const assert = require('assert');
const {
  extractStrategyPeriods,
  calculateDynamicLimit,
  validatePeriodRequirements,
  getEnabledStrategiesForSymbol,
  extractPeriodFromStrategy,
  getTimeframeMultiplier
} = require('../../../../src/strategies/utils/periodExtractor');

describe('Period Extractor', () => {

  describe('extractStrategyPeriods', () => {

    it('有効な戦略設定から正しくperiod値を抽出すること', () => {
      const config = {
        strategies: {
          MACD: {
            enabled: true,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
          },
          MA: {
            enabled: true,
            shortPeriod: 5,
            longPeriod: 20
          },
          RSI: {
            enabled: false,
            period: 14
          }
        }
      };

      const result = extractStrategyPeriods(config);

      assert.strictEqual(result.maxPeriod, 26);
      assert.strictEqual(result.enabledStrategies, 2);
      assert.strictEqual(result.totalStrategies, 3);
      assert(result.requiredPeriods.MACD);
      assert(result.requiredPeriods.MA);
      assert(!result.requiredPeriods.RSI);
    });

    it('無効な設定に対してエラーハンドリングが正しく動作すること', () => {
      const result = extractStrategyPeriods(null);

      assert.strictEqual(result.maxPeriod, 0);
      assert.strictEqual(result.enabledStrategies, 0);
      assert(result.error);
    });

    it('有効な戦略が存在しない場合に適切に処理すること', () => {
      const config = {
        strategies: {
          MACD: { enabled: false, fastPeriod: 12 },
          MA: { enabled: false, shortPeriod: 5 }
        }
      };

      const result = extractStrategyPeriods(config);

      assert.strictEqual(result.maxPeriod, 0);
      assert.strictEqual(result.enabledStrategies, 0);
      assert.strictEqual(result.totalStrategies, 2);
    });

  });

  describe('extractPeriodFromStrategy', () => {

    it('MACD戦略から正しくperiod値を抽出すること', () => {
      const strategy = {
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9
      };

      const result = extractPeriodFromStrategy('MACD', strategy);

      assert.deepStrictEqual(result.periods, [12, 26, 9]);
      assert.strictEqual(result.maxPeriod, 26);
      assert.deepStrictEqual(result.parameters, {
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9
      });
    });

    it('MULTI_INDICATOR戦略から複数のperiod値を抽出すること', () => {
      const strategy = {
        macdFastPeriod: 12,
        macdSlowPeriod: 26,
        emaShortPeriod: 12,
        emaLongPeriod: 26,
        rsiPeriod: 14,
        adxPeriod: 14,
        volumeMAPeriod: 20
      };

      const result = extractPeriodFromStrategy('MULTI_INDICATOR', strategy);

      assert(result.periods.includes(12));
      assert(result.periods.includes(26));
      assert(result.periods.includes(14));
      assert(result.periods.includes(20));
      assert.strictEqual(result.maxPeriod, 26);
    });

    it('不正なperiod値をフィルタリングすること', () => {
      const strategy = {
        period: 20,
        invalidPeriod: 'invalid',
        negativePeriod: -5,
        zeroPeriod: 0,
        largePeriod: 300
      };

      const result = extractPeriodFromStrategy('RSI', strategy);

      assert.deepStrictEqual(result.periods, [20]);
      assert.strictEqual(result.maxPeriod, 20);
    });

  });

  describe('calculateDynamicLimit', () => {

    it('基本的な動的limit計算が正しく動作すること', () => {
      const result = calculateDynamicLimit('15m', 7, 20, {
        bufferPercent: 0.3,
        minBuffer: 50,
        maxBuffer: 500
      });

      // 20 * 1.3 = 26, minBufferで50になるはず
      assert.strictEqual(result, 50);
    });

    it('大きなperiod値でmaxBufferが適用されること', () => {
      const result = calculateDynamicLimit('15m', 7, 400, {
        bufferPercent: 0.3,
        minBuffer: 50,
        maxBuffer: 500
      });

      // 400 * 1.3 = 520, maxBufferで500に制限されるはず
      assert.strictEqual(result, 500);
    });

    it('タイムフレーム別の調整が適用されること', () => {
      const result1m = calculateDynamicLimit('1m', 7, 50, { bufferPercent: 0.3 });
      const result1h = calculateDynamicLimit('1h', 7, 50, { bufferPercent: 0.3 });

      // 1mは1.2倍、1hは0.8倍の調整が適用されるはず
      assert(result1m > result1h);
    });

    it('無効なパラメータでフォールバック値を返すこと', () => {
      const result = calculateDynamicLimit(null, null, null);

      assert.strictEqual(result, 200); // デフォルトフォールバック値
    });

    it('ゼロまたは負のmaxPeriodでフォールバック値を返すこと', () => {
      const result = calculateDynamicLimit('15m', 7, 0);

      assert.strictEqual(result, 200);
    });

  });

  describe('getTimeframeMultiplier', () => {

    it('定義されたタイムフレームに対して正しい倍率を返すこと', () => {
      assert.strictEqual(getTimeframeMultiplier('1m'), 1.2);
      assert.strictEqual(getTimeframeMultiplier('15m'), 1.0);
      assert.strictEqual(getTimeframeMultiplier('1h'), 0.8);
      assert.strictEqual(getTimeframeMultiplier('1d'), 0.6);
    });

    it('未定義のタイムフレームに対してデフォルト値を返すこと', () => {
      assert.strictEqual(getTimeframeMultiplier('unknown'), 1.0);
      assert.strictEqual(getTimeframeMultiplier(''), 1.0);
      assert.strictEqual(getTimeframeMultiplier(null), 1.0);
    });

  });

  describe('validatePeriodRequirements', () => {

    it('有効な戦略設定を正しく検証すること', () => {
      const strategies = {
        MACD: {
          enabled: true,
          fastPeriod: 12,
          slowPeriod: 26
        },
        MA: {
          enabled: true,
          shortPeriod: 5,
          longPeriod: 20
        }
      };

      const result = validatePeriodRequirements(strategies);

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.maxPeriod, 26);
      assert.strictEqual(result.warnings.length, 0);
    });

    it('有効な戦略が存在しない場合に無効と判定すること', () => {
      const strategies = {
        MACD: { enabled: false, fastPeriod: 12 }
      };

      const result = validatePeriodRequirements(strategies);

      assert.strictEqual(result.isValid, false);
      assert(result.warnings.includes('有効な戦略が見つかりません'));
    });

    it('期間が長すぎる場合に警告を出すこと', () => {
      const strategies = {
        CUSTOM: {
          enabled: true,
          period: 150
        }
      };

      const result = validatePeriodRequirements(strategies);

      assert(result.warnings.some(w => w.includes('期間が長すぎます')));
      assert(result.recommendations.some(r => r.includes('period値を100以下に調整')));
    });

  });

  describe('getEnabledStrategiesForSymbol', () => {

    it('有効な戦略のみを返すこと', () => {
      const config = {
        strategies: {
          MACD: { enabled: true, fastPeriod: 12 },
          MA: { enabled: false, shortPeriod: 5 },
          RSI: { enabled: true, period: 14 }
        }
      };

      const result = getEnabledStrategiesForSymbol('BTC/USDT', config);

      assert(result.MACD);
      assert(result.RSI);
      assert(!result.MA);
    });

    it('無効な設定に対して空オブジェクトを返すこと', () => {
      const result = getEnabledStrategiesForSymbol('BTC/USDT', null);

      assert.deepStrictEqual(result, {});
    });

    it('戦略設定が存在しない場合に空オブジェクトを返すこと', () => {
      const config = {};

      const result = getEnabledStrategiesForSymbol('BTC/USDT', config);

      assert.deepStrictEqual(result, {});
    });

  });

  describe('統合テスト', () => {

    it('実際の設定形式でエンドツーエンドの動作を確認すること', () => {
      const config = {
        strategies: {
          MUTUAL_INFO: {
            enabled: true,
            period: 30,
            correlationWindow: 20
          },
          MACD: {
            enabled: true,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
          },
          MA: {
            enabled: true,
            shortPeriod: 5,
            longPeriod: 20
          },
          BOLLINGER_BANDS: {
            enabled: false,
            period: 20
          }
        }
      };

      // 戦略period抽出
      const extraction = extractStrategyPeriods(config);
      assert.strictEqual(extraction.maxPeriod, 30);
      assert.strictEqual(extraction.enabledStrategies, 3);

      // 検証
      const validation = validatePeriodRequirements(config.strategies);
      assert.strictEqual(validation.isValid, true);
      assert.strictEqual(validation.maxPeriod, 30);

      // 動的limit計算
      const limit = calculateDynamicLimit('15m', 7, extraction.maxPeriod, {
        bufferPercent: 0.3,
        minBuffer: 50,
        maxBuffer: 500
      });

      // 30 * 1.3 = 39, minBufferで50になるはず
      assert.strictEqual(limit, 50);
    });

    it('設定エラー時のフォールバック動作を確認すること', () => {
      // 無効な設定
      const invalidConfig = null;

      const extraction = extractStrategyPeriods(invalidConfig);
      assert.strictEqual(extraction.maxPeriod, 0);
      assert(extraction.error);

      // フォールバックlimit計算
      const limit = calculateDynamicLimit('15m', 7, extraction.maxPeriod);
      assert.strictEqual(limit, 200); // フォールバック値
    });

  });

});