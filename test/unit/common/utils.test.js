/**
 * Tests for src/common/utils.js
 */
const utils = require('../../../src/common/utils');

// Mock the notifications module to avoid actual Discord posts in tests
jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn()
}));

describe('Utils module', () => {
  
  // Issue #5657: 通貨ペアスラッシュ対応テスト
  describe('validateLockParameters function', () => {
    test('通貨ペアにスラッシュが含まれるロックキーを許可', () => {
      const testCases = [
        'lock:trade:bitbank:QTUM/JPY:1418933216',
        'lock:trade:bitbank:BTC/JPY:123456',
        'lock:trade:coincheck:ETH/USD:789012'
      ];

      for (const lockKey of testCases) {
        const result = utils.validateLockParameters(lockKey, 'test_value_123');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    test('無効な文字を含むロックキーは拒否', () => {
      const invalidTestCases = [
        'lock:trade:bitbank:QTUM*JPY:123456',   // アスタリスク
        'lock:trade:bitbank:QTUM@JPY:123456',   // アットマーク  
        'lock:trade:bitbank:QTUM JPY:123456',   // スペース
        'lock:trade:bitbank:QTUM\nJPY:123456'   // 改行
      ];

      for (const lockKey of invalidTestCases) {
        const result = utils.validateLockParameters(lockKey, 'test_value_123');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('lockKeyに無効な文字が含まれています');
      }
    });

    test('正常な文字のみのロックキーは引き続き許可', () => {
      const validTestCases = [
        'lock:trade:bitbank:normal_key:123456',
        'lock:trade:coincheck:another-key.test:789012',
        'simple:key:123'
      ];

      for (const lockKey of validTestCases) {
        const result = utils.validateLockParameters(lockKey, 'test_value_123');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    test('空のlockKeyやlockValueは拒否', () => {
      expect(utils.validateLockParameters('', 'value').valid).toBe(false);
      expect(utils.validateLockParameters('key', '').valid).toBe(false);
      expect(utils.validateLockParameters(null, 'value').valid).toBe(false);
      expect(utils.validateLockParameters('key', null).valid).toBe(false);
    });
  });

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

  describe('validateLockParameters function', () => {
    test('returns valid for correct parameters', () => {
      const result = utils.validateLockParameters('validKey', 'validValue');
      
      expect(result).toEqual({ valid: true });
    });

    test('rejects null lockKey', () => {
      const result = utils.validateLockParameters(null, 'validValue');
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockKey (null)'
      });
    });

    test('rejects undefined lockKey', () => {
      const result = utils.validateLockParameters(undefined, 'validValue');
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockKey (undefined)'
      });
    });

    test('rejects empty string lockKey', () => {
      const result = utils.validateLockParameters('', 'validValue');
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockKey ()'
      });
    });

    test('rejects whitespace-only lockKey', () => {
      const result = utils.validateLockParameters('   ', 'validValue');
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockKey (   )'
      });
    });

    test('rejects non-string lockKey', () => {
      const result = utils.validateLockParameters(123, 'validValue');
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockKey (123)'
      });
    });

    test('rejects null lockValue', () => {
      const result = utils.validateLockParameters('validKey', null);
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockValue (null)'
      });
    });

    test('rejects undefined lockValue', () => {
      const result = utils.validateLockParameters('validKey', undefined);
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockValue (undefined)'
      });
    });

    test('rejects empty string lockValue', () => {
      const result = utils.validateLockParameters('validKey', '');
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockValue ()'
      });
    });

    test('rejects whitespace-only lockValue', () => {
      const result = utils.validateLockParameters('validKey', '   ');
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockValue (   )'
      });
    });

    test('rejects non-string lockValue', () => {
      const result = utils.validateLockParameters('validKey', 456);
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockValue (456)'
      });
    });

    test('rejects both null parameters', () => {
      const result = utils.validateLockParameters(null, null);
      
      expect(result).toEqual({
        valid: false,
        error: '無効なlockKey (null)'
      });
    });

    test('accepts valid string parameters with extra context', () => {
      const result = utils.validateLockParameters('myKey', 'myValue', 'testContext');
      
      expect(result).toEqual({ valid: true });
    });
  });
});