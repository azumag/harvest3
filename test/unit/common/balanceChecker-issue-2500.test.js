/**
 * Issue #2500対応のテスト
 * strategy-runnerサービスで例外が発生した問題の修正テスト
 */

// テスト対象モジュールのモック設定
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

const mockRedisClient = {
  isReady: true,
  isOpen: true,
  keys: jest.fn(),
  hGetAll: jest.fn()
};

const mockGetRedisClient = jest.fn(() => mockRedisClient);
const mockGetAllPositionsRedis = jest.fn();
const mockPostOrderToDiscord = jest.fn();
const mockPostErrorToDiscord = jest.fn();
const mockInitRedisClient = jest.fn();

// モックの設定
jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => mockLogger);
});

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: mockGetRedisClient,
  getAllPositionsRedis: mockGetAllPositionsRedis
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: mockInitRedisClient
}));

jest.mock('../../../src/common/notifications', () => ({
  postOrderToDiscord: mockPostOrderToDiscord,
  postErrorToDiscord: mockPostErrorToDiscord
}));

jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        instance: {
          fetchBalance: jest.fn()
        }
      }
    }
  }
}));

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn((fn) => fn())
}));

// テスト対象のインポート
const balanceChecker = require('../../../src/common/balanceChecker');

describe('Issue #2500: strategy-runnerサービスで例外が発生', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // デフォルトのRedis接続状態を設定
    mockRedisClient.isReady = true;
    mockRedisClient.isOpen = true;
    mockGetRedisClient.mockReturnValue(mockRedisClient);
    mockInitRedisClient.mockResolvedValue(mockRedisClient);
  });

  describe('システム全体の残高異常検出', () => {
    test('複数通貨で90%以上の差異があるとシステム異常として検出される', async () => {
      // 取引所残高データ（正常値）
      const exchangeBalance = {
        total: {
          XYM: 235.6213,
          LTC: 0.0472,
          XRP: 0.9271,
          ETH: 0.0003,
          MONA: 1.7181
        }
      };

      // Bot管理残高データ（Redis接続問題で極端に少ない）
      const mockPositions = [
        {
          symbol: 'XYM/JPY',
          side: 'buy',
          amount: 0.4081,
          status: 'open',
          exchangeId: 'bitbank'
        },
        {
          symbol: 'LTC/JPY',
          side: 'buy',
          amount: 0,
          status: 'open',
          exchangeId: 'bitbank'
        }
      ];

      mockGetAllPositionsRedis.mockResolvedValue(mockPositions);
      
      // 取引所APIのモック
      const mockExchange = require('../../../src/config').config.exchanges.bitbank.instance;
      mockExchange.fetchBalance.mockResolvedValue(exchangeBalance);

      // バランスチェックを実行
      const result = await balanceChecker.compareBalances('bitbank');

      // システム異常が検出されることを確認
      expect(result.discrepancies).toBeDefined();
      expect(result.discrepancies.length).toBeGreaterThanOrEqual(3);
      
      // 高い差異率の通貨が複数あることを確認
      const highDiscrepancies = result.discrepancies.filter(d => d.discrepancyPercent >= 90);
      expect(highDiscrepancies.length).toBeGreaterThanOrEqual(3);

      // Discord通知が送信されることを確認
      expect(mockPostOrderToDiscord).toHaveBeenCalled();
      
      // システム異常メッセージが含まれることを確認
      const discordMessage = mockPostOrderToDiscord.mock.calls[0][0];
      expect(discordMessage).toContain('システム全体の異常が検出されました');
      expect(discordMessage).toContain('Redis接続問題またはデータ同期エラー');
    });

    test('外部取引による差異とシステム異常が区別される', async () => {
      // 単一通貨での高い差異（外部取引のパターン）
      const exchangeBalance = {
        total: {
          XYM: 235.6213,
          BTC: 0.001
        }
      };

      const mockPositions = [
        {
          symbol: 'XYM/JPY',
          side: 'buy',
          amount: 0.4081,
          status: 'open',
          exchangeId: 'bitbank'
        },
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.0009,
          status: 'open',
          exchangeId: 'bitbank'
        }
      ];

      mockGetAllPositionsRedis.mockResolvedValue(mockPositions);
      
      const mockExchange = require('../../../src/config').config.exchanges.bitbank.instance;
      mockExchange.fetchBalance.mockResolvedValue(exchangeBalance);

      const result = await balanceChecker.compareBalances('bitbank');

      // システム異常として検出されないことを確認（通貨数が少ない）
      const highDiscrepancies = result.discrepancies.filter(d => d.discrepancyPercent >= 90);
      expect(highDiscrepancies.length).toBeLessThan(3);

      // 外部取引の可能性として処理されることを確認
      const discordMessage = mockPostOrderToDiscord.mock.calls[0][0];
      expect(discordMessage).not.toContain('システム全体の異常');
    });
  });

  describe('Redis接続エラーハンドリング', () => {
    test('Redis接続は正常だが空データの場合', async () => {
      // Redis接続は正常だが、データが空の場合
      mockRedisClient.isReady = true;
      mockGetAllPositionsRedis.mockResolvedValue([]);

      const botBalance = await balanceChecker.getBotManagedBalance(true);

      expect(botBalance.balances).toEqual({});
      expect(botBalance.diagnostics.isRedisConnectionIssue).toBe(false);
      expect(botBalance.diagnostics.redisConnectionStatus).toBe('connected');
    });

    test('Redis接続エラー時のバランス比較でエラー通知が送信される', async () => {
      // Redis接続エラーをシミュレート
      mockGetAllPositionsRedis.mockRejectedValue(new Error('Redis接続が利用できません'));

      try {
        await balanceChecker.compareBalances('bitbank');
      } catch (error) {
        // エラーが投げられることを確認
        expect(error.message).toContain('Redis接続');
      }

      // Discord error通知が送信されることを確認
      expect(mockPostErrorToDiscord).toHaveBeenCalled();
      const errorMessage = mockPostErrorToDiscord.mock.calls[0][0];
      expect(errorMessage).toContain('Redis接続エラー');
      expect(errorMessage).toContain('strategy-runnerサービスとRedisサービス間の接続を確認');
    });
  });

  describe('診断メッセージの改善', () => {
    test('システム異常時の詳細な診断情報が含まれる', async () => {
      const exchangeBalance = {
        total: {
          XYM: 235.6213,
          LTC: 0.0472,
          XRP: 0.9271,
          ETH: 0.0003
        }
      };

      // 極端に少ないBot残高をシミュレート
      mockGetAllPositionsRedis.mockResolvedValue([]);
      
      const mockExchange = require('../../../src/config').config.exchanges.bitbank.instance;
      mockExchange.fetchBalance.mockResolvedValue(exchangeBalance);

      await balanceChecker.compareBalances('bitbank');

      const discordMessage = mockPostOrderToDiscord.mock.calls[0][0];
      
      // システム異常の診断情報が含まれることを確認
      expect(discordMessage).toContain('🚨 システム異常');
      expect(discordMessage).toContain('Redis接続問題またはデータ同期エラー');
      expect(discordMessage).toContain('1. Redisサービスの接続状態');
      expect(discordMessage).toContain('2. strategy-runnerサービスの再起動');
      expect(discordMessage).toContain('3. ポジションデータの整合性チェック');
    });
  });

  describe('後方互換性', () => {
    test('既存のgetBotManagedBalance()呼び出しが正常に動作する', async () => {
      const mockPositions = [
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.001,
          status: 'open',
          exchangeId: 'bitbank'
        }
      ];

      mockGetAllPositionsRedis.mockResolvedValue(mockPositions);

      // 診断情報なしの従来の呼び出し
      const botBalance = await balanceChecker.getBotManagedBalance(false);

      expect(typeof botBalance).toBe('object');
      expect(botBalance.BTC).toBe(0.001);
      // 診断情報が含まれないことを確認
      expect(botBalance.diagnostics).toBeUndefined();
    });
  });
});