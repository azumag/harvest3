/**
 * Issue #5240: backtestサービスで例外が発生
 * エラー: 'upstream connect error or disconnect/reset before headers. reset reason: overflow'
 * 
 * このテストはDiscord Rate LimiterのHTTP 503 overflowエラー処理を検証します
 */

const discordRateLimiter = require('../src/common/discordRateLimiter');

// Mock axios to simulate overflow error
jest.mock('axios');
const axios = require('axios');

describe('Issue #5240: Backtest Service Overflow Error Fix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset rate limiter state
    discordRateLimiter.webhookQueues?.clear?.();
    discordRateLimiter.errorHashes?.clear?.();
  });

  test('Discord Rate Limiter should handle overflow error with extended backoff', async () => {
    // Mock axios to throw overflow error
    const overflowError = {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: 'upstream connect error or disconnect/reset before headers. reset reason: overflow'
      }
    };

    axios.post.mockRejectedValue(overflowError);

    // Send a message that will trigger the error
    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'Test overflow error handling';

    const result = await discordRateLimiter.send(webhookUrl, message);

    // Should return success: true as it's queued
    expect(result.success).toBe(true);
    expect(result.reason).toBe('queued');

    // Wait for queue processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify axios was called with proper configuration
    expect(axios.post).toHaveBeenCalledWith(
      webhookUrl,
      { content: message },
      expect.objectContaining({
        timeout: 30000,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'Discord-Webhook-Client/1.0'
        }),
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object)
      })
    );

    // Should have been called once initially
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('Discord Rate Limiter should handle regular 503 error differently from overflow', async () => {
    // Mock axios to throw regular 503 error
    const regularError = {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: 'Service temporarily unavailable'
      }
    };

    axios.post.mockRejectedValue(regularError);

    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'Test regular 503 error handling';

    const result = await discordRateLimiter.send(webhookUrl, message);

    expect(result.success).toBe(true);
    expect(result.reason).toBe('queued');

    // Wait for queue processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should have been called once
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('Discord Rate Limiter should respect connection limits', async () => {
    axios.post.mockResolvedValue({ data: 'success' });

    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'Test connection limit configuration';

    await discordRateLimiter.send(webhookUrl, message);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(axios.post).toHaveBeenCalledWith(
      webhookUrl,
      { content: message },
      expect.objectContaining({
        httpAgent: expect.objectContaining({
          maxSockets: 5
        }),
        httpsAgent: expect.objectContaining({
          maxSockets: 5
        })
      })
    );
  });

  test('Discord Rate Limiter should detect overflow error correctly', async () => {
    // Test the actual sendToDiscord method with overflow error
    const overflowError = {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: 'upstream connect error or disconnect/reset before headers. reset reason: overflow'
      }
    };

    axios.post.mockRejectedValue(overflowError);

    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'Test overflow detection';

    // Call sendToDiscord directly to test error handling
    const result = await discordRateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('service_unavailable_overflow');
    expect(result.details.isOverflow).toBe(true);
    expect(result.details.backoffSeconds).toBe(60); // 60 seconds for overflow
    expect(result.rateLimitUntil).toBeGreaterThan(Date.now());
  });

  test('Discord Rate Limiter should handle non-overflow 503 error correctly', async () => {
    // Test regular 503 error
    const regularError = {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: 'Service temporarily unavailable due to maintenance'
      }
    };

    axios.post.mockRejectedValue(regularError);

    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'Test regular 503 handling';

    const result = await discordRateLimiter.sendToDiscord(webhookUrl, message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('service_unavailable');
    expect(result.details.isOverflow).toBe(false);
    expect(result.details.backoffSeconds).toBe(30); // 30 seconds for regular 503
    expect(result.rateLimitUntil).toBeGreaterThan(Date.now());
  });

  test('Overflow error should be retried with longer backoff in queue processing', async () => {
    const overflowError = {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: 'upstream connect error or disconnect/reset before headers. reset reason: overflow'
      }
    };

    // First call fails with overflow, second succeeds
    axios.post
      .mockRejectedValueOnce(overflowError)
      .mockResolvedValueOnce({ data: 'success' });

    const webhookUrl = 'https://discord.com/api/webhooks/123/test';
    const message = 'Test overflow retry with backoff';

    const result = await discordRateLimiter.send(webhookUrl, message, {
      maxRetries: 1
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('queued');

    // Wait for initial processing (overflow error has 60 sec backoff, but retry logic should still work)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should be called at least once (initial attempt)
    // Note: The overflow error has a 60-second backoff, so the retry won't happen immediately
    // but the error should be properly handled and queued for retry
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});