/**
 * Issue #5755: Redis接続チェックテストの統合テスト
 * 実際のRedisクライアントライブラリとの互換性テスト
 * Redis接続状態の実際の遷移をテスト
 */

const Redis = require('redis');
const { validateRedisClientConnection, executeRedisTransactionWithTimeout } = require('../../src/database/manager');

// テスト用Logger実装
class TestLogger {
  constructor() {
    this.logs = { info: [], warn: [], error: [], debug: [] };
  }
  
  info(message) { this.logs.info.push(message); }
  warn(message) { this.logs.warn.push(message); }
  error(message) { this.logs.error.push(message); }
  debug(message) { this.logs.debug.push(message); }
  
  clear() {
    this.logs = { info: [], warn: [], error: [], debug: [] };
  }
}

describe('Issue #5755: Redis接続チェック統合テスト', () => {
  let redisClient;
  let logger;
  let redisAvailable = false;
  
  beforeAll(async () => {
    try {
      // CI環境のRedisに接続（短いタイムアウト）
      const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
      redisClient = Redis.createClient({ 
        url: redisUrl,
        socket: {
          connectTimeout: 5000, // 5秒タイムアウト
          lazyConnect: true
        }
      });
      
      redisClient.on('error', (err) => {
        console.warn('Redis接続エラー（統合テスト用）:', err.message);
      });
      
      await redisClient.connect();
      redisAvailable = true;
      console.log('Redis統合テスト: 接続成功');
    } catch (error) {
      console.warn('Redis統合テスト: 接続失敗、テストをスキップします:', error.message);
      redisAvailable = false;
    }
  });
  
  afterAll(async () => {
    if (redisClient) {
      await redisClient.quit();
    }
  });
  
  beforeEach(() => {
    logger = new TestLogger();
  });
  
  describe('実際のRedisクライアントライブラリとの互換性テスト', () => {
    test('正常なRedis接続でvalidateRedisClientConnectionが成功する', async () => {
      if (!redisAvailable) {
        console.log('Redis利用不可のためテストをスキップ');
        return;
      }
      
      const result = await validateRedisClientConnection(redisClient, '統合テスト', logger);
      
      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });
      
      // エラーログが出力されていないことを確認
      expect(logger.logs.error).toHaveLength(0);
    });
    
    test('実際のPINGコマンドが正常に動作する', async () => {
      if (!redisAvailable) {
        console.log('Redis利用不可のためテストをスキップ');
        return;
      }
      
      const pingResult = await redisClient.ping();
      expect(pingResult).toBe('PONG');
    });
    
    test('実際のRedisトランザクションが正常に実行される', async () => {
      if (!redisAvailable) {
        console.log('Redis利用不可のためテストをスキップ');
        return;
      }
      const multi = redisClient.multi();
      multi.set('test:key1', 'value1');
      multi.set('test:key2', 'value2');
      multi.del('test:key1', 'test:key2');
      
      const testTrade = {
        tradeId: 'INTEGRATION_TEST_001',
        exchange: 'test',
        symbol: 'BTC/JPY',
        strategy: 'INTEGRATION_TEST'
      };
      
      const commandNames = ['set', 'set', 'del'];
      
      const results = await executeRedisTransactionWithTimeout(
        multi,
        commandNames,
        testTrade,
        logger
      );
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual([null, 'OK']);
      expect(results[1]).toEqual([null, 'OK']);
      expect(results[2][0]).toBeNull(); // エラーなし
    });
  });
  
  describe('Redis接続状態の実際の遷移テスト', () => {
    test('Redis接続の切断と再接続が正しく検出される', async () => {
      // 一時的にクライアントを切断
      await redisClient.disconnect();
      
      // 切断状態でのvalidateRedisClientConnectionテスト
      await expect(
        validateRedisClientConnection(redisClient, '切断状態テスト', logger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      // エラーログが出力されることを確認
      expect(logger.logs.error.length).toBeGreaterThan(0);
      
      // 再接続
      await redisClient.connect();
      
      // 再接続後の正常状態を確認
      logger.clear();
      const result = await validateRedisClientConnection(redisClient, '再接続後テスト', logger);
      
      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });
      
      expect(logger.logs.error).toHaveLength(0);
    });
  });
  
  describe('エラー処理の詳細テスト', () => {
    test('無効なクライアントオブジェクトでエラーが正しく処理される', async () => {
      await expect(
        validateRedisClientConnection(null, 'null クライアントテスト', logger)
      ).rejects.toThrow('Redis Commit失敗: null クライアントテスト時にクライアントが存在しません');
      
      expect(logger.logs.error).toContainEqual(
        expect.stringContaining('null クライアントテスト失敗: クライアントオブジェクトがnull/undefined')
      );
    });
    
    test('undefined プロパティを持つクライアントモックでエラーハンドリングが動作する', async () => {
      const mockClient = {
        isReady: undefined,
        isOpen: undefined,
        status: 'ready',
        ping: jest.fn().mockRejectedValue(new Error('Connection failed'))
      };
      
      await expect(
        validateRedisClientConnection(mockClient, 'undefined プロパティテスト', logger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      // undefined値検出の警告ログが出力されることを確認
      expect(logger.logs.warn).toContainEqual(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
    });
    
    test('混在状態（一方がundefined）の適切な処理', async () => {
      const mockClient = {
        isReady: true,
        isOpen: undefined,
        status: 'ready',
        ping: jest.fn().mockRejectedValue(new Error('Partial undefined test'))
      };
      
      await expect(
        validateRedisClientConnection(mockClient, '混在状態テスト', logger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      // PINGテスト実行の警告ログが出力されることを確認
      expect(logger.logs.warn).toContainEqual(
        expect.stringContaining('PINGテストで実際の接続状態を確認')
      );
    });
  });
  
  describe('実際のRedis操作エラーテスト', () => {
    test('無効なRedisコマンドでエラーが適切に処理される', async () => {
      const multi = redisClient.multi();
      
      // 意図的に無効なコマンドを追加（存在しないキーに対するincr）
      multi.set('test:invalid', 'not_a_number');
      multi.incrBy('test:invalid', 1); // 文字列に対する数値操作でエラー
      
      const testTrade = {
        tradeId: 'ERROR_TEST_001',
        exchange: 'test',
        symbol: 'BTC/JPY',
        strategy: 'ERROR_TEST'
      };
      
      const commandNames = ['set', 'incrBy'];
      
      try {
        await executeRedisTransactionWithTimeout(
          multi,
          commandNames,
          testTrade,
          logger
        );
      } catch (error) {
        expect(error.message).toContain('Redis Commit失敗');
      }
      
      // クリーンアップ
      await redisClient.del('test:invalid');
    });
  });
  
  describe('Circuit Breaker統合テスト', () => {
    test('実際のRedisエラーでCircuit Breakerが動作する', async () => {
      // Circuit Breaker のモック（最小限）
      jest.doMock('../../src/database/redisClient', () => ({
        isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
        updateCircuitBreakerOnFailure: jest.fn(),
        updateCircuitBreakerOnSuccess: jest.fn(),
        getCircuitBreakerStatus: jest.fn().mockReturnValue({
          isOpen: false,
          timeSinceLastFailure: 0
        })
      }));
      
      const { updateCircuitBreakerOnFailure } = require('../../src/database/redisClient');
      
      // 無効な接続でテスト
      const invalidClient = {
        isReady: false,
        isOpen: false,
        status: 'disconnected'
      };
      
      const multi = {
        client: invalidClient,
        exec: jest.fn().mockRejectedValue(new Error('Connection failed'))
      };
      
      const testTrade = {
        tradeId: 'CIRCUIT_BREAKER_TEST',
        exchange: 'test',
        symbol: 'BTC/JPY',
        strategy: 'CIRCUIT_BREAKER_TEST'
      };
      
      await expect(
        executeRedisTransactionWithTimeout(multi, ['test'], testTrade, logger)
      ).rejects.toThrow();
      
      // Circuit Breaker の失敗カウントが呼ばれることを確認
      expect(updateCircuitBreakerOnFailure).toHaveBeenCalled();
    });
  });
});