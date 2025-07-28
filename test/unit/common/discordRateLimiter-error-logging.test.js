/**
 * Test for error logging serialization fix in discordRateLimiter.js
 * Issue #5222
 */

// Mock axios
jest.mock('axios');
jest.mock('../../../src/config/settings', () => ({
  SETTINGS: {
    MONITORING: {
      DISCORD_RATE_LIMIT_BUFFER_MS: 5000
    }
  }
}));

describe('DiscordRateLimiter Error Logging Fix (Issue #5222)', () => {
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

  test('should properly serialize HTTP error objects', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    // Use 500 error instead of 400 to trigger the general HTTP error path
    const mockError = {
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        data: { error: 'Server error', code: 500 }
      }
    };

    mockedAxios.post.mockRejectedValueOnce(mockError);

    const result = await rateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('http_500');
    
    // The JSON.stringify call should have been made for the general HTTP error
    const httpErrorCall = consoleSpy.mock.calls.find(call => 
      call[0].includes('[DISCORD_RATE_LIMITER] HTTP error:') && call[1]
    );
    expect(httpErrorCall).toBeDefined();
    expect(httpErrorCall[1]).toMatch(/{\s*"status":\s*500/); // Should be valid JSON string
  });

  test('should handle JSON.stringify serialization errors gracefully', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    // Mock JSON.stringify to fail for HTTP error objects
    const originalStringify = JSON.stringify;
    JSON.stringify = jest.fn().mockImplementation((obj, replacer, space) => {
      // Force failure when stringifying HTTP error info objects
      if (obj && obj.status === 500 && obj.statusText === 'Internal Server Error') {
        throw new Error('Converting circular structure to JSON');
      }
      return originalStringify(obj, replacer, space);
    });
    
    // Create circular reference that will cause JSON.stringify to fail
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
    
    // Check that fallback error logging was used
    const consoleErrorCalls = consoleSpy.mock.calls;
    const fallbackCall = consoleErrorCalls.find(call => 
      call[0].includes('HTTP error (serialization failed)')
    );
    
    expect(fallbackCall).toBeDefined();
    expect(fallbackCall[1]).toMatchObject({
      status: 500,
      statusText: 'Internal Server Error',
      dataType: 'object',
      serializationError: expect.any(String)
    });
    
    // Restore original JSON.stringify
    JSON.stringify = originalStringify;
  });

  test('should properly serialize network errors', async () => {
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
    
    // Check that network error was properly serialized
    const consoleErrorCalls = consoleSpy.mock.calls;
    const networkErrorCall = consoleErrorCalls.find(call => 
      call[0].includes('Network/Other error:') && !call[0].includes('serialization failed')
    );
    
    expect(networkErrorCall).toBeDefined();
    expect(networkErrorCall[1]).toMatch(/{\s*"message":\s*"Network Error"/); // Should be valid JSON string
  });

  test('should handle network error serialization failures gracefully', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'test message';
    
    // Mock JSON.stringify to fail for this test
    const originalStringify = JSON.stringify;
    JSON.stringify = jest.fn().mockImplementation((obj) => {
      if (obj && obj.message === 'Network Error') {
        throw new Error('Converting circular structure to JSON');
      }
      return originalStringify(obj);
    });

    const mockError = {
      message: 'Network Error',
      code: 'ECONNREFUSED'
    };

    mockedAxios.post.mockRejectedValueOnce(mockError);

    const result = await rateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    
    // Check that fallback network error logging was used
    const consoleErrorCalls = consoleSpy.mock.calls;
    const fallbackCall = consoleErrorCalls.find(call => 
      call[0].includes('Network/Other error (serialization failed)')
    );
    
    expect(fallbackCall).toBeDefined();
    expect(fallbackCall[1]).toMatchObject({
      messageType: 'string',
      codeType: 'string',
      serializationError: expect.any(String)
    });

    // Restore original JSON.stringify
    JSON.stringify = originalStringify;
  });
});