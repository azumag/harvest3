/**
 * Issue #998用テスト - Redis接続問題の修正
 * BalanceCheckerのRedis接続エラーハンドリングをテスト
 */

const { getBotManagedBalance, ensureRedisConnection } = require('../../../src/common/balanceChecker');

// モック設定
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  getAllPositionsRedis: jest.fn(),
  getAllTradeSummaries: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger');

describe('BalanceChecker Redis接続修正テスト (Issue #998)', () => {
  let mockRedisClient;
  let mockGetClient;
  let mockGetAllPositionsRedis;
  let mockInitRedisClient;

  beforeEach(() => {
    // モッククリア
    jest.clearAllMocks();
    
    // Redisクライアントモック
    mockRedisClient = {
      isReady: false,
      isOpen: false,
      ping: jest.fn().mockResolvedValue('PONG')
    };
    
    mockGetClient = require('../../../src/database/redisDatabase').getClient;
    mockGetAllPositionsRedis = require('../../../src/database/redisDatabase').getAllPositionsRedis;
    mockInitRedisClient = require('../../../src/database/redisClient').initRedisClient;
    
    mockGetClient.mockReturnValue(mockRedisClient);
  });

  describe('ensureRedisConnection', () => {
    test('既に接続済みの場合は何もしない', async () => {
      // 接続済み状態
      mockRedisClient.isReady = true;
      
      await ensureRedisConnection();
      
      // initRedisClientが呼ばれないことを確認
      expect(mockInitRedisClient).not.toHaveBeenCalled();
    });

    test('未接続の場合は接続を試行する', async () => {
      // 未接続状態
      mockRedisClient.isReady = false;
      
      // 初期化成功をモック
      const connectedClient = { isReady: true, ping: jest.fn().mockResolvedValue('PONG') };
      mockInitRedisClient.mockResolvedValue(connectedClient);
      
      await ensureRedisConnection();
      
      // initRedisClientが呼ばれることを確認
      expect(mockInitRedisClient).toHaveBeenCalledTimes(1);
    });

    test('接続失敗時はエラーを投げる', async () => {
      // 未接続状態
      mockRedisClient.isReady = false;
      
      // 初期化失敗をモック
      mockInitRedisClient.mockRejectedValue(new Error('接続失敗'));
      
      await expect(ensureRedisConnection()).rejects.toThrow('Redis接続エラー（3回試行後）: 接続失敗');
    });

    test('クライアントがnullの場合はエラーを投げる', async () => {
      // 未接続状態
      mockRedisClient.isReady = false;
      
      // nullクライアントをモック
      mockInitRedisClient.mockResolvedValue(null);
      
      await expect(ensureRedisConnection()).rejects.toThrow('Redis接続エラー（3回試行後）: Redis接続の初期化に失敗しました');
    });
  });

  describe('getBotManagedBalance', () => {
    test('Redis接続が確立されている場合は正常に残高を取得', async () => {
      // 接続済み状態
      mockRedisClient.isReady = true;
      
      // サンプルポジションデータ
      const samplePositions = [
        {
          side: 'buy',
          status: 'open',
          symbol: 'BTC/JPY',
          amount: 0.1
        },
        {
          side: 'buy',
          status: 'closed',
          symbol: 'ETH/JPY',
          amount: 1.0
        }
      ];
      
      mockGetAllPositionsRedis.mockResolvedValue(samplePositions);
      
      const result = await getBotManagedBalance();
      
      // 'open'状態のポジションのみが残高に含まれることを確認
      expect(result).toEqual({
        BTC: 0.1
      });
    });

    test('Redis未接続でポジションデータが空の場合はエラーを投げる', async () => {
      // 未接続状態
      mockRedisClient.isReady = false;
      mockGetClient.mockReturnValue(mockRedisClient);
      
      // 空配列を返す
      mockGetAllPositionsRedis.mockResolvedValue([]);
      
      // 接続試行失敗をモック
      mockInitRedisClient.mockRejectedValue(new Error('接続タイムアウト'));
      
      await expect(getBotManagedBalance()).rejects.toThrow('Redis接続エラー（3回試行後）: 接続タイムアウト');
    });

    test('ポジションデータが配列でない場合はエラーを投げる', async () => {
      // 接続済み状態
      mockRedisClient.isReady = true;
      
      // 不正なデータ形式を返す
      mockGetAllPositionsRedis.mockResolvedValue(null);
      
      await expect(getBotManagedBalance()).rejects.toThrow('Redisからポジションデータを取得できませんでした（データ形式エラー）');
    });

    test('Redis接続はあるがデータが空の場合は警告を出して空オブジェクトを返す', async () => {
      // 接続済み状態
      mockRedisClient.isReady = true;
      
      // 空配列を返す（正常な場合）
      mockGetAllPositionsRedis.mockResolvedValue([]);
      
      const result = await getBotManagedBalance();
      
      // 空オブジェクトが返されることを確認
      expect(result).toEqual({});
    });

    test('複数通貨のポジションが正しく集計される', async () => {
      // 接続済み状態
      mockRedisClient.isReady = true;
      
      // 複数通貨のサンプルポジション
      const samplePositions = [
        { side: 'buy', status: 'open', symbol: 'BTC/JPY', amount: 0.1 },
        { side: 'buy', status: 'open', symbol: 'BTC/JPY', amount: 0.05 },
        { side: 'buy', status: 'open', symbol: 'ETH/JPY', amount: 2.0 },
        { side: 'buy', status: 'closed', symbol: 'ETH/JPY', amount: 1.0 }, // 除外される
        { side: 'sell', status: 'open', symbol: 'LTC/JPY', amount: 5.0 }    // 除外される
      ];
      
      mockGetAllPositionsRedis.mockResolvedValue(samplePositions);
      
      const result = await getBotManagedBalance();
      
      // 買いポジションで未決済のもののみ集計されることを確認
      expect(result.BTC).toBeCloseTo(0.15, 8); // 0.1 + 0.05（浮動小数点精度を考慮）
      expect(result.ETH).toBeCloseTo(2.0, 8);   // 2.0のみ（closedは除外、sellは除外）
      expect(Object.keys(result)).toHaveLength(2);
    });
  });
});