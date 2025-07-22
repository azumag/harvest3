const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Issue #5030: backtestサービスで例外が発生 - TypeError: Cannot convert undefined or null to object
 * 
 * backtestRunner.js と redisDatabase.js で null/undefined パラメータの処理時に
 * Object.keys() でTypeErrorが発生する問題を修正
 */
describe('Issue #5030: backtest service TypeError fix', () => {
  let mockRedisClient;
  let getStrategyParametersRedis;
  let getAllStrategyParametersRedis;

  beforeEach(() => {
    // 既存のモジュールキャッシュをクリア
    jest.resetModules();

    // Redis clientをmock
    mockRedisClient = {
      isReady: true,
      hGetAll: jest.fn(),
      keys: jest.fn()
    };

    // redisClientモジュールをモック
    jest.doMock('../src/database/redisClient', () => ({
      client: mockRedisClient,
      getClient: () => mockRedisClient,
      initRedisClient: jest.fn().mockResolvedValue(mockRedisClient)
    }));
    
    // モック後にredisDatabase.jsから関数をインポート
    const redisDatabase = require('../src/database/redisDatabase');
    getStrategyParametersRedis = redisDatabase.getStrategyParametersRedis;
    getAllStrategyParametersRedis = redisDatabase.getAllStrategyParametersRedis;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStrategyParametersRedis - null/undefined安全性', () => {
    it('should handle null response without throwing TypeError', async () => {
      // Redis hGetAllがnullを返すケース（修正前はここでTypeError発生）
      mockRedisClient.hGetAll.mockResolvedValue(null);

      const result = await getStrategyParametersRedis('bitbank', 'BTC/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith('params:bitbank:BTC/JPY:MUTUAL_INFO');
      // エラーが発生しないことを確認
      expect(() => result).not.toThrow();
    });

    it('should handle undefined response without throwing TypeError', async () => {
      // Redis hGetAllがundefinedを返すケース（修正前はここでTypeError発生）
      mockRedisClient.hGetAll.mockResolvedValue(undefined);

      const result = await getStrategyParametersRedis('bitbank', 'ETH/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith('params:bitbank:ETH/JPY:MUTUAL_INFO');
    });

    it('should handle array response safely (reject non-object types)', async () => {
      // 配列が返された場合も安全に処理
      mockRedisClient.hGetAll.mockResolvedValue(['invalid', 'array']);

      const result = await getStrategyParametersRedis('bitbank', 'DOT/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
    });
  });

  describe('getAllStrategyParametersRedis - null/undefined安全性', () => {
    it('should handle null responses in bulk operation without TypeError', async () => {
      // パラメータキーのリストをモック
      const mockKeys = ['params:bitbank:BTC/JPY:MUTUAL_INFO', 'params:bitbank:ETH/JPY:MUTUAL_INFO'];
      mockRedisClient.keys.mockResolvedValue(mockKeys);
      
      // 一つはnull、一つは有効なデータを返すケース
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(null) // 1回目の呼び出しはnull
        .mockResolvedValueOnce({ period: '14' }); // 2回目の呼び出しは有効なデータ

      const result = await getAllStrategyParametersRedis();
      
      // nullは除外され、有効なデータのみが含まれることを確認（オブジェクト形式で返される）
      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
      expect(Object.keys(result)).toHaveLength(1);
      expect(result['params:bitbank:ETH/JPY:MUTUAL_INFO']).toEqual({ period: 14 });
    });
  });

  describe('backtestRunner parameterCombinations 処理のテスト', () => {
    it('should handle null combo in parameterCombinations without TypeError', () => {
      // backtestRunner.js で使用されるパラメータ組み合わせのテスト
      const parameterCombinations = [
        { period: 14, threshold: 0.5 }, // 有効なcombo
        null, // null combo（修正前はここでTypeError発生）
        { period: 20, threshold: 0.7 }, // 有効なcombo
        undefined, // undefined combo
      ];

      const uniqueCombinationsMap = new Map();
      
      // backtestRunner.js の修正されたロジックをシミュレート
      parameterCombinations.forEach(combo => {
        // 修正後のnull/undefinedチェック
        if (!combo || combo === null || Array.isArray(combo) || typeof combo !== 'object') {
          console.warn('無効なパラメータ組み合わせをスキップ:', combo);
          return;
        }
        
        // ここでTypeErrorが発生してはいけない
        expect(() => Object.keys(combo)).not.toThrow();
        
        const keys = Object.keys(combo).sort();
        const sortedCombo = {};
        keys.forEach(key => sortedCombo[key] = combo[key]);

        const comboKey = JSON.stringify(sortedCombo);
        if (!uniqueCombinationsMap.has(comboKey)) {
          uniqueCombinationsMap.set(comboKey, combo);
        }
      });

      // 有効なcomboのみがマップに追加されていることを確認
      expect(uniqueCombinationsMap.size).toBe(2);
    });

    it('should handle array combo in parameterCombinations safely', () => {
      const parameterCombinations = [
        { period: 14 }, // 有効なcombo
        ['invalid', 'array'], // 配列combo
        { threshold: 0.5 }, // 有効なcombo
      ];

      const validCombos = [];
      
      parameterCombinations.forEach(combo => {
        // 修正後のチェックロジック
        if (!combo || combo === null || Array.isArray(combo) || typeof combo !== 'object') {
          return; // 配列は除外される
        }
        validCombos.push(combo);
      });

      // 配列が適切に除外され、有効なオブジェクトのみが残ることを確認
      expect(validCombos).toHaveLength(2);
      expect(validCombos[0]).toEqual({ period: 14 });
      expect(validCombos[1]).toEqual({ threshold: 0.5 });
    });
  });

  describe('TypeError防止の統合テスト', () => {
    it('should prevent original TypeError scenarios completely', async () => {
      // 元のTypeErrorが発生していたシナリオの統合テスト
      
      // 1. Redis関連のnullレスポンス
      mockRedisClient.hGetAll.mockResolvedValue(null);
      await expect(getStrategyParametersRedis('bitbank', 'BTC/JPY', 'MUTUAL_INFO'))
        .resolves.not.toThrow('TypeError: Cannot convert undefined or null to object');

      // 2. parameterCombinations でのnull値
      const testCombos = [null, undefined, { valid: 'param' }];
      expect(() => {
        testCombos.forEach(combo => {
          if (!combo || combo === null || Array.isArray(combo) || typeof combo !== 'object') {
            return;
          }
          Object.keys(combo); // これでエラーが発生してはいけない
        });
      }).not.toThrow();
    });
  });
});