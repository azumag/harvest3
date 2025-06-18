/**
 * 戦略共通ユーティリティ関数のテスト
 * src/common/utils.js の新規追加機能をテスト
 */

const {
  determineSignalType,
  formatStrategyLogInfo,
  handleStrategyError,
  validateStrategyParams,
  safeNumberConversion,
  safeArrayGet,
  validateOHLCVData,
  executeWithRetry
} = require('../../../src/common/utils');

// モックを設定
jest.mock('../../../src/common/errorHandler', () => ({
  errorHandler: {
    handleError: jest.fn()
  }
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn()
}));

// モック関数への参照を取得
const { errorHandler } = require('../../../src/common/errorHandler');
const { postErrorToDiscord } = require('../../../src/common/notifications');

describe('戦略共通ユーティリティ関数テスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('determineSignalType', () => {
    test('買いシグナルの場合', () => {
      const result = determineSignalType(true, false);
      expect(result).toBe('buy');
    });

    test('売りシグナルの場合', () => {
      const result = determineSignalType(false, true);
      expect(result).toBe('sell');
    });

    test('シグナルなしの場合', () => {
      const result = determineSignalType(false, false);
      expect(result).toBe('none');
    });

    test('両方のシグナルがある場合は買いが優先', () => {
      const result = determineSignalType(true, true);
      expect(result).toBe('buy');
    });
  });

  describe('formatStrategyLogInfo', () => {
    test('基本的なログフォーマット', () => {
      const result = formatStrategyLogInfo('TEST_STRATEGY', 'bitbank', 'BTC/JPY', {
        price: 100000,
        volume: 0.01
      });

      expect(result).toHaveProperty('timestamp');
      expect(result.strategy).toBe('TEST_STRATEGY');
      expect(result.exchange).toBe('bitbank');
      expect(result.symbol).toBe('BTC/JPY');
      expect(result.price).toBe(100000);
      expect(result.volume).toBe(0.01);
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });

    test('空のデータでもフォーマット可能', () => {
      const result = formatStrategyLogInfo('TEST', 'test', 'TEST/USD', {});
      
      expect(result).toHaveProperty('timestamp');
      expect(result.strategy).toBe('TEST');
      expect(result.exchange).toBe('test');
      expect(result.symbol).toBe('TEST/USD');
    });
  });

  describe('handleStrategyError', () => {
    test('エラーオブジェクトの処理', async () => {
      const error = new Error('テストエラー');
      
      await handleStrategyError(error, 'TEST_STRATEGY', 'bitbank', 'BTC/JPY', false);
      
      expect(errorHandler.handleError).toHaveBeenCalledWith(
        error,
        'TEST_STRATEGY - bitbank - BTC/JPY',
        false
      );
    });

    test('エラー文字列の処理', async () => {
      await handleStrategyError('テストエラーメッセージ', 'TEST', 'test', 'TEST/USD', false);
      
      expect(errorHandler.handleError).toHaveBeenCalledWith(
        'テストエラーメッセージ',
        'TEST - test - TEST/USD',
        false
      );
    });

    test('エラーハンドラー自体でエラーが発生した場合のフォールバック', async () => {
      errorHandler.handleError.mockRejectedValueOnce(new Error('ハンドラーエラー'));
      
      await handleStrategyError('元のエラー', 'TEST', 'test', 'TEST/USD', false);
      
      expect(postErrorToDiscord).toHaveBeenCalledWith(
        'TEST - test - TEST/USD: 元のエラー'
      );
    });
  });

  describe('validateStrategyParams', () => {
    test('有効なパラメータの検証成功', () => {
      const params = { period: 14, threshold: 0.5 };
      const requiredKeys = ['period', 'threshold'];
      
      const result = validateStrategyParams(params, requiredKeys, 'TEST_STRATEGY');
      expect(result).toBe(true);
    });

    test('パラメータオブジェクトがnullの場合', () => {
      expect(() => {
        validateStrategyParams(null, ['period'], 'TEST_STRATEGY');
      }).toThrow('TEST_STRATEGY: パラメータが不正です');
    });

    test('必須キーが不足している場合', () => {
      const params = { period: 14 };
      const requiredKeys = ['period', 'threshold'];
      
      expect(() => {
        validateStrategyParams(params, requiredKeys, 'TEST_STRATEGY');
      }).toThrow('TEST_STRATEGY: 必須パラメータ \'threshold\' が不足しています');
    });

    test('値がundefinedの場合', () => {
      const params = { period: 14, threshold: undefined };
      const requiredKeys = ['period', 'threshold'];
      
      expect(() => {
        validateStrategyParams(params, requiredKeys, 'TEST_STRATEGY');
      }).toThrow('TEST_STRATEGY: 必須パラメータ \'threshold\' が不足しています');
    });
  });

  describe('safeNumberConversion', () => {
    test('有効な数値の変換', () => {
      expect(safeNumberConversion('123.45')).toBe(123.45);
      expect(safeNumberConversion(456.78)).toBe(456.78);
      expect(safeNumberConversion('0')).toBe(0);
    });

    test('無効な値の場合はデフォルト値を返す', () => {
      expect(safeNumberConversion('invalid', 100)).toBe(100);
      expect(safeNumberConversion(null, 50)).toBe(50);
      expect(safeNumberConversion(undefined, 25)).toBe(25);
    });

    test('範囲制限の適用', () => {
      expect(safeNumberConversion('150', 100, 0, 100)).toBe(100); // 最大値制限
      expect(safeNumberConversion('-50', 100, 0, 100)).toBe(0);   // 最小値制限
      expect(safeNumberConversion('50', 100, 0, 100)).toBe(50);   // 範囲内
    });
  });

  describe('safeArrayGet', () => {
    const testArray = [10, 20, 30, 40, 50];

    test('有効なインデックスでの取得', () => {
      expect(safeArrayGet(testArray, 0)).toBe(10);
      expect(safeArrayGet(testArray, 2)).toBe(30);
      expect(safeArrayGet(testArray, 4)).toBe(50);
    });

    test('無効なインデックスの場合はデフォルト値', () => {
      expect(safeArrayGet(testArray, -1)).toBe(null);
      expect(safeArrayGet(testArray, 10)).toBe(null);
      expect(safeArrayGet(testArray, 5, 'default')).toBe('default');
    });

    test('配列以外の値の場合', () => {
      expect(safeArrayGet(null, 0)).toBe(null);
      expect(safeArrayGet(undefined, 0)).toBe(null);
      expect(safeArrayGet('not_array', 0, 'default')).toBe('default');
    });
  });

  describe('validateOHLCVData', () => {
    const validOHLCV = [
      [1640995200000, 100, 105, 95, 102, 1000],
      [1640995260000, 102, 107, 98, 104, 1200],
      [1640995320000, 104, 108, 100, 106, 800]
    ];

    test('有効なOHLCVデータの検証成功', () => {
      const result = validateOHLCVData(validOHLCV, 2, 'TEST_STRATEGY');
      expect(result).toBe(true);
    });

    test('配列でない場合', () => {
      expect(() => {
        validateOHLCVData('not_array', 1, 'TEST_STRATEGY');
      }).toThrow('TEST_STRATEGY: OHLCVデータが配列ではありません');
    });

    test('データ不足の場合', () => {
      expect(() => {
        validateOHLCVData(validOHLCV, 5, 'TEST_STRATEGY');
      }).toThrow('TEST_STRATEGY: データが不足しています: 3/5');
    });

    test('不正なOHLCVデータ構造', () => {
      const invalidOHLCV = [
        [1640995200000, 100, 105, 95], // close price missing
        [1640995260000, 102, 107, 98, 104, 1200]
      ];

      expect(() => {
        validateOHLCVData(invalidOHLCV, 1, 'TEST_STRATEGY');
      }).toThrow('TEST_STRATEGY: 不正なOHLCVデータ形式: index 0');
    });

    test('数値以外のデータが含まれる場合', () => {
      const invalidOHLCV = [
        [1640995200000, 'invalid', 105, 95, 102, 1000]
      ];

      expect(() => {
        validateOHLCVData(invalidOHLCV, 1, 'TEST_STRATEGY');
      }).toThrow('TEST_STRATEGY: 数値以外のデータが含まれています: index 0');
    });
  });

  describe('executeWithRetry', () => {
    test('成功時は最初の実行で完了', async () => {
      const mockFunction = jest.fn().mockResolvedValue('success');
      
      const result = await executeWithRetry(mockFunction, 3, 100, 'test');
      
      expect(result).toBe('success');
      expect(mockFunction).toHaveBeenCalledTimes(1);
    });

    test('失敗時のリトライ機能', async () => {
      const mockFunction = jest.fn()
        .mockRejectedValueOnce(new Error('1回目失敗'))
        .mockRejectedValueOnce(new Error('2回目失敗'))
        .mockResolvedValueOnce('3回目成功');
      
      const result = await executeWithRetry(mockFunction, 3, 10, 'test');
      
      expect(result).toBe('3回目成功');
      expect(mockFunction).toHaveBeenCalledTimes(3);
    });

    test('全てのリトライに失敗した場合', async () => {
      const mockFunction = jest.fn().mockRejectedValue(new Error('常に失敗'));
      
      await expect(executeWithRetry(mockFunction, 2, 10, 'test')).rejects.toThrow('常に失敗');
      expect(mockFunction).toHaveBeenCalledTimes(2);
    });
  });
});