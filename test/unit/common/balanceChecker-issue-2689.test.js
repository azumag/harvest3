/**
 * BalanceChecker Issue #2689 テスト
 * Redis分散ロック解放時のeval引数の明示的文字列変換修正のテスト
 */

const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn()
};

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => mockRedisClient),
  isConnected: jest.fn(() => true)
}));

jest.mock('../../../src/common/utils', () => ({
  validateLockParameters: jest.fn(() => ({ valid: true }))
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY'],
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    }
  }
}));

jest.mock('../../../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    distributedLock: {
      lockKeyPrefix: 'balance_checker_lock',
      stateKey: 'balance_checker_state',
      defaultTtl: 300000,
      maxRetryAttempts: 3,
      retryDelay: 1000
    }
  }))
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn()
}));

describe('BalanceChecker Issue #2689: Redis eval引数の明示的文字列変換修正', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.eval.mockReset();
    mockRedisClient.set.mockReset();
    mockRedisClient.get.mockReset();
    delete require.cache[require.resolve('../../../src/common/balanceChecker')];
  });

  describe('releaseDistributedLock - Redis eval引数の文字列変換', () => {
    it('String()による明示的文字列変換が実装されていることを確認', async () => {
      // 実装確認: String()変換とvalidatedパラメータがeval呼び出しに使用されているかを検証
      const { readFileSync } = require('fs');
      const { resolve } = require('path');
      
      const balanceCheckerPath = resolve(__dirname, '../../../src/common/balanceChecker.js');
      const balanceCheckerSource = readFileSync(balanceCheckerPath, 'utf-8');
      
      // String()による明示的変換が事前に実装されていることを確認 (Issue #4963対応)
      expect(balanceCheckerSource).toMatch(/finalLockKey\s*=\s*String\s*\(\s*stringLockKey\s*\)/);
      expect(balanceCheckerSource).toMatch(/finalLockId\s*=\s*String\s*\(\s*stringLockId\s*\)/);
      // validatedされたfinalLockKey, finalLockIdがredisClient.evalに渡されることを確認
      expect(balanceCheckerSource).toMatch(/redisClient\.eval\s*\(.*,\s*finalLockKey\s*,\s*finalLockId\s*\)/);
    });

    it('関数が正常にエクスポートされていることを確認', () => {
      const balanceChecker = require('../../../src/common/balanceChecker');
      expect(typeof balanceChecker.releaseDistributedLock).toBe('function');
      expect(typeof balanceChecker.acquireDistributedLock).toBe('function');
    });
  });
});