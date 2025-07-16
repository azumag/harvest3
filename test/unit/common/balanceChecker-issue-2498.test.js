/**
 * balanceChecker Redis接続エラー修正のテスト (Issue #2498)
 * Redis接続エラー時の適切な例外処理を検証
 */

// Mock dependencies
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  getAllPositionsRedis: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }));
});

const { getBotManagedBalance, ensureRedisConnection } = require('../../../src/common/balanceChecker');
const { getClient, getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { initRedisClient } = require('../../../src/database/redisClient');

describe('balanceChecker Redis接続エラー処理 (Issue #2498)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureRedisConnection', () => {
    it('既に接続済みの場合は何もしない', async () => {
      // 既に接続済みのRedisクライアントを模擬
      const mockRedisClient = { isReady: true };
      getClient.mockReturnValue(mockRedisClient);
      
      await ensureRedisConnection();
      
      // initRedisClientが呼ばれていないことを確認
      expect(initRedisClient).not.toHaveBeenCalled();
    });

    it('接続が確立されていない場合は初期化を実行', async () => {
      // 未接続のRedisクライアントを模擬
      const mockRedisClient = { isReady: false };
      getClient.mockReturnValue(mockRedisClient);
      
      // 接続成功を模擬
      const mockConnectedClient = { isReady: true };
      initRedisClient.mockResolvedValue(mockConnectedClient);
      
      await ensureRedisConnection();
      
      // initRedisClientが呼ばれることを確認
      expect(initRedisClient).toHaveBeenCalledTimes(1);
    });

    it('接続失敗時に適切なエラーを投げる', async () => {
      // 未接続のRedisクライアントを模擬
      getClient.mockReturnValue(null);
      
      // 接続失敗を模擬
      const connectionError = new Error('Redis connection failed');
      initRedisClient.mockRejectedValue(connectionError);
      
      await expect(ensureRedisConnection()).rejects.toThrow('Redis接続エラー: Redis connection failed');
    });

    it('接続が初期化されたが準備完了していない場合はエラー', async () => {
      // 未接続のRedisクライアントを模擬
      getClient.mockReturnValue(null);
      
      // 接続が初期化されたが準備完了していない状態を模擬
      const mockNotReadyClient = { isReady: false };
      initRedisClient.mockResolvedValue(mockNotReadyClient);
      
      await expect(ensureRedisConnection()).rejects.toThrow('Redis接続の初期化に失敗しました');
    });
  });

  describe('getBotManagedBalance Redis接続エラー処理', () => {
    it('getAllPositionsRedisでRedis接続エラーが発生した場合の処理', async () => {
      // ensureRedisConnectionは成功
      const mockRedisClient = { isReady: true };
      getClient.mockReturnValue(mockRedisClient);
      
      // getAllPositionsRedisでRedis接続エラーが発生
      const redisError = new Error('Redis接続が利用できません');
      getAllPositionsRedis.mockRejectedValue(redisError);
      
      await expect(getBotManagedBalance()).rejects.toThrow('Redis接続エラー: Redis接続が利用できません');
    });

    it('Redis接続エラーでisRedisConnectionErrorフラグが設定される', async () => {
      // ensureRedisConnectionは成功
      const mockRedisClient = { isReady: true };
      getClient.mockReturnValue(mockRedisClient);
      
      // getAllPositionsRedisでRedis接続エラーが発生
      const redisError = new Error('Redis Connection timeout');
      getAllPositionsRedis.mockRejectedValue(redisError);
      
      try {
        await getBotManagedBalance();
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.isRedisConnectionError).toBe(true);
        expect(error.redisStatus).toBe('接続済み');
      }
    });

    it('Redis接続エラー以外の例外はそのまま再投げされる', async () => {
      // ensureRedisConnectionは成功
      const mockRedisClient = { isReady: true };
      getClient.mockReturnValue(mockRedisClient);
      
      // getAllPositionsRedisで別の種類のエラーが発生
      const otherError = new Error('Database schema error');
      getAllPositionsRedis.mockRejectedValue(otherError);
      
      try {
        await getBotManagedBalance();
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toBe('Database schema error');
        expect(error.isRedisConnectionError).toBeUndefined();
      }
    });

    it('データ形式エラーの場合は適切なエラーメッセージ', async () => {
      // ensureRedisConnectionは成功
      const mockRedisClient = { isReady: true };
      getClient.mockReturnValue(mockRedisClient);
      
      // getAllPositionsRedisが配列以外を返す（データ形式エラー）
      getAllPositionsRedis.mockResolvedValue('invalid_data');
      
      await expect(getBotManagedBalance()).rejects.toThrow('Redisからポジションデータを取得できませんでした（データ形式エラー）');
    });

    it('空のポジションデータの場合は正常に処理される', async () => {
      // ensureRedisConnectionは成功
      const mockRedisClient = { isReady: true };
      getClient.mockReturnValue(mockRedisClient);
      
      // getAllPositionsRedisが空配列を返す
      getAllPositionsRedis.mockResolvedValue([]);
      
      const result = await getBotManagedBalance();
      
      expect(result).toBeTruthy();
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('Redis接続状態の診断', () => {
    it('Redis接続がnullの場合の状態診断', async () => {
      // Redis接続がnull
      getClient.mockReturnValue(null);
      
      // getAllPositionsRedisでRedis接続エラーが発生
      const redisError = new Error('Redis接続が利用できません');
      getAllPositionsRedis.mockRejectedValue(redisError);
      
      try {
        await getBotManagedBalance();
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.redisStatus).toBe('null');
      }
    });
  });
});