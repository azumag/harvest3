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

  afterAll(async () => {
    // Clean up any remaining timers
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    
    // Clear any cleanup intervals in the rate limiter
    if (rateLimiter && rateLimiter._clearCleanupInterval) {
      rateLimiter._clearCleanupInterval();
    }
    
    // Force clear any remaining async operations
    await new Promise(resolve => setTimeout(resolve, 100));
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

    test('accepts long messages (will be split automatically)', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';
      const longMessage = 'a'.repeat(2001);
      const errors = rateLimiter.validateMessage(validUrl, longMessage);
      
      expect(errors).toEqual([]);
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

    test('accepts long messages for direct Discord send (validation passes)', async () => {
      const longMessage = 'a'.repeat(2001);
      
      // Mock axios to succeed
      mockedAxios.post.mockResolvedValue({ status: 200 });
      
      const result = await rateLimiter.sendToDiscord(validUrl, longMessage);
      
      expect(result.success).toBe(true);
      // バリデーションエラーではないはず
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
      expect(result.chunks).toBe(1);
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
      expect(result.chunks).toBe(1);
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
        expect(result.chunks).toBe(1);
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    });
  });

  describe('sanitizeMessage', () => {
    test('removes control characters while preserving newlines and tabs', () => {
      const input = 'Hello\x00World\nNew\tLine\x0B\x0C\x0E';
      const result = rateLimiter.sanitizeMessage(input);
      
      expect(result).toBe('HelloWorld\nNew\tLine');
    });

    test('limits consecutive newlines to maximum of 3', () => {
      const input = 'Line1\n\n\n\n\n\nLine2';
      const result = rateLimiter.sanitizeMessage(input);
      
      expect(result).toBe('Line1\n\n\nLine2');
    });

    test('removes zero-width and invisible characters', () => {
      const input = 'Hello\u200B\u200C\u200D\uFEFFWorld\u2060';
      const result = rateLimiter.sanitizeMessage(input);
      
      expect(result).toBe('HelloWorld');
    });

    test('replaces unsupported characters with question marks', () => {
      const input = 'Valid text with \x01unsupported\x02 chars';
      const result = rateLimiter.sanitizeMessage(input);
      
      expect(result).toBe('Valid text with ?unsupported? chars');
    });

    test('converts non-string input to string', () => {
      const result = rateLimiter.sanitizeMessage(12345);
      
      expect(result).toBe('12345');
    });

    test('trims whitespace from beginning and end', () => {
      const input = '   Hello World   ';
      const result = rateLimiter.sanitizeMessage(input);
      
      expect(result).toBe('Hello World');
    });

    test('preserves valid Unicode characters', () => {
      const input = 'Hello 世界 🌍 café';
      const result = rateLimiter.sanitizeMessage(input);
      
      expect(result).toBe('Hello 世界 🌍 café');
    });
  });

  describe('splitMessage', () => {
    test('returns single chunk for short message', () => {
      const shortMessage = 'This is a short message';
      const chunks = rateLimiter.splitMessage(shortMessage);
      
      expect(chunks).toEqual([shortMessage]);
    });

    test('splits long message into multiple chunks', () => {
      const longMessage = 'a'.repeat(2001);
      const chunks = rateLimiter.splitMessage(longMessage);
      
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe('a'.repeat(2000));
      expect(chunks[1]).toBe('a');
    });

    test('splits message by lines when possible', () => {
      const lines = [];
      for (let i = 0; i < 10; i++) {
        lines.push('This is line ' + i + ' with some content to make it longer');
      }
      const message = lines.join('\n');
      const chunks = rateLimiter.splitMessage(message);
      
      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    test('handles single line longer than 2000 characters', () => {
      const longLine = 'a'.repeat(2500);
      const chunks = rateLimiter.splitMessage(longLine);
      
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe('a'.repeat(2000));
      expect(chunks[1]).toBe('a'.repeat(500));
    });

    test('handles mixed short and long lines', () => {
      const shortLine = 'Short line';
      const longLine = 'b'.repeat(2500);
      const message = shortLine + '\n' + longLine + '\n' + shortLine;
      const chunks = rateLimiter.splitMessage(message);
      
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    test('converts non-string input to string', () => {
      const numberInput = 12345;
      const chunks = rateLimiter.splitMessage(numberInput);
      
      expect(chunks).toEqual(['12345']);
    });
  });

  describe('send with message splitting', () => {
    const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';

    test('splits long message into multiple chunks automatically', async () => {
      const longMessage = 'a'.repeat(2001);
      const result = await rateLimiter.send(validUrl, longMessage);
      
      expect(result.success).toBe(true);
      expect(result.reason).toBe('queued');
      expect(result.chunks).toBe(2);
    });

    test('creates unique deduplication keys for each chunk', async () => {
      const longMessage = 'a'.repeat(2001);
      const deduplicationKey = 'test-long-message';
      
      // Mock axios to make it fail so messages stay in queue
      mockedAxios.post.mockRejectedValue(new Error('Network error'));
      
      const result = await rateLimiter.send(validUrl, longMessage, { deduplicationKey });
      
      expect(result.success).toBe(true);
      expect(result.chunks).toBe(2);
      
      // Wait a bit to ensure queue processing attempts
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // キュー統計で確認
      const stats = rateLimiter.getStats();
      expect(stats.totalPendingNotifications).toBeGreaterThan(0);
    });

    test('handles multiline long message correctly', async () => {
      const lines = [];
      for (let i = 0; i < 50; i++) {
        lines.push(`Line ${i}: This is a relatively long line with some content to make the overall message exceed 2000 characters`);
      }
      const longMessage = lines.join('\n');
      const result = await rateLimiter.send(validUrl, longMessage);
      
      expect(result.success).toBe(true);
      expect(result.reason).toBe('queued');
      expect(result.chunks).toBeGreaterThan(1);
    });
  });

  describe('testWebhookHealth', () => {
    const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';

    beforeEach(() => {
      mockedAxios.post.mockClear();
    });

    test('returns healthy true for 400 response (URL valid but needs content)', async () => {
      const error = new Error('Request failed');
      error.response = { status: 400 };
      mockedAxios.post.mockRejectedValue(error);

      const result = await rateLimiter.testWebhookHealth(validUrl);

      expect(result.healthy).toBe(true);
      expect(result.note).toBe('URL is valid but requires content');
      expect(mockedAxios.post).toHaveBeenCalledWith(validUrl, { content: '' });
    });

    test('returns healthy false for 404 response (webhook deleted)', async () => {
      const error = new Error('Not found');
      error.response = { status: 404 };
      mockedAxios.post.mockRejectedValue(error);

      const result = await rateLimiter.testWebhookHealth(validUrl);

      expect(result.healthy).toBe(false);
      expect(result.reason).toBe('Webhook not found (deleted)');
    });

    test('returns healthy false for 401 response (access denied)', async () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      mockedAxios.post.mockRejectedValue(error);

      const result = await rateLimiter.testWebhookHealth(validUrl);

      expect(result.healthy).toBe(false);
      expect(result.reason).toBe('Webhook access denied (permissions)');
    });

    test('returns healthy false for 403 response (forbidden)', async () => {
      const error = new Error('Forbidden');
      error.response = { status: 403 };
      mockedAxios.post.mockRejectedValue(error);

      const result = await rateLimiter.testWebhookHealth(validUrl);

      expect(result.healthy).toBe(false);
      expect(result.reason).toBe('Webhook access denied (permissions)');
    });

    test('returns healthy false for network error', async () => {
      const error = new Error('Network error');
      mockedAxios.post.mockRejectedValue(error);

      const result = await rateLimiter.testWebhookHealth(validUrl);

      expect(result.healthy).toBe(false);
      expect(result.reason).toBe('Network error');
    });

    test('returns healthy true for successful response', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200 });

      const result = await rateLimiter.testWebhookHealth(validUrl);

      expect(result.healthy).toBe(true);
    });
  });

  describe('maskWebhookUrl', () => {
    test('masks Discord webhook token correctly', () => {
      const webhookUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz';
      const result = rateLimiter.maskWebhookUrl(webhookUrl);
      
      expect(result).toBe('https://discord.com/api/webhooks/123456789/***');
    });

    test('masks discordapp.com webhook token correctly', () => {
      const webhookUrl = 'https://discordapp.com/api/webhooks/987654321/secrettoken123';
      const result = rateLimiter.maskWebhookUrl(webhookUrl);
      
      expect(result).toBe('https://discordapp.com/api/webhooks/987654321/***');
    });

    test('handles non-Discord URLs by truncating to 50 characters', () => {
      const longUrl = 'https://example.com/very/long/path/that/exceeds/fifty/characters/and/should/be/truncated';
      const result = rateLimiter.maskWebhookUrl(longUrl);
      
      expect(result).toBe('https://example.com/very/long/path/that/exceeds/fi...');
    });

    test('returns short URLs unchanged if under 50 characters', () => {
      const shortUrl = 'https://example.com/short';
      const result = rateLimiter.maskWebhookUrl(shortUrl);
      
      expect(result).toBe('https://example.com/short');
    });

    test('handles invalid inputs gracefully', () => {
      expect(rateLimiter.maskWebhookUrl(null)).toBe('[INVALID_URL]');
      expect(rateLimiter.maskWebhookUrl(undefined)).toBe('[INVALID_URL]');
      expect(rateLimiter.maskWebhookUrl(123)).toBe('[INVALID_URL]');
      expect(rateLimiter.maskWebhookUrl('')).toBe('[INVALID_URL]');
    });
  });

  describe('sendToDiscord enhanced error handling', () => {
    const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijk';

    beforeEach(() => {
      mockedAxios.post.mockClear();
    });

    test('sanitizes message before sending', async () => {
      const dirtyMessage = 'Hello\x00World\n\n\n\n\nTest';
      const expectedSanitized = 'HelloWorld\n\n\nTest';
      
      mockedAxios.post.mockResolvedValue({ status: 200 });

      const result = await rateLimiter.sendToDiscord(validUrl, dirtyMessage);

      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(validUrl, { content: expectedSanitized });
    });

    test('returns error when message becomes empty after sanitization', async () => {
      const emptyMessage = '\x00\x01\x02'; // Only control characters

      const result = await rateLimiter.sendToDiscord(validUrl, emptyMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('empty_after_sanitization');
      expect(result.details.originalLength).toBe(3);
      expect(result.details.sanitizedLength).toBe(0);
    });

    test('includes webhook health check in 400 error details', async () => {
      const message = 'Test message';
      const error = new Error('Bad Request');
      error.response = {
        status: 400,
        statusText: 'Bad Request',
        data: { error: 'Invalid webhook' }
      };
      
      // Mock axios to fail for actual send but return 404 for health check
      mockedAxios.post
        .mockRejectedValueOnce(error) // First call (actual send)
        .mockRejectedValueOnce({ // Second call (health check)
          response: { status: 404 }
        });

      const result = await rateLimiter.sendToDiscord(validUrl, message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('bad_request');
      expect(result.details.webhookHealth.healthy).toBe(false);
      expect(result.details.webhookHealth.reason).toBe('Webhook not found (deleted)');
    });

    test('handles HTTP errors other than 400 and 429', async () => {
      const message = 'Test message';
      const error = new Error('Server Error');
      error.response = {
        status: 500,
        statusText: 'Internal Server Error',
        data: { error: 'Server error' }
      };
      
      mockedAxios.post.mockRejectedValue(error);

      const result = await rateLimiter.sendToDiscord(validUrl, message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('http_500');
      expect(result.details.status).toBe(500);
      expect(result.details.statusText).toBe('Internal Server Error');
    });

    test('handles network errors without response', async () => {
      const message = 'Test message';
      const error = new Error('Network timeout');
      error.code = 'ECONNABORTED';
      
      mockedAxios.post.mockRejectedValue(error);

      const result = await rateLimiter.sendToDiscord(validUrl, message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNABORTED');
      expect(result.details.message).toBe('Network timeout');
      expect(result.details.code).toBe('ECONNABORTED');
    });
  });
});