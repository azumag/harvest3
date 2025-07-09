/**
 * API Resilience Manager - Enhanced timeout and retry handling
 * Prevents API timeout cascading failures
 */

const { postErrorToDiscord } = require('./notifications');

class APIResilienceManager {
  constructor() {
    this.retryQueue = new Map();
    this.failureCount = new Map();
    this.lastSuccessTime = new Map();
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.maxDelay = 30000; // 30 seconds
  }

  /**
   * Execute API call with resilience (timeout, retry, circuit breaker)
   */
  async executeWithResilience(apiCall, context = {}) {
    const { exchangeId = 'unknown', symbol = 'unknown', operation = 'unknown' } = context;
    const key = `${exchangeId}:${symbol}:${operation}`;

    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[APIResilience] ${key} - Attempt ${attempt}/${this.maxRetries}`);

        // Check circuit breaker
        if (this.isCircuitOpen(key)) {
          throw new Error(`Circuit breaker open for ${key}`);
        }

        // Execute with timeout protection
        const result = await Promise.race([
          apiCall(),
          this.createTimeoutPromise(context.timeout || 25000)
        ]);

        // Success - reset failure count
        this.recordSuccess(key);
        console.log(`[APIResilience] ${key} - SUCCESS (attempt ${attempt})`);
        return result;

      } catch (error) {
        lastError = error;
        this.recordFailure(key);

        console.warn(`[APIResilience] ${key} - FAILED attempt ${attempt}: ${error.message}`);

        // Don't retry on certain errors
        if (this.isNonRetryableError(error) || attempt === this.maxRetries) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = Math.min(this.baseDelay * Math.pow(2, attempt - 1), this.maxDelay);
        console.log(`[APIResilience] ${key} - Waiting ${delay}ms before retry...`);
        await this.sleep(delay);
      }
    }

    // All retries failed
    const errorMsg = `API resilience failed for ${key} after ${this.maxRetries} attempts: ${lastError.message}`;
    console.error(`[APIResilience] ${errorMsg}`);

    // Send Discord notification for critical failures
    if (context.notifyOnFailure !== false) {
      await this.notifyFailure(key, lastError, this.maxRetries);
    }

    throw new Error(errorMsg);
  }

  /**
   * Create timeout promise that rejects after specified time
   */
  createTimeoutPromise(timeoutMs) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`API call timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Check if circuit breaker is open (too many recent failures)
   */
  isCircuitOpen(key) {
    const failures = this.failureCount.get(key) || 0;
    const lastSuccess = this.lastSuccessTime.get(key) || 0;
    const timeSinceLastSuccess = Date.now() - lastSuccess;

    // Circuit is open if: 5+ failures AND no success in last 5 minutes
    return failures >= 5 && timeSinceLastSuccess > 5 * 60 * 1000;
  }

  /**
   * Record successful API call
   */
  recordSuccess(key) {
    this.failureCount.set(key, 0);
    this.lastSuccessTime.set(key, Date.now());
  }

  /**
   * Record failed API call
   */
  recordFailure(key) {
    const current = this.failureCount.get(key) || 0;
    this.failureCount.set(key, current + 1);
  }

  /**
   * Check if error should not be retried
   */
  isNonRetryableError(error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('authentication') ||
      message.includes('authorization') ||
      message.includes('forbidden') ||
      message.includes('invalid symbol') ||
      message.includes('invalid parameter')
    );
  }

  /**
   * Send failure notification to Discord
   */
  async notifyFailure(key, error, attempts) {
    try {
      const message = '🚨 **API Resilience Failure**\n' +
                     `Service: ${key}\n` +
                     `Attempts: ${attempts}\n` +
                     `Error: ${error.message}\n` +
                     `Time: ${new Date().toLocaleString('ja-JP')}\n` +
                     '⚠️ Circuit breaker may activate';

      await postErrorToDiscord(message);
    } catch (notifyError) {
      console.error('[APIResilience] Failed to send Discord notification:', notifyError.message);
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get statistics for monitoring
   */
  getStats() {
    return {
      retryQueueSize: this.retryQueue.size,
      failureCounts: Object.fromEntries(this.failureCount),
      lastSuccessTimes: Object.fromEntries(this.lastSuccessTime)
    };
  }
}

// Singleton instance
const apiResilienceManager = new APIResilienceManager();

module.exports = { APIResilienceManager, apiResilienceManager };