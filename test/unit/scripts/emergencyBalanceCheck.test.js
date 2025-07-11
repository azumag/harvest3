/**
 * @fileoverview Unit tests for emergency balance check script
 * @author Claude Code
 */

const { emergencyBalanceCheck } = require('../../../scripts/emergency-balance-check-optimized');

// Mock dependencies
jest.mock('../../../src/config', () => ({
  exchangeBB: {
    fetchBalance: jest.fn()
  }
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

const { exchangeBB } = require('../../../src/config');
const { initRedisClient } = require('../../../src/database/redisClient');

describe('Emergency Balance Check', () => {
  let mockRedis;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    // Mock Redis client
    mockRedis = {
      get: jest.fn(),
      scan: jest.fn(),
      quit: jest.fn().mockResolvedValue(true)
    };

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Reset mocks
    jest.clearAllMocks();

    // Default mock implementations
    initRedisClient.mockResolvedValue(mockRedis);
    exchangeBB.fetchBalance.mockResolvedValue({
      free: { JPY: 1000 },
      total: { JPY: 1000 }
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('正常なケース', () => {
    test('取引所残高とRedis残高を正常に取得できる', async () => {
      // Arrange
      mockRedis.get.mockResolvedValue('1000');
      mockRedis.scan.mockResolvedValue(['0', []]);

      // Act
      await emergencyBalanceCheck();

      // Assert
      expect(exchangeBB.fetchBalance).toHaveBeenCalledTimes(1);
      expect(mockRedis.get).toHaveBeenCalledWith('balance:bitbank:JPY');
      expect(mockRedis.quit).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('=== 残高整合性緊急チェック ===');
    });

    test('ポジション情報を正常に取得できる', async () => {
      // Arrange
      mockRedis.get.mockResolvedValueOnce('1000'); // balance
      mockRedis.scan.mockResolvedValue(['0', ['position:test:JPY']]);
      mockRedis.get.mockResolvedValueOnce('{"amount": 100}'); // position data

      // Act
      await emergencyBalanceCheck();

      // Assert
      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'position:*:JPY', 'COUNT', 100);
      expect(consoleLogSpy).toHaveBeenCalledWith('JPYポジション数:', 1);
    });
  });

  describe('エラーケース', () => {
    test('取引所残高取得エラー時にエラーログを出力する', async () => {
      // Arrange
      exchangeBB.fetchBalance.mockRejectedValue(new Error('API Error'));
      mockRedis.get.mockResolvedValue('1000');
      mockRedis.scan.mockResolvedValue(['0', []]);

      // Act
      await emergencyBalanceCheck();

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith('取引所残高取得エラー:', 'API Error');
      expect(mockRedis.quit).toHaveBeenCalledTimes(1);
    });

    test('Redis接続失敗時にエラーログを出力する', async () => {
      // Arrange
      initRedisClient.mockRejectedValue(new Error('Redis connection failed'));

      // Act
      await emergencyBalanceCheck();

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith('Redis残高取得エラー:', 'Redis connection failed');
    });

    test('Redis接続がnullの場合に適切なメッセージを出力する', async () => {
      // Arrange
      initRedisClient.mockResolvedValue(null);

      // Act
      await emergencyBalanceCheck();

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith('Redis接続失敗');
      expect(consoleLogSpy).toHaveBeenCalledWith('Redis接続なし - ポジション確認不可');
    });
  });

  describe('環境設定', () => {
    test('POSITION_CHECK_LIMIT環境変数を使用する', async () => {
      // Arrange
      process.env.POSITION_CHECK_LIMIT = '50';
      mockRedis.get.mockResolvedValue('1000');
      mockRedis.scan.mockResolvedValue(['0', new Array(100).fill('position:test:JPY')]);

      // Act
      await emergencyBalanceCheck();

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith('ポジション合計 JPY (最初の50件):', 0);

      // Clean up
      delete process.env.POSITION_CHECK_LIMIT;
    });
  });
});