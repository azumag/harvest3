
const LRUCache = require('lru-cache');

class MarketDataProvider {
    constructor(ttl = 5000) { // Time-to-live for cache in milliseconds (default: 5 seconds, throttle queue対応)
        this.cache = new LRUCache({
            max: 500, // Max number of items in cache
            ttl: ttl, // Time to live for cache entries
            updateAgeOnGet: true, // Update item age on get
        });
        this.pendingRequests = new Map(); // To prevent multiple concurrent requests for the same symbol
    }

    /**
     * Fetches ticker information, utilizing a cache to reduce API calls.
     * @param {object} exchange - The exchange object (e.g., ccxt exchange instance).
     * @param {string} symbol - The trading pair symbol (e.g., 'LTC/JPY').
     * @returns {Promise<object>} - The ticker information.
     */
    async fetchTicker(exchange, symbol) {
        const cacheKey = `${exchange.id}:${symbol}`;

        // Check cache first
        const cachedTicker = this.cache.get(cacheKey);
        if (cachedTicker) {
            return cachedTicker;
        }

        // If a request is already pending, wait for it
        if (this.pendingRequests.has(cacheKey)) {
            return this.pendingRequests.get(cacheKey);
        }

        // No cache and no pending request, make a new request
        const requestPromise = (async () => {
            try {
                const ticker = await exchange.fetchTicker(symbol);
                this.cache.set(cacheKey, ticker); // Cache the result
                return ticker;
            } catch (error) {
                console.error(`Failed to fetch ticker for ${symbol} from ${exchange.id}:`, error.message);
                throw error; // Re-throw the error after logging
            } finally {
                this.pendingRequests.delete(cacheKey); // Remove from pending requests
            }
        })();

        this.pendingRequests.set(cacheKey, requestPromise);
        return requestPromise;
    }

    /**
     * Clears the entire cache.
     */
    clearCache() {
        this.cache.clear();
        this.pendingRequests.clear();
        console.log('MarketDataProvider cache cleared.');
    }
}

module.exports = new MarketDataProvider(); // Export a singleton instance
