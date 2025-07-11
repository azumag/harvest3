/**
 * @fileoverview Unit tests for emergency balance fix script
 * @author Claude Code
 */

const { emergencyBalanceFix } = require('../../../scripts/emergency-balance-fix-optimized');

// Mock dependencies
jest.mock('../../../src/config', () => ({
  exchangeBB: {
    fetchBalance: jest.fn()
  }
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/database/manager', () => ({
  updateBalance: jest.fn()
}));

const { exchangeBB } = require('../../../src/config');
const { initRedisClient } = require('../../../src/database/redisClient');
const { updateBalance } = require('../../../src/database/manager');

describe('Emergency Balance Fix', () => {
  let mockRedis;
  let consoleLogSpy;
  let consoleErrorSpy;
  let consoleWarnSpy;
  let processExitSpy;

  beforeEach(() => {
    // Mock Redis client
    mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      quit: jest.fn().mockResolvedValue(true)
    };

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

    // Reset mocks
    jest.clearAllMocks();

    // Default mock implementations
    initRedisClient.mockResolvedValue(mockRedis);
    exchangeBB.fetchBalance.mockResolvedValue({
      free: { JPY: 1000 },
      total: { JPY: 1000 }
    });
    mockRedis.set.mockResolvedValue(true);
    mockRedis.get.mockResolvedValue('1000');
    updateBalance.mockResolvedValue(true);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('正常なケース', () => {
    test('残高修正処理を正常に実行できる', async () => {
      // Act
      await emergencyBalanceFix();

      // Assert
      expect(exchangeBB.fetchBalance).toHaveBeenCalledTimes(2); // 初回と検証
      expect(mockRedis.set).toHaveBeenCalledWith('balance:bitbank:JPY', '1000');
      expect(updateBalance).toHaveBeenCalledWith('bitbank', 'JPY', 1000);
      expect(mockRedis.quit).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ 残高整合性が正常に修正されました');
    });

    test('乖離が0.01未満の場合は正常と判定する', async () => {
      // Arrange
      exchangeBB.fetchBalance.mockResolvedValue({
        free: { JPY: 1000.005 },
        total: { JPY: 1000.005 }
      });
      mockRedis.get.mockResolvedValue('1000');

      // Act
      await emergencyBalanceFix();

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ 残高整合性が正常に修正されました');
    });

    test('乖離が0.01以上の場合は警告を出力する', async () => {
      // Arrange
      exchangeBB.fetchBalance.mockResolvedValue({
        free: { JPY: 1000 },
        total: { JPY: 1000 }
      });
      mockRedis.get.mockResolvedValue('950'); // 50円の乖離

      // Act
      await emergencyBalanceFix();

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith('⚠️ 残高乖離が残っています。追加確認が必要です。');
    });
  });

  describe('エラーケース', () => {
    test('取引所残高取得エラー時にプロセスを終了する', async () => {
      // Arrange
      exchangeBB.fetchBalance.mockRejectedValue(new Error('API Error'));

      // Act
      await emergencyBalanceFix();

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ 緊急修正実行エラー:', 'API Error');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('Redis接続失敗時にプロセスを終了する', async () => {
      // Arrange
      initRedisClient.mockResolvedValue(null);

      // Act
      await emergencyBalanceFix();

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ 緊急修正実行エラー:', 'Redis接続失敗');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('データベース更新エラー時は警告を出力して続行する', async () => {
      // Arrange
      updateBalance.mockRejectedValue(new Error('Database error'));

      // Act
      await emergencyBalanceFix();

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith('データベース残高更新エラー:', 'Database error');
      expect(consoleLogSpy).toHaveBeenCalledWith('データベース更新をスキップして続行します。');
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Redis残高の検証', () => {
    test('無効なRedis残高値の場合は0として扱う', async () => {
      // Arrange
      mockRedis.get.mockResolvedValue('invalid_number');

      // Act
      await emergencyBalanceFix();

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith('- 管理値:', 0, 'JPY');
    });

    test('Redis残高がnullの場合は0として扱う', async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);

      // Act
      await emergencyBalanceFix();

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith('- 管理値:', 0, 'JPY');
    });
  });
});