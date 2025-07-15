/**
 * Issue #1018用テスト - strategy-runnerサービスBalanceCheckerエラー修正
 * Bot管理残高が0になる問題の修正をテスト
 */

const {
  getBotManagedBalance,
  getBotManagedBalanceFromMultipleSources,
  compareBalances,
  ensureRedisDataSynchronization,
  initializeBalanceChecker
} = require('../../../src/common/balanceChecker');

// モック設定
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  getAllPositionsRedis: jest.fn(),
  getAllTradeSummaries: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/database/manager', () => ({
  getTradeCurrentPosition: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger');
jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'GRT/JPY']
      }
    }
  }
}));

jest.mock('../../../src/common/strategyUtils', () => ({
  getBalanceCheckEligibleStrategies: jest.fn(() => ['MA', 'RSI'])
}));

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn()
}));

describe('BalanceChecker Issue #1018 修正テスト', () => {
  let mockRedisClient;
  let mockGetClient;
  let mockGetAllPositionsRedis;
  let mockGetAllTradeSummaries;
  let mockGetTradeCurrentPosition;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Redisクライアントモック
    mockRedisClient = {
      isReady: true,
      keys: jest.fn(),
      hgetall: jest.fn()
    };
    
    mockGetClient = require('../../../src/database/redisDatabase').getClient;
    mockGetAllPositionsRedis = require('../../../src/database/redisDatabase').getAllPositionsRedis;
    mockGetAllTradeSummaries = require('../../../src/database/redisDatabase').getAllTradeSummaries;
    mockGetTradeCurrentPosition = require('../../../src/database/manager').getTradeCurrentPosition;
    
    mockGetClient.mockReturnValue(mockRedisClient);
  });

  describe('getBotManagedBalance - 修正版テスト', () => {
    test('ポジションデータが空の場合、代替手段で残高を取得する', async () => {
      // 空のポジションデータ
      mockGetAllPositionsRedis.mockResolvedValue([]);
      
      // 代替手段のモック（MongoDB）
      mockGetTradeCurrentPosition
        .mockResolvedValueOnce(0.1) // BTC
        .mockResolvedValueOnce(2.0) // ETH
        .mockResolvedValueOnce(9.9385); // GRT
      
      // 代替手段のモック（Redis Summary）
      mockGetAllTradeSummaries.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'GRT/JPY', netPosition: 9.9 }
      ]);
      
      const result = await getBotManagedBalance();
      
      // 代替手段で取得された残高を確認
      expect(result.GRT).toBeGreaterThan(0);
    });

    test('無効なポジションデータをフィルタリングする', async () => {
      const invalidPositions = [
        // 有効なポジション
        { side: 'buy', status: 'open', symbol: 'BTC/JPY', amount: 0.1 },
        // 無効なポジション（amount=0）
        { side: 'buy', status: 'open', symbol: 'ETH/JPY', amount: 0 },
        // 無効なポジション（symbol形式不正）
        { side: 'buy', status: 'open', symbol: 'INVALID', amount: 1.0 },
        // 無効なポジション（status=closed）
        { side: 'buy', status: 'closed', symbol: 'LTC/JPY', amount: 5.0 },
        // 無効なポジション（side=sell）
        { side: 'sell', status: 'open', symbol: 'XRP/JPY', amount: 100.0 }
      ];
      
      mockGetAllPositionsRedis.mockResolvedValue(invalidPositions);
      
      const result = await getBotManagedBalance();
      
      // 有効なポジション（BTC）のみが集計されることを確認
      expect(result.BTC).toBe(0.1);
      expect(result.ETH).toBeUndefined();
      expect(result.LTC).toBeUndefined();
      expect(result.XRP).toBeUndefined();
      expect(Object.keys(result)).toHaveLength(1);
    });

    test('複数の同一通貨ポジションが正しく集計される', async () => {
      const positions = [
        { side: 'buy', status: 'open', symbol: 'GRT/JPY', amount: 5.0 },
        { side: 'buy', status: 'open', symbol: 'GRT/JPY', amount: 4.9385 },
        { side: 'buy', status: 'open', symbol: 'BTC/JPY', amount: 0.05 }
      ];
      
      mockGetAllPositionsRedis.mockResolvedValue(positions);
      
      const result = await getBotManagedBalance();
      
      // GRTの合計が正しく計算されることを確認
      expect(result.GRT).toBeCloseTo(9.9385, 4);
      expect(result.BTC).toBe(0.05);
    });
  });

  describe('getBotManagedBalanceFromMultipleSources テスト', () => {
    test('MongoDB と Redis Summary の残高を統合する', async () => {
      // MongoDBからの残高
      mockGetTradeCurrentPosition
        .mockResolvedValueOnce(0.1) // BTC from MA strategy
        .mockResolvedValueOnce(0.05) // BTC from RSI strategy
        .mockResolvedValueOnce(2.0) // ETH from MA strategy
        .mockResolvedValueOnce(0) // ETH from RSI strategy
        .mockResolvedValueOnce(9.0) // GRT from MA strategy
        .mockResolvedValueOnce(0); // GRT from RSI strategy
      
      // Redis Summaryからの残高
      mockGetAllTradeSummaries.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', netPosition: 0.12 },
        { exchange: 'bitbank', symbol: 'GRT/JPY', netPosition: 9.9385 },
        { exchange: 'bitbank', symbol: 'AXS/JPY', netPosition: 0.1488 }
      ]);
      
      const result = await getBotManagedBalanceFromMultipleSources();
      
      // より大きい値が採用されることを確認
      expect(result.BTC).toBeCloseTo(0.15, 8); // MongoDB合計: 0.15
      expect(result.ETH).toBe(2.0); // MongoDB: 2.0, Redis: なし
      expect(result.GRT).toBeCloseTo(9.9385, 4); // Redis: 9.9385が大きい
      expect(result.AXS).toBeCloseTo(0.1488, 4); // Redisのみ
    });
  });

  describe('ensureRedisDataSynchronization テスト', () => {
    test('Redis内のデータ存在を確認する', async () => {
      mockRedisClient.keys
        .mockResolvedValueOnce(['position:1', 'position:2']) // position keys
        .mockResolvedValueOnce(['summary:BTC', 'summary:ETH']); // summary keys
      
      mockRedisClient.hgetall.mockResolvedValue({
        symbol: 'BTC/JPY',
        side: 'buy',
        amount: '0.1'
      });
      
      const result = await ensureRedisDataSynchronization();
      
      expect(result).toBe(true);
      expect(mockRedisClient.keys).toHaveBeenCalledWith('position:*');
      expect(mockRedisClient.keys).toHaveBeenCalledWith('summary:*');
    });

    test('データが存在しない場合はfalseを返す', async () => {
      mockRedisClient.keys
        .mockResolvedValueOnce([]) // position keys (empty)
        .mockResolvedValueOnce([]); // summary keys (empty)
      
      const result = await ensureRedisDataSynchronization();
      
      expect(result).toBe(false);
    });

    test('不正なデータ形式の場合はfalseを返す', async () => {
      mockRedisClient.keys
        .mockResolvedValueOnce(['position:1']) // position keys
        .mockResolvedValueOnce([]); // summary keys
      
      // 不正なポジションデータ
      mockRedisClient.hgetall.mockResolvedValue({
        // symbolがない不正なデータ
        side: 'buy',
        amount: '0.1'
      });
      
      const result = await ensureRedisDataSynchronization();
      
      expect(result).toBe(false);
    });
  });

  describe('initializeBalanceChecker テスト', () => {
    test('正常な初期化プロセス', async () => {
      mockRedisClient.keys
        .mockResolvedValueOnce(['position:1'])
        .mockResolvedValueOnce(['summary:1']);
      
      mockRedisClient.hgetall.mockResolvedValue({
        symbol: 'BTC/JPY',
        side: 'buy',
        amount: '0.1'
      });
      
      await expect(initializeBalanceChecker()).resolves.not.toThrow();
    });

    test('Redis接続エラー時は適切にエラーを投げる', async () => {
      mockGetClient.mockReturnValue(null);
      
      await expect(initializeBalanceChecker()).rejects.toThrow('BalanceChecker 初期化失敗');
    });
  });

  describe('compareBalances - 修正版統合テスト', () => {
    test('Bot残高が空の場合の代替手段実行', async () => {
      // 取引所残高のモック
      const mockWithBitbankErrorHandling = require('../../../src/common/bitbankErrorHandler').withBitbankErrorHandling;
      mockWithBitbankErrorHandling.mockResolvedValue({
        total: { GRT: 9.9385, BTC: 0.1 }
      });
      
      // 最初はポジションデータが空
      mockGetAllPositionsRedis.mockResolvedValue([]);
      
      // 代替手段でのデータ
      mockGetTradeCurrentPosition
        .mockResolvedValue(0.1) // BTC
        .mockResolvedValue(9.9); // GRT
      
      mockGetAllTradeSummaries.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'GRT/JPY', netPosition: 9.9385 }
      ]);
      
      // Redis同期確認用
      mockRedisClient.keys
        .mockResolvedValueOnce(['position:1'])
        .mockResolvedValueOnce(['summary:1']);
      
      mockRedisClient.hgetall.mockResolvedValue({
        symbol: 'BTC/JPY',
        side: 'buy'
      });
      
      const result = await compareBalances('bitbank');
      
      // 代替手段が実行されて不整合が検出されることを確認
      expect(result.discrepancies.length).toBeGreaterThan(0);
      
      // 具体的な不整合内容を確認
      const grtDiscrepancy = result.discrepancies.find(d => d.currency === 'GRT');
      expect(grtDiscrepancy).toBeDefined();
      expect(grtDiscrepancy.exchangeAmount).toBe(9.9385);
      expect(grtDiscrepancy.botAmount).toBeGreaterThan(0); // 代替手段で取得
    });
  });

  describe('レグレッションテスト - 既存機能の維持', () => {
    test('正常なポジションデータがある場合は従来通り動作する', async () => {
      const normalPositions = [
        { side: 'buy', status: 'open', symbol: 'BTC/JPY', amount: 0.1 },
        { side: 'buy', status: 'open', symbol: 'ETH/JPY', amount: 2.0 }
      ];
      
      mockGetAllPositionsRedis.mockResolvedValue(normalPositions);
      
      const result = await getBotManagedBalance();
      
      expect(result.BTC).toBe(0.1);
      expect(result.ETH).toBe(2.0);
      expect(Object.keys(result)).toHaveLength(2);
    });

    test('エラーハンドリングが適切に動作する', async () => {
      mockGetAllPositionsRedis.mockRejectedValue(new Error('Redis connection lost'));
      
      await expect(getBotManagedBalance()).rejects.toThrow('Redis connection lost');
    });
  });
});