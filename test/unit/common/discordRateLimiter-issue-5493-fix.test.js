/**
 * Test for Discord Rate Limiter JSON Stringify Fix - Issue #5493
 * 
 * This test addresses the issue where network errors in Discord rate limiter
 * are not properly logged due to JSON.stringify hanging or failing.
 */

jest.mock('axios');
jest.mock('../../../src/config/settings', () => ({
  SETTINGS: {
    MONITORING: {
      DISCORD_RATE_LIMIT_BUFFER_MS: 5000
    }
  }
}));

describe('Discord Rate Limiter - Issue #5493 Fix', () => {
  let rateLimiter;
  let consoleSpy;
  let mockedAxios;
  
  beforeAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    
    // Mock console.error
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock axios
    mockedAxios = require('axios');
    mockedAxios.post = jest.fn();
    
    // Require fresh instance
    rateLimiter = require('../../../src/common/discordRateLimiter');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllTimers();
    
    if (rateLimiter && rateLimiter._clearCleanupInterval) {
      rateLimiter._clearCleanupInterval();
    }
  });

  afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('should handle network errors with safe stringify', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    const mockError = {
      message: 'Network Error',
      code: 'ECONNREFUSED'
    };

    mockedAxios.post.mockRejectedValueOnce(mockError);

    const result = await rateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    
    // Check that network error was properly logged with safe stringify
    const consoleErrorCalls = consoleSpy.mock.calls;
    const networkErrorCall = consoleErrorCalls.find(call => 
      call[0].includes('Network/Other error:')
    );
    
    expect(networkErrorCall).toBeDefined();
    expect(networkErrorCall[1]).toContain('Network Error');
    expect(networkErrorCall[1]).toContain('ECONNREFUSED');
    expect(networkErrorCall[1]).not.toBe('{'); // Should not be incomplete
  });

  test('should handle circular references in error objects', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    // Create an error object with circular reference
    const circularError = {
      message: 'Circular Error',
      code: 'CIRCULAR_REF'
    };
    circularError.self = circularError; // Create circular reference

    mockedAxios.post.mockRejectedValueOnce(circularError);

    const result = await rateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('CIRCULAR_REF');
    
    // Check that circular reference was handled properly
    const consoleErrorCalls = consoleSpy.mock.calls;
    const networkErrorCall = consoleErrorCalls.find(call => 
      call[0].includes('Network/Other error:')
    );
    
    expect(networkErrorCall).toBeDefined();
    expect(networkErrorCall[1]).toContain('Circular Reference');
    expect(networkErrorCall[1]).not.toBe('{'); // Should not be incomplete
  });

  test('should handle HTTP errors with safe stringify', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    // Create HTTP error with potentially problematic data
    const circularData = { error: 'test' };
    circularData.circular = circularData;
    
    const mockError = {
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        data: circularData
      }
    };

    mockedAxios.post.mockRejectedValueOnce(mockError);

    const result = await rateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('http_500');
    
    // Check that HTTP error was properly logged with safe stringify
    const consoleErrorCalls = consoleSpy.mock.calls;
    const httpErrorCall = consoleErrorCalls.find(call => 
      call[0].includes('HTTP error:')
    );
    
    expect(httpErrorCall).toBeDefined();
    expect(httpErrorCall[1]).toContain('500');
    expect(httpErrorCall[1]).toContain('Internal Server Error');
    expect(httpErrorCall[1]).toContain('Circular Reference');
    expect(httpErrorCall[1]).not.toBe('{'); // Should not be incomplete
  });

  test('should handle stringify timeout scenarios', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    // Mock very slow JSON.stringify operation
    const originalStringify = JSON.stringify;
    JSON.stringify = jest.fn().mockImplementation(() => {
      // Simulate hanging/very slow operation
      return new Promise(() => {}); // Never resolves
    });

    const mockError = {
      message: 'Network Error',
      code: 'ECONNREFUSED'
    };

    mockedAxios.post.mockRejectedValueOnce(mockError);

    const result = await rateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    
    // Check that timeout was handled properly
    const consoleErrorCalls = consoleSpy.mock.calls;
    const networkErrorCall = consoleErrorCalls.find(call => 
      call[0].includes('Network/Other error:')
    );
    
    expect(networkErrorCall).toBeDefined();
    expect(networkErrorCall[1]).toContain('STRINGIFY_TIMEOUT');
    expect(networkErrorCall[1]).not.toBe('{'); // Should not be incomplete

    // Restore original JSON.stringify
    JSON.stringify = originalStringify;
  });

  test('should handle stringify errors gracefully', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    // Mock JSON.stringify to throw error
    const originalStringify = JSON.stringify;
    JSON.stringify = jest.fn().mockImplementation(() => {
      throw new Error('Stringify failed');
    });

    const mockError = {
      message: 'Network Error',
      code: 'ECONNREFUSED'
    };

    mockedAxios.post.mockRejectedValueOnce(mockError);

    const result = await rateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    
    // Check that stringify error was handled properly
    const consoleErrorCalls = consoleSpy.mock.calls;
    const networkErrorCall = consoleErrorCalls.find(call => 
      call[0].includes('Network/Other error:')
    );
    
    expect(networkErrorCall).toBeDefined();
    expect(networkErrorCall[1]).toContain('STRINGIFY_ERROR');
    expect(networkErrorCall[1]).toContain('Stringify failed');
    expect(networkErrorCall[1]).not.toBe('{'); // Should not be incomplete

    // Restore original JSON.stringify
    JSON.stringify = originalStringify;
  });

  test('safeStringify should handle normal objects correctly', async () => {
    const normalObj = {
      key1: 'value1',
      key2: 42,
      key3: true
    };

    const result = await rateLimiter.safeStringify(normalObj);
    const parsed = JSON.parse(result);
    
    expect(parsed).toEqual(normalObj);
  });

  test('safeStringify should handle circular references', async () => {
    const circularObj = { name: 'test' };
    circularObj.self = circularObj;

    const result = await rateLimiter.safeStringify(circularObj);
    
    expect(result).toContain('Circular Reference');
    expect(result).not.toBe('{');
  });

  test('safeStringify should handle timeout', async () => {
    const obj = { test: 'value' };
    
    // Mock JSON.stringify to be very slow
    const originalStringify = JSON.stringify;
    JSON.stringify = jest.fn().mockImplementation(() => {
      return new Promise(() => {}); // Never resolves
    });

    const result = await rateLimiter.safeStringify(obj, 100); // 100ms timeout
    
    expect(result).toBe('[STRINGIFY_TIMEOUT]');

    // Restore
    JSON.stringify = originalStringify;
  });
});