/**
 * データベース共通化ライブラリのテスト
 * src/common/database.js の全機能をテスト
 */

const {
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
} = require('../../../src/common/database');

// ユーティリティ関数のモック
const mockUtils = {
  executeWithRetry: jest.fn(),
  handleStrategyError: jest.fn()
};

jest.mock('../../../src/common/utils', () => mockUtils);

describe('データベース共通化ライブラリテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateRedisKey', () => {
    test('基本的なキー生成', () => {
      const key = generateRedisKey('bitbank', 'BTC/JPY', 'params');
      expect(key).toBe('params:bitbank:BTC/JPY');
    });

    test('サフィックス付きキー生成', () => {
      const key = generateRedisKey('bitbank', 'BTC/JPY', 'signal', 'MA');
      expect(key).toBe('signal:bitbank:BTC/JPY:MA');
    });

    test('空のサフィックスは無視される', () => {
      const key = generateRedisKey('test', 'TEST/USD', 'position', '');
      expect(key).toBe('position:test:TEST/USD');
    });
  });

  describe('safeJsonParse', () => {
    test('有効なJSONの解析', () => {
      const result = safeJsonParse('{"key": "value", "number": 123}');
      expect(result).toEqual({ key: 'value', number: 123 });
    });

    test('無効なJSONの場合はデフォルト値', () => {
      const result = safeJsonParse('invalid json', { default: true });
      expect(result).toEqual({ default: true });
    });

    test('デフォルト値が未指定の場合はnull', () => {
      const result = safeJsonParse('invalid json');
      expect(result).toBe(null);
    });

    test('空文字列の場合', () => {
      const result = safeJsonParse('');
      expect(result).toBe(null);
    });
  });

  describe('parseParamValue', () => {
    test('数値文字列の変換', () => {
      expect(parseParamValue('123')).toBe(123);
      expect(parseParamValue('123.45')).toBe(123.45);
      expect(parseParamValue('0')).toBe(0);
      expect(parseParamValue('-50.5')).toBe(-50.5);
    });

    test('ブール値文字列の変換', () => {
      expect(parseParamValue('true')).toBe(true);
      expect(parseParamValue('false')).toBe(false);
      expect(parseParamValue('TRUE')).toBe(true);
      expect(parseParamValue('FALSE')).toBe(false);
    });

    test('その他の文字列はそのまま', () => {
      expect(parseParamValue('hello')).toBe('hello');
      expect(parseParamValue('123abc')).toBe('123abc');
    });

    test('null/undefinedはそのまま', () => {
      expect(parseParamValue(null)).toBe(null);
      expect(parseParamValue(undefined)).toBe(undefined);
    });

    test('数値型はそのまま', () => {
      expect(parseParamValue(456)).toBe(456);
      expect(parseParamValue(0)).toBe(0);
    });
  });

  describe('safeRedisOperation', () => {
    test('成功時は操作結果を返す', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      mockUtils.executeWithRetry.mockResolvedValue('success');
      
      const result = await safeRedisOperation(mockOperation, 'test-context');
      
      expect(result).toBe('success');
      expect(mockUtils.executeWithRetry).toHaveBeenCalledWith(
        mockOperation, 3, 500, 'test-context'
      );
    });

    test('失敗時はデフォルト値を返す', async () => {
      const mockOperation = jest.fn();
      mockUtils.executeWithRetry.mockRejectedValue(new Error('Redis error'));
      
      const result = await safeRedisOperation(mockOperation, 'test-context', 'default');
      
      expect(result).toBe('default');
      expect(mockUtils.handleStrategyError).toHaveBeenCalled();
    });
  });

  describe('safeMongoOperation', () => {
    test('成功時は操作結果を返す', async () => {
      const mockOperation = jest.fn().mockResolvedValue({ _id: '123' });
      mockUtils.executeWithRetry.mockResolvedValue({ _id: '123' });
      
      const result = await safeMongoOperation(mockOperation, 'mongo-context');
      
      expect(result).toEqual({ _id: '123' });
      expect(mockUtils.executeWithRetry).toHaveBeenCalledWith(
        mockOperation, 3, 1000, 'mongo-context'
      );
    });

    test('失敗時はデフォルト値を返す', async () => {
      const mockOperation = jest.fn();
      mockUtils.executeWithRetry.mockRejectedValue(new Error('MongoDB error'));
      
      const result = await safeMongoOperation(mockOperation, 'mongo-context', []);
      
      expect(result).toEqual([]);
      expect(mockUtils.handleStrategyError).toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    test('バッチ処理の成功ケース', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockResolvedValueOnce('result2')
        .mockResolvedValueOnce('result3')
        .mockResolvedValueOnce('result4')
        .mockResolvedValueOnce('result5');
      
      const results = await processBatch(items, processor, 2, 10, 'test');
      
      expect(results).toEqual(['result1', 'result2', 'result3', 'result4', 'result5']);
      expect(processor).toHaveBeenCalledTimes(5);
    });

    test('一部のアイテムで失敗があってもnullで継続', async () => {
      const items = [1, 2, 3];
      const processor = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockRejectedValueOnce(new Error('error'))
        .mockResolvedValueOnce('result3');
      
      // Promise.allが失敗した場合の個別リトライをシミュレート
      const results = await processBatch(items, processor, 3, 10, 'test');
      
      // バッチが失敗して個別処理にフォールバックした場合
      expect(processor).toHaveBeenCalledTimes(3);
    });

    test('空の配列の処理', async () => {
      const processor = jest.fn();
      const results = await processBatch([], processor, 5, 10, 'test');
      
      expect(results).toEqual([]);
      expect(processor).not.toHaveBeenCalled();
    });
  });

  describe('checkConnection', () => {
    test('Redisクライアントの接続チェック成功', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG')
      };
      
      const result = await checkConnection(mockRedisClient, 'redis');
      
      expect(result).toBe(true);
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    test('MongoDBクライアントの接続チェック成功', async () => {
      const mockMongoClient = {
        admin: jest.fn().mockReturnValue({
          ping: jest.fn().mockResolvedValue({ ok: 1 })
        })
      };
      
      const result = await checkConnection(mockMongoClient, 'mongodb');
      
      expect(result).toBe(true);
      expect(mockMongoClient.admin().ping).toHaveBeenCalled();
    });

    test('接続チェック失敗', async () => {
      const mockClient = {
        ping: jest.fn().mockRejectedValue(new Error('Connection failed'))
      };
      
      const result = await checkConnection(mockClient, 'redis');
      
      expect(result).toBe(false);
    });

    test('未対応のデータベースタイプ', async () => {
      const mockClient = {};
      const result = await checkConnection(mockClient, 'unknown');
      
      expect(result).toBe(false);
    });
  });

  describe('generateTimestamps', () => {
    test('現在時刻でのタイムスタンプ生成', () => {
      const before = Date.now();
      const timestamps = generateTimestamps();
      const after = Date.now();
      
      expect(timestamps.unixMs).toBeGreaterThanOrEqual(before);
      expect(timestamps.unixMs).toBeLessThanOrEqual(after);
      expect(timestamps.unix).toBe(Math.floor(timestamps.unixMs / 1000));
      expect(timestamps.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(timestamps.local).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}/);
      expect(timestamps.date).toBeInstanceOf(Date);
    });

    test('指定した日時でのタイムスタンプ生成', () => {
      const testDate = new Date('2023-01-01T12:00:00.000Z');
      const timestamps = generateTimestamps(testDate);
      
      expect(timestamps.unix).toBe(1672574400);
      expect(timestamps.unixMs).toBe(1672574400000);
      expect(timestamps.iso).toBe('2023-01-01T12:00:00.000Z');
      expect(timestamps.date).toEqual(testDate);
    });
  });

  describe('executeWithRateLimit', () => {
    beforeEach(() => {
      jest.clearAllTimers();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('レート制限なしで実行完了', async () => {
      const mockOperation = jest.fn().mockResolvedValue('result');
      
      const promise = executeWithRateLimit(mockOperation, 10, 'test');
      jest.runAllTimers();
      
      const result = await promise;
      expect(result).toBe('result');
      expect(mockOperation).toHaveBeenCalled();
    });

    test('レート制限による待機', async () => {
      const mockOperation = jest.fn().mockResolvedValue('result');
      
      // 10 ops/sec = 100ms minimum interval
      const promise = executeWithRateLimit(mockOperation, 10, 'test');
      
      // 操作が即座に完了した場合、残り時間分待機する
      jest.advanceTimersByTime(100);
      
      const result = await promise;
      expect(result).toBe('result');
    });
  });

  describe('validateAndSanitizeData', () => {
    const schema = {
      name: { type: 'string', required: true },
      age: { type: 'number', required: true, min: 0, max: 150 },
      active: { type: 'boolean', default: true },
      score: { type: 'number', min: 0, max: 100, default: 50 }
    };

    test('有効なデータの検証と正規化', () => {
      const data = {
        name: 'John',
        age: '25',
        active: 'true'
      };
      
      const result = validateAndSanitizeData(data, schema, 'user');
      
      expect(result).toEqual({
        name: 'John',
        age: 25,
        active: true,
        score: 50 // default value
      });
    });

    test('必須フィールド不足でエラー', () => {
      const data = { age: 25 };
      
      expect(() => {
        validateAndSanitizeData(data, schema, 'user');
      }).toThrow('[user] データ検証エラー: name is required');
    });

    test('型変換エラー', () => {
      const data = {
        name: 'John',
        age: 'invalid_number'
      };
      
      expect(() => {
        validateAndSanitizeData(data, schema, 'user');
      }).toThrow('[user] データ検証エラー: age must be a number');
    });

    test('範囲チェックエラー', () => {
      const data = {
        name: 'John',
        age: 200, // max 150を超過
        score: -10 // min 0を下回る
      };
      
      expect(() => {
        validateAndSanitizeData(data, schema, 'user');
      }).toThrow(/age must be <= 150.*score must be >= 0/);
    });

    test('デフォルト値の適用', () => {
      const data = {
        name: 'John',
        age: 25
      };
      
      const result = validateAndSanitizeData(data, schema, 'user');
      
      expect(result.active).toBe(true);
      expect(result.score).toBe(50);
    });
  });
});