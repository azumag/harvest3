/**
 * redisDatabase.js の取引サマリー機能のテスト
 * t-wada流TDDアプローチ
 */

const { createClient } = require('redis');

// モックの設定
const mockClient = {
  connect: jest.fn(),
  quit: jest.fn(),
  keys: jest.fn(),
  hGetAll: jest.fn(),
  del: jest.fn(),
  hSet: jest.fn(),
  exists: jest.fn(),
  hIncrByFloat: jest.fn(),
  hGet: jest.fn(),
  on: jest.fn() // redisClient.jsで使用されるイベントリスナー用
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockClient)
}));

// redisClient.jsもモック化
jest.mock('../../../src/database/redisClient', () => ({
  client: mockClient,
  initRedisClient: jest.fn()
}));

// テスト対象をインポート
const { getAllTradeSummaries, updateTradeSummary } = require('../../../src/database/redisDatabase');

describe('redisDatabase - 取引サマリー機能', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllTradeSummaries', () => {
    describe('🔴 Red: Redisキーの解析が正しく行われること', () => {
      it('正しいキー形式から正しくフィールドを抽出すること', async () => {
        // Arrange: テストデータの準備
        const testKey = 'summary:trade:bitbank:BTC/JPY:trendFollowing';
        const testSummaryData = {
          buyAmount: '0.001',
          sellAmount: '0',
          totalBuyCost: '15000',
          totalSellValue: '0',
          netPosition: '0.001',
          totalFee: '15',
          realizedPnL: '0',
          createdAt: '1750884919895',
          updatedAt: '1750884919895'
        };

        mockClient.keys.mockResolvedValue([testKey]);
        mockClient.hGetAll.mockResolvedValue(testSummaryData);

        // Act: テスト実行
        const result = await getAllTradeSummaries();

        // Assert: 期待される結果を検証
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          exchangeId: 'bitbank',          // keyParts[2]
          symbol: 'BTC/JPY',               // keyParts[3]
          strategyKey: 'trendFollowing',   // keyParts[4]
          buyAmount: 0.001,
          sellAmount: 0,
          totalBuyCost: 15000,
          totalSellValue: 0,
          netPosition: 0.001,
          totalFee: 15,
          realizedPnL: 0
        });
      });

      it('修正された形式のキーから正しくフィールドを抽出すること', async () => {
        // Arrange: 修正された正しい形式のキー
        const correctKey = 'summary:trade:bitbank:ATOM/JPY:MUTUAL_INFO';
        const testSummaryData = {
          buyAmount: '0.307',
          sellAmount: '0.4604',
          totalBuyCost: '178.0947551',
          totalSellValue: '0',
          netPosition: '-0.1534',
          totalFee: '0.2856',
          realizedPnL: '0'
        };

        mockClient.keys.mockResolvedValue([correctKey]);
        mockClient.hGetAll.mockResolvedValue(testSummaryData);

        // Act: テスト実行
        const result = await getAllTradeSummaries();

        // Assert: 修正された実装で正しく解析されることを確認
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          exchangeId: 'bitbank',      // 正しく解析される
          symbol: 'ATOM/JPY',         // 正しく解析される
          strategyKey: 'MUTUAL_INFO'  // 正しく解析される
        });
      });
    });

    describe('🟢 Green: 複数のサマリーデータを正しく処理すること', () => {
      it('複数の取引サマリーを正しく返すこと', async () => {
        // Arrange
        const testKeys = [
          'summary:trade:bitbank:BTC/JPY:trendFollowing',
          'summary:trade:bitbank:ETH/JPY:mutualInformation',
          'summary:trade:binance:BTC/USDT:scalping'
        ];
        
        const summaryData1 = {
          buyAmount: '0.001',
          sellAmount: '0',
          totalBuyCost: '15000',
          totalSellValue: '0',
          netPosition: '0.001',
          totalFee: '15',
          realizedPnL: '0'
        };

        const summaryData2 = {
          buyAmount: '0.01',
          sellAmount: '0.005',
          totalBuyCost: '3600',
          totalSellValue: '1900',
          netPosition: '0.005',
          totalFee: '5.5',
          realizedPnL: '100'
        };

        const summaryData3 = {
          buyAmount: '0.0001',
          sellAmount: '0.0001',
          totalBuyCost: '6.5',
          totalSellValue: '6.8',
          netPosition: '0',
          totalFee: '0.013',
          realizedPnL: '0.287'
        };

        mockClient.keys.mockResolvedValue(testKeys);
        mockClient.hGetAll
          .mockResolvedValueOnce(summaryData1)
          .mockResolvedValueOnce(summaryData2)
          .mockResolvedValueOnce(summaryData3);

        // Act
        const result = await getAllTradeSummaries();

        // Assert
        expect(result).toHaveLength(3);
        
        expect(result[0]).toMatchObject({
          exchangeId: 'bitbank',
          symbol: 'BTC/JPY',
          strategyKey: 'trendFollowing'
        });
        
        expect(result[1]).toMatchObject({
          exchangeId: 'bitbank',
          symbol: 'ETH/JPY',
          strategyKey: 'mutualInformation'
        });
        
        expect(result[2]).toMatchObject({
          exchangeId: 'binance',
          symbol: 'BTC/USDT',
          strategyKey: 'scalping'
        });
      });
    });

    describe('🔵 Refactor: エッジケースの処理', () => {
      it('無効なキーをスキップすること', async () => {
        // Arrange
        const testKeys = [
          'summary:trade:undefined:undefined:undefined',
          'summary:trade:bitbank:BTC/JPY:trendFollowing',
          'summary:trade::BTC/JPY:strategy',  // 空の取引所
          'summary:trade:exchange::strategy'   // 空のシンボル
        ];

        const validSummaryData = {
          buyAmount: '0.001',
          sellAmount: '0',
          totalBuyCost: '15000',
          totalSellValue: '0',
          netPosition: '0.001',
          totalFee: '15',
          realizedPnL: '0'
        };

        mockClient.keys.mockResolvedValue(testKeys);
        mockClient.hGetAll.mockResolvedValue(validSummaryData);

        // Act
        const result = await getAllTradeSummaries();

        // Assert: 有効なキーのみが処理されることを確認
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          exchangeId: 'bitbank',
          symbol: 'BTC/JPY',
          strategyKey: 'trendFollowing'
        });
      });

      it('空のサマリーデータをスキップすること', async () => {
        // Arrange
        const testKeys = [
          'summary:trade:bitbank:BTC/JPY:trendFollowing',
          'summary:trade:bitbank:ETH/JPY:mutualInformation'
        ];

        mockClient.keys.mockResolvedValue(testKeys);
        mockClient.hGetAll
          .mockResolvedValueOnce({})  // 空のデータ
          .mockResolvedValueOnce({    // 有効なデータ
            buyAmount: '0.01',
            sellAmount: '0',
            totalBuyCost: '3600',
            totalSellValue: '0',
            netPosition: '0.01',
            totalFee: '3.6',
            realizedPnL: '0'
          });

        // Act
        const result = await getAllTradeSummaries();

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('ETH/JPY');
      });
    });
  });

  describe('updateTradeSummary', () => {
    describe('🔴 Red: 新規サマリーの作成', () => {
      it('新しい買い注文でサマリーを作成すること', async () => {
        // Arrange
        const trade = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'trendFollowing',
          side: 'buy',
          amount: 0.001,
          price: 15000000,
          value: 15000,
          fee: 15,
          timestamp: Date.now(),
          tradeId: 'test-trade-1',
          orderId: 'test-order-1'
        };

        mockClient.exists.mockResolvedValue(false);

        // Act
        await updateTradeSummary(trade);

        // Assert
        const expectedKey = 'summary:trade:bitbank:BTC/JPY:trendFollowing';
        expect(mockClient.hSet).toHaveBeenCalledWith(
          expectedKey,
          expect.objectContaining({
            buyAmount: 0,
            sellAmount: 0,
            totalBuyCost: 0,
            totalSellValue: 0,
            netPosition: 0,
            totalFee: 0,
            realizedPnL: 0
          })
        );

        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'buyAmount', 0.001);
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'totalBuyCost', 15000);
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'netPosition', 0.001);
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'totalFee', 15);
      });
    });

    describe('🟢 Green: 既存サマリーの更新', () => {
      it('売り注文でサマリーを更新すること', async () => {
        // Arrange
        const trade = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'trendFollowing',
          side: 'sell',
          amount: 0.0005,
          price: 16000000,
          value: 8000,
          fee: 8,
          timestamp: Date.now(),
          tradeId: 'test-trade-2',
          orderId: 'test-order-2'
        };

        mockClient.exists.mockResolvedValue(true);
        mockClient.hGet
          .mockResolvedValueOnce('0.001')     // buyAmount
          .mockResolvedValueOnce('15000');    // totalBuyCost

        // Act
        await updateTradeSummary(trade);

        // Assert
        const expectedKey = 'summary:trade:bitbank:BTC/JPY:trendFollowing';
        
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'sellAmount', 0.0005);
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'totalSellValue', 8000);
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'netPosition', -0.0005);
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'totalFee', 8);
        
        // 実現損益の計算: (売値 - 平均買値) * 売却量 = (16000000 - 15000000) * 0.0005 = 500
        expect(mockClient.hIncrByFloat).toHaveBeenCalledWith(expectedKey, 'realizedPnL', 500);
      });
    });
  });
});