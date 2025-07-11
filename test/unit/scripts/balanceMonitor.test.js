/**
 * @fileoverview Unit tests for balance monitor script
 * @author Claude Code
 */

const { balanceMonitor } = require('../../../scripts/balance-monitor-optimized');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

// Mock dependencies
jest.mock('../../../src/config', () => ({
  exchangeBB: {
    fetchBalance: jest.fn()
  }
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('fs');
jest.mock('https');

const { exchangeBB } = require('../../../src/config');
const { initRedisClient } = require('../../../src/database/redisClient');

describe('Balance Monitor', () => {
  let mockRedis;
  let consoleLogSpy;
  let consoleErrorSpy;
  let consoleWarnSpy;
  let processExitSpy;
  let mockHttpsRequest;

  beforeEach(() => {
    // Mock Redis client
    mockRedis = {
      get: jest.fn(),
      quit: jest.fn().mockResolvedValue(true)
    };

    // Mock HTTPS request
    mockHttpsRequest = {
      on: jest.fn().mockReturnThis(),
      end: jest.fn()
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
    mockRedis.get.mockResolvedValue('1000');
    fs.appendFileSync.mockImplementation(() => {});
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 1000 });
    fs.readFileSync.mockReturnValue('line1\nline2\nline3');
    fs.writeFileSync.mockImplementation(() => {});
    https.request.mockReturnValue(mockHttpsRequest);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    processExitSpy.mockRestore();
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  describe('正常なケース', () => {
    test('乖離が閾値以下の場合は正常ログを出力する', async () => {
      // Arrange
      exchangeBB.fetchBalance.mockResolvedValue({
        free: { JPY: 1000.5 },
        total: { JPY: 1000.5 }
      });
      mockRedis.get.mockResolvedValue('1000');

      // Act
      await balanceMonitor();

      // Assert
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        '/tmp/balance-monitor.log',
        expect.stringContaining('残高整合性OK: 乖離')
      );
      expect(mockRedis.quit).toHaveBeenCalledTimes(1);
    });

    test('乖離が閾値を超える場合はアラートを出力する', async () => {
      // Arrange
      exchangeBB.fetchBalance.mockResolvedValue({
        free: { JPY: 1000 },
        total: { JPY: 1000 }
      });
      mockRedis.get.mockResolvedValue('998'); // 2円の乖離

      // Act
      await balanceMonitor();

      // Assert
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        '/tmp/balance-alert.log',
        expect.stringContaining('残高乖離検出: 2.0000 JPY')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('残高乖離アラート: 2.0000 JPY');
    });
  });

  describe('Discord通知', () => {
    test('有効なDiscord webhook URLで通知を送信する', async () => {
      // Arrange
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';
      exchangeBB.fetchBalance.mockResolvedValue({
        free: { JPY: 1000 },
        total: { JPY: 1000 }
      });
      mockRedis.get.mockResolvedValue('995'); // 5円の乖離

      // Act
      await balanceMonitor();

      // Assert
      expect(https.request).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }),
        expect.any(Function)
      );
      expect(mockHttpsRequest.end).toHaveBeenCalledWith(
        expect.stringContaining('🚨 **残高乖離アラート**')
      );
    });

    test('無効なDiscord webhook URLの場合は警告を出力する', async () => {
      // Arrange
      process.env.DISCORD_WEBHOOK_URL = 'https://invalid.url/webhook';
      exchangeBB.fetchBalance.mockResolvedValue({
        free: { JPY: 1000 },
        total: { JPY: 1000 }
      });
      mockRedis.get.mockResolvedValue('995'); // 5円の乖離

      // Act
      await balanceMonitor();

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith('Invalid Discord webhook URL format');
      expect(https.request).not.toHaveBeenCalled();
    });

    test('Discord通知エラー時は警告を出力して続行する', async () => {
      // Arrange
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';
      exchangeBB.fetchBalance.mockResolvedValue({
        free: { JPY: 1000 },
        total: { JPY: 1000 }
      });
      mockRedis.get.mockResolvedValue('995'); // 5円の乖離

      // Mock error in Discord request
      mockHttpsRequest.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Network error'));
        }
        return mockHttpsRequest;
      });

      // Act
      await balanceMonitor();

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith('Discord通知エラー:', 'Network error');
    });
  });

  describe('ログファイルローテーション', () => {
    test('ログファイルが1000行を超えた場合はローテーションする', async () => {
      // Arrange
      fs.readFileSync.mockReturnValue(new Array(1001).fill('line').join('\n'));

      // Act
      await balanceMonitor();

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/balance-monitor.log',
        expect.any(String)
      );
    });

    test('ログファイルが1000行以下の場合はローテーションしない', async () => {
      // Arrange
      fs.readFileSync.mockReturnValue(new Array(500).fill('line').join('\n'));

      // Act
      await balanceMonitor();

      // Assert
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('エラーケース', () => {
    test('取引所残高取得エラー時にプロセスを終了する', async () => {
      // Arrange
      exchangeBB.fetchBalance.mockRejectedValue(new Error('API Error'));

      // Act
      await balanceMonitor();

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith('残高監視エラー:', 'API Error');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('Redis接続失敗時でも処理を継続する', async () => {
      // Arrange
      initRedisClient.mockResolvedValue(null);

      // Act
      await balanceMonitor();

      // Assert
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        '/tmp/balance-monitor.log',
        expect.stringContaining('管理残高: 0 JPY')
      );
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });
});