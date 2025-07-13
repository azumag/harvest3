const { UnifiedErrorHandler, unifiedErrorHandler } = require('../../../src/common/errorHandler');

// Mock DiscordRateLimiter
jest.mock('../../../src/common/discordRateLimiter', () => ({
  send: jest.fn(),
  cleanup: jest.fn(),
  getStats: jest.fn(() => ({
    totalWebhooks: 1,
    totalPendingNotifications: 0,
    totalDeduplicatedHashes: 0,
    webhookStats: {}
  }))
}));

// Mock notifications
jest.mock('../../../src/common/notifications', () => ({
  discordErrorWebhookUrl: 'https://discord.com/api/webhooks/test'
}));

const rateLimiter = require('../../../src/common/discordRateLimiter');
const crypto = require('crypto');

describe('UnifiedErrorHandler', () => {
  let handler;

  beforeEach(() => {
    handler = new UnifiedErrorHandler();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct severity levels', () => {
      expect(handler.severityLevels).toEqual({
        CRITICAL: 1,
        WARNING: 2,
        INFO: 3
      });
    });

    it('should initialize with correct emojis', () => {
      expect(handler.severityEmojis).toEqual({
        CRITICAL: '🚨',
        WARNING: '⚠️',
        INFO: 'ℹ️'
      });
    });

    it('should initialize with correct deduplication windows', () => {
      expect(handler.severityDeduplicationWindows).toEqual({
        CRITICAL: 1800000, // 30分
        WARNING: 3600000,  // 1時間
        INFO: 7200000      // 2時間
      });
    });
  });

  describe('determineSeverity', () => {
    it('should classify database errors as CRITICAL', () => {
      expect(handler.determineSeverity('Database connection failed')).toBe('CRITICAL');
      expect(handler.determineSeverity('MongoDB error occurred')).toBe('CRITICAL');
      expect(handler.determineSeverity('Redis connection timeout')).toBe('CRITICAL');
    });

    it('should classify authentication errors as CRITICAL', () => {
      expect(handler.determineSeverity('Authentication failed')).toBe('CRITICAL');
      expect(handler.determineSeverity('Auth token expired')).toBe('CRITICAL');
    });

    it('should classify trading-related errors as CRITICAL', () => {
      expect(handler.determineSeverity('Order execution failed')).toBe('CRITICAL');
      expect(handler.determineSeverity('Balance mismatch detected')).toBe('CRITICAL');
      expect(handler.determineSeverity('Position error', 'trading')).toBe('CRITICAL');
    });

    it('should classify rate limit errors as WARNING', () => {
      expect(handler.determineSeverity('Rate limit exceeded')).toBe('WARNING');
      expect(handler.determineSeverity('HTTP 429 error')).toBe('WARNING');
      expect(handler.determineSeverity('API timeout')).toBe('WARNING');
    });

    it('should classify network errors as WARNING', () => {
      expect(handler.determineSeverity('Network timeout')).toBe('WARNING');
      expect(handler.determineSeverity('API call failed', 'network')).toBe('WARNING');
    });

    it('should classify unknown errors as INFO', () => {
      expect(handler.determineSeverity('Unknown error')).toBe('INFO');
      expect(handler.determineSeverity('General message')).toBe('INFO');
    });

    it('should use context for classification', () => {
      expect(handler.determineSeverity('Error occurred', 'trading')).toBe('CRITICAL');
      expect(handler.determineSeverity('Error occurred', 'api')).toBe('WARNING');
      expect(handler.determineSeverity('Error occurred', 'general')).toBe('INFO');
    });
  });

  describe('generateDeduplicationKey', () => {
    it('should generate consistent hash for same error', () => {
      const error = new Error('Test error');
      const key1 = handler.generateDeduplicationKey(error, 'context');
      const key2 = handler.generateDeduplicationKey(error, 'context');
      expect(key1).toBe(key2);
    });

    it('should generate different hash for different contexts', () => {
      const error = new Error('Test error');
      const key1 = handler.generateDeduplicationKey(error, 'context1');
      const key2 = handler.generateDeduplicationKey(error, 'context2');
      expect(key1).not.toBe(key2);
    });

    it('should handle string errors', () => {
      const key = handler.generateDeduplicationKey('String error', 'context');
      expect(key).toBeDefined();
      expect(key.length).toBe(64); // SHA256 hex length
    });

    it('should include stack trace in hash when available', () => {
      const error1 = new Error('Test error');
      const error2 = new Error('Test error');
      error2.stack = 'Different stack trace';
      
      const key1 = handler.generateDeduplicationKey(error1, 'context');
      const key2 = handler.generateDeduplicationKey(error2, 'context');
      expect(key1).not.toBe(key2);
    });
  });

  describe('handleError', () => {
    beforeEach(() => {
      rateLimiter.send.mockResolvedValue({ success: true });
    });

    it('should handle Error objects correctly', async () => {
      const error = new Error('Test error');
      await handler.handleError(error, { shouldThrow: false });

      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('Test error'),
        expect.objectContaining({
          priority: 3, // INFO
          deduplicationKey: expect.any(String),
          deduplicationWindow: 7200000, // 2時間
          maxRetries: 3
        })
      );
    });

    it('should handle string errors correctly', async () => {
      await handler.handleError('String error message', { shouldThrow: false });

      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('String error message'),
        expect.objectContaining({
          priority: 3, // INFO
          deduplicationKey: expect.any(String)
        })
      );
    });

    it('should use manual severity when provided', async () => {
      await handler.handleError('Test error', { 
        severity: 'CRITICAL',
        shouldThrow: false 
      });

      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('[CRITICAL]'),
        expect.objectContaining({
          priority: 1, // CRITICAL
          deduplicationWindow: 1800000, // 30分
          maxRetries: 5
        })
      );
    });

    it('should include context in message when provided', async () => {
      await handler.handleError('Test error', { 
        context: 'Test context',
        shouldThrow: false 
      });

      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('**コンテキスト**: Test context'),
        expect.any(Object)
      );
    });

    it('should include stack trace for Error objects', async () => {
      const error = new Error('Test error');
      await handler.handleError(error, { shouldThrow: false });

      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('**スタックトレース**:'),
        expect.any(Object)
      );
    });

    it('should adjust stack trace length based on severity', async () => {
      const error = new Error('Database error');
      error.stack = Array(20).fill('stack line').join('\n');
      
      await handler.handleError(error, { shouldThrow: false });

      const call = rateLimiter.send.mock.calls[0];
      const message = call[1];
      const stackLines = message.split('\n').filter(line => line.startsWith('stack line'));
      expect(stackLines.length).toBeLessThanOrEqual(15); // CRITICAL max lines
    });

    it('should use custom deduplication window when provided', async () => {
      await handler.handleError('Test error', { 
        deduplicationWindow: 5000,
        shouldThrow: false 
      });

      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.any(String),
        expect.objectContaining({
          deduplicationWindow: 5000
        })
      );
    });

    it('should throw error when shouldThrow is true', async () => {
      const error = new Error('Test error');
      await expect(handler.handleError(error, { shouldThrow: true }))
        .rejects.toThrow('Test error');
    });

    it('should not throw error when shouldThrow is false', async () => {
      const error = new Error('Test error');
      await expect(handler.handleError(error, { shouldThrow: false }))
        .resolves.not.toThrow();
    });

    it('should handle rateLimiter send failure gracefully', async () => {
      rateLimiter.send.mockResolvedValue({ success: false, reason: 'duplicate' });
      
      await expect(handler.handleError('Test error', { shouldThrow: false }))
        .resolves.not.toThrow();
      
      expect(rateLimiter.send).toHaveBeenCalled();
    });

    it('should handle rateLimiter exception gracefully', async () => {
      rateLimiter.send.mockRejectedValue(new Error('Network error'));
      
      await expect(handler.handleError('Test error', { shouldThrow: false }))
        .resolves.not.toThrow();
      
      expect(rateLimiter.send).toHaveBeenCalled();
    });
  });

  describe('createAsyncHandler', () => {
    it('should create async handler with default options', async () => {
      const asyncHandler = handler.createAsyncHandler();
      rateLimiter.send.mockResolvedValue({ success: true });
      
      await expect(asyncHandler(new Error('Test error')))
        .resolves.not.toThrow();
      
      expect(rateLimiter.send).toHaveBeenCalled();
    });

    it('should create async handler with custom options', async () => {
      const asyncHandler = handler.createAsyncHandler({ 
        context: 'async test',
        severity: 'WARNING' 
      });
      rateLimiter.send.mockResolvedValue({ success: true });
      
      await asyncHandler('Test error');
      
      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('async test'),
        expect.objectContaining({
          priority: 2 // WARNING
        })
      );
    });
  });

  describe('handleErrorLegacy', () => {
    it('should maintain backward compatibility', async () => {
      rateLimiter.send.mockResolvedValue({ success: true });
      
      await handler.handleErrorLegacy('Test error', 'legacy context', false);
      
      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('legacy context'),
        expect.any(Object)
      );
    });
  });

  describe('getErrorStats', () => {
    it('should return combined statistics', () => {
      const stats = handler.getErrorStats();
      
      expect(stats).toHaveProperty('totalWebhooks');
      expect(stats).toHaveProperty('totalPendingNotifications');
      expect(stats).toHaveProperty('unifiedErrorHandler');
      expect(stats.unifiedErrorHandler).toHaveProperty('severityLevels');
      expect(stats.unifiedErrorHandler).toHaveProperty('severityDeduplicationWindows');
    });
  });

  describe('cleanup', () => {
    it('should call rateLimiter cleanup', () => {
      handler.cleanup();
      expect(rateLimiter.cleanup).toHaveBeenCalled();
    });
  });

  describe('singleton instance', () => {
    it('should export unifiedErrorHandler singleton', () => {
      expect(unifiedErrorHandler).toBeInstanceOf(UnifiedErrorHandler);
    });

    it('should maintain singleton behavior', () => {
      const { unifiedErrorHandler: instance1 } = require('../../../src/common/errorHandler');
      const { unifiedErrorHandler: instance2 } = require('../../../src/common/errorHandler');
      expect(instance1).toBe(instance2);
    });
  });

  describe('backward compatibility', () => {
    it('should export ErrorHandler for backward compatibility', () => {
      const { ErrorHandler, errorHandler } = require('../../../src/common/errorHandler');
      
      expect(ErrorHandler).toBeDefined();
      expect(errorHandler).toBeDefined();
      expect(errorHandler).toBeInstanceOf(ErrorHandler);
      expect(errorHandler).toBeInstanceOf(UnifiedErrorHandler);
    });

    it('should handle legacy handleError signature', async () => {
      const { errorHandler } = require('../../../src/common/errorHandler');
      rateLimiter.send.mockResolvedValue({ success: true });
      
      await errorHandler.handleError('Test error', 'legacy context', false);
      
      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('legacy context'),
        expect.any(Object)
      );
    });
  });

  describe('edge cases', () => {
    it('should handle undefined error gracefully', async () => {
      await expect(handler.handleError(undefined, { shouldThrow: false }))
        .resolves.not.toThrow();
    });

    it('should handle null error gracefully', async () => {
      await expect(handler.handleError(null, { shouldThrow: false }))
        .resolves.not.toThrow();
    });

    it('should handle empty string error', async () => {
      await handler.handleError('', { shouldThrow: false });
      expect(rateLimiter.send).toHaveBeenCalled();
    });

    it('should handle error without message property', async () => {
      const error = { stack: 'some stack trace' };
      await handler.handleError(error, { shouldThrow: false });
      expect(rateLimiter.send).toHaveBeenCalled();
    });
  });
});

describe('Error severity classification edge cases', () => {
  let handler;

  beforeEach(() => {
    handler = new UnifiedErrorHandler();
  });

  it('should handle case-insensitive matching', () => {
    expect(handler.determineSeverity('DATABASE CONNECTION FAILED')).toBe('CRITICAL');
    expect(handler.determineSeverity('rate LIMIT exceeded')).toBe('WARNING');
  });

  it('should prioritize CRITICAL over WARNING when both conditions match', () => {
    expect(handler.determineSeverity('Database API timeout')).toBe('CRITICAL');
  });

  it('should handle mixed case in context', () => {
    expect(handler.determineSeverity('Error occurred', 'TRADING')).toBe('CRITICAL');
    expect(handler.determineSeverity('Error occurred', 'Api')).toBe('WARNING');
  });
});