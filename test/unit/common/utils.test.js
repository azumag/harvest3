/**
 * Tests for src/common/utils.js
 */
const utils = require('../../../src/common/utils');

// Mock the notifications module to avoid actual Discord posts in tests
jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn()
}));

describe('Utils module', () => {
  describe('weightedAverage function', () => {
    test('calculates weighted average correctly', () => {
      const prices = [100, 200, 300];
      const amounts = [1, 2, 1];

      // Expected result: (100*1 + 200*2 + 300*1) / (1+2+1) = 800/4 = 200
      const result = utils.weightedAverage(prices, amounts);

      expect(result).toBe(200);
    });

    test('handles single item arrays', () => {
      const prices = [150];
      const amounts = [3];

      const result = utils.weightedAverage(prices, amounts);

      expect(result).toBe(150);
    });
  });

  describe('timeframeToMs function', () => {
    test('converts minutes correctly', () => {
      expect(utils.timeframeToMs('1m')).toBe(60 * 1000);
      expect(utils.timeframeToMs('5m')).toBe(5 * 60 * 1000);
      expect(utils.timeframeToMs('15m')).toBe(15 * 60 * 1000);
    });

    test('converts hours correctly', () => {
      expect(utils.timeframeToMs('1h')).toBe(60 * 60 * 1000);
      expect(utils.timeframeToMs('4h')).toBe(4 * 60 * 60 * 1000);
    });

    test('converts days correctly', () => {
      expect(utils.timeframeToMs('1d')).toBe(24 * 60 * 60 * 1000);
      expect(utils.timeframeToMs('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    });

    test('converts weeks correctly', () => {
      expect(utils.timeframeToMs('1w')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(utils.timeframeToMs('2w')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    });

    test('throws error for unknown units', () => {
      expect(() => utils.timeframeToMs('1x')).toThrow('Unknown timeframe unit: x');
    });
  });

  describe('sleep function', () => {
    test('sleeps for approximately the given time', async () => {
      const sleepTime = 100; // 100ms
      const start = Date.now();

      await utils.sleep(sleepTime);

      const elapsed = Date.now() - start;

      // Allow for some timing variation but ensure it's at least close to the expected time
      expect(elapsed).toBeGreaterThanOrEqual(sleepTime - 10);
    });
  });

  describe('fetchTotal function', () => {
    test('calculates profit/loss correctly from trades', async () => {
      // Mock exchange object
      const mockExchange = {
        fetchMyTrades: jest.fn().mockResolvedValue([
          { side: 'buy', price: 100, amount: 2, fee: { currency: 'JPY', cost: 10 } },
          { side: 'sell', price: 120, amount: 2, fee: { currency: 'JPY', cost: 10 } }
        ])
      };

      const result = await utils.fetchTotal(mockExchange, 'BTC/JPY');

      // Buy: 100 * 2 + 10 = 210
      // Sell: 120 * 2 - 10 = 230
      // Total P/L: 230 - 210 = 20
      expect(result).toBe(20);
      expect(mockExchange.fetchMyTrades).toHaveBeenCalledWith('BTC/JPY', expect.any(Number));
    });

    test('handles trades with non-JPY fees', async () => {
      // Mock exchange object with non-JPY fee
      const mockExchange = {
        fetchMyTrades: jest.fn().mockResolvedValue([
          { side: 'buy', price: 100, amount: 2, fee: { currency: 'BTC', cost: 0.1 } },
          { side: 'sell', price: 120, amount: 2, fee: { currency: 'BTC', cost: 0.1 } }
        ])
      };

      const result = await utils.fetchTotal(mockExchange, 'BTC/JPY');

      // Buy: 100 * (2 - 0.1) = 100 * 1.9 = 190
      // Sell: 120 * (2 - 0.1) = 120 * 1.9 = 228
      // Total P/L: 228 - 190 = 38
      expect(result).toBe(38);
    });

    test('handles trades with no fees', async () => {
      // Mock exchange object with no fees
      const mockExchange = {
        fetchMyTrades: jest.fn().mockResolvedValue([
          { side: 'buy', price: 100, amount: 2 },
          { side: 'sell', price: 120, amount: 2 }
        ])
      };

      const result = await utils.fetchTotal(mockExchange, 'BTC/JPY');

      // Buy: 100 * 2 = 200
      // Sell: 120 * 2 = 240
      // Total P/L: 240 - 200 = 40
      expect(result).toBe(40);
    });

    test('returns 0 on error', async () => {
      // Mock exchange object that throws an error
      const mockExchange = {
        fetchMyTrades: jest.fn().mockRejectedValue(new Error('API error'))
      };

      const result = await utils.fetchTotal(mockExchange, 'BTC/JPY');

      expect(result).toBe(0);
    });
  });
});