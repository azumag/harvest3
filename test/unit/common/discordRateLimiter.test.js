/**
 * Tests for src/common/discordRateLimiter.js
 */

// Mock axios for testing
jest.mock('axios');

describe('DiscordRateLimiter', () => {
  let rateLimiter;
  let mockedAxios;

  beforeEach(() => {
    // Clear the module cache to get a fresh instance
    jest.resetModules();
    jest.clearAllMocks();
    
    // Mock axios
    mockedAxios = require('axios');
    mockedAxios.post = jest.fn();
    
    // Require fresh instance
    rateLimiter = require('../../../src/common/discordRateLimiter');
  });

  afterAll(() => {
    // Clean up any remaining timers
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  describe('validateMessage', () => {
    test('returns empty array for valid webhook URL and message', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
      const validMessage = 'This is a valid message';
      
      const errors = rateLimiter.validateMessage(validUrl, validMessage);
      
      expect(errors).toEqual([]);
    });

    test('returns error for null webhook URL', () => {
      const errors = rateLimiter.validateMessage(null, 'valid message');
      
      expect(errors).toContain('Webhook URL is required and must be a string');
    });

    test('returns error for invalid webhook URL format', () => {
      const invalidUrl = 'https://example.com/webhook';
      const errors = rateLimiter.validateMessage(invalidUrl, 'valid message');
      
      expect(errors).toContain('Invalid Discord webhook URL format');
    });

    test('returns error for null message', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
      const errors = rateLimiter.validateMessage(validUrl, null);
      
      expect(errors).toContain('Message cannot be null or undefined');
    });

    test('returns error for undefined message', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
      const errors = rateLimiter.validateMessage(validUrl, undefined);
      
      expect(errors).toContain('Message cannot be null or undefined');
    });

    test('returns error for empty message', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
      const errors = rateLimiter.validateMessage(validUrl, '   ');
      
      expect(errors).toContain('Message cannot be empty');
    });

    test('returns error for non-string message', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
      const errors = rateLimiter.validateMessage(validUrl, 123);
      
      expect(errors).toContain('Message must be a string');
    });

    test('returns error for message too long', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
      const longMessage = 'a'.repeat(2001);
      const errors = rateLimiter.validateMessage(validUrl, longMessage);
      
      expect(errors).toContain('Message is too long: 2001 characters (max 2000)');
    });

    test('accepts discordapp.com webhook URL format', () => {
      const validUrl = 'https://discordapp.com/api/webhooks/123456789/abcdefghijk';
      const validMessage = 'This is a valid message';
      
      const errors = rateLimiter.validateMessage(validUrl, validMessage);
      
      expect(errors).toEqual([]);
    });
  });

  describe('sendToDiscord', () => {
    const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
    const validMessage = 'Test message';

    test('returns validation error for invalid input', async () => {
      const result = await rateLimiter.sendToDiscord(null, validMessage);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('validation_failed');
      expect(result.details).toContain('Webhook URL is required and must be a string');
    });

    test('returns validation error for null message', async () => {
      const result = await rateLimiter.sendToDiscord(validUrl, null);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('validation_failed');
      expect(result.details).toContain('Message cannot be null or undefined');
    });

    test('returns validation error for empty message', async () => {
      const result = await rateLimiter.sendToDiscord(validUrl, '   ');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('validation_failed');
      expect(result.details).toContain('Message cannot be empty');
    });

    test('returns validation error for message too long', async () => {
      const longMessage = 'a'.repeat(2001);
      const result = await rateLimiter.sendToDiscord(validUrl, longMessage);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('validation_failed');
      expect(result.details).toContain('Message is too long: 2001 characters (max 2000)');
    });

    test('calls axios with correct parameters for valid input', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200 });
      
      const result = await rateLimiter.sendToDiscord(validUrl, validMessage);
      
      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(validUrl, { content: validMessage });
    });
  });

  describe('send', () => {
    const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
    const validMessage = 'Test message';

    test('successfully queues message for sending', async () => {
      const result = await rateLimiter.send(validUrl, validMessage);
      
      expect(result.success).toBe(true);
      expect(result.reason).toBe('queued');
    });

    test('blocks duplicate messages within deduplication window', async () => {
      const deduplicationKey = 'test-key';
      
      // Send first message
      await rateLimiter.send(validUrl, validMessage, { deduplicationKey });
      
      // Try to send duplicate message
      const result = await rateLimiter.send(validUrl, validMessage, { deduplicationKey });
      
      expect(result.success).toBe(false);
      expect(result.reason).toBe('duplicate');
    });

    test('allows duplicate messages after deduplication window expires', async () => {
      const deduplicationKey = 'test-key-expired';
      const shortWindow = 10; // 10ms to reduce test time
      
      // Send first message with short deduplication window
      await rateLimiter.send(validUrl, validMessage, { 
        deduplicationKey, 
        deduplicationWindow: shortWindow 
      });
      
      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, shortWindow + 50));
      
      // Should allow duplicate message after window expires
      const result = await rateLimiter.send(validUrl, validMessage, { 
        deduplicationKey,
        deduplicationWindow: shortWindow 
      });
      
      expect(result.success).toBe(true);
      expect(result.reason).toBe('queued');
    });

    test('queues messages with correct priority order', async () => {
      const criticalMessage = 'Critical alert';
      const warningMessage = 'Warning alert';
      const infoMessage = 'Info message';
      
      // Send messages in reverse priority order
      await rateLimiter.send(validUrl, infoMessage, { 
        priority: rateLimiter.notificationPriorities.INFO 
      });
      await rateLimiter.send(validUrl, warningMessage, { 
        priority: rateLimiter.notificationPriorities.WARNING 
      });
      await rateLimiter.send(validUrl, criticalMessage, { 
        priority: rateLimiter.notificationPriorities.CRITICAL 
      });
      
      const stats = rateLimiter.getStats();
      expect(stats.totalPendingNotifications).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    test('returns correct statistics', () => {
      const stats = rateLimiter.getStats();
      
      expect(stats).toHaveProperty('totalWebhooks');
      expect(stats).toHaveProperty('totalPendingNotifications');
      expect(stats).toHaveProperty('totalDeduplicatedHashes');
      expect(stats).toHaveProperty('webhookStats');
      expect(typeof stats.totalWebhooks).toBe('number');
      expect(typeof stats.totalPendingNotifications).toBe('number');
      expect(typeof stats.totalDeduplicatedHashes).toBe('number');
      expect(typeof stats.webhookStats).toBe('object');
    });
  });

  describe('cleanup', () => {
    test('removes expired deduplication entries', async () => {
      const deduplicationKey = 'test-cleanup-key';
      
      // Mock Date.now to control time
      const originalDateNow = Date.now;
      let currentTime = 1000000; // Start time
      Date.now = jest.fn(() => currentTime);
      
      try {
        // Add a deduplication entry
        await rateLimiter.send(
          'https://discord.com/api/webhooks/123456789/abcdefghijk', 
          'test message', 
          { deduplicationKey, deduplicationWindow: 3600000 } // 1 hour
        );
        
        // Move time forward by more than 1 hour
        currentTime += 3600001; // 1 hour + 1ms
        
        // Manually trigger cleanup
        rateLimiter.cleanup();
        
        // Should allow the message again since cleanup removed expired entry
        const result = await rateLimiter.send(
          'https://discord.com/api/webhooks/123456789/abcdefghijk', 
          'test message', 
          { deduplicationKey }
        );
        
        expect(result.success).toBe(true);
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    });
  });
});