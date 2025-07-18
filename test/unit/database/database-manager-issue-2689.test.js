/**
 * Database Manager Issue #2689 テスト
 * Redis分散ロック解放時のeval引数の明示的文字列変換修正のテスト
 */

const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  multi: jest.fn().mockReturnValue({
    set: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(['OK'])
  })
};

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => mockRedisClient)
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

describe('Database Manager Issue #2689: Redis eval引数の明示的文字列変換修正', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.eval.mockReset();
    mockRedisClient.set.mockReset();
    mockRedisClient.get.mockReset();
    delete require.cache[require.resolve('../../../src/database/manager')];
    manager = require('../../../src/database/manager');
  });

  describe('releaseDistributedLock - Redis eval引数の文字列変換', () => {
    it('String()による明示的文字列変換が実装されていることを確認', async () => {
      // 実装確認: String()がeval呼び出しに使用されているかを検証
      const { readFileSync } = require('fs');
      const { resolve } = require('path');
      
      const managerPath = resolve(__dirname, '../../../src/database/manager.js');
      const managerSource = readFileSync(managerPath, 'utf-8');
      
      // String()による明示的変換がeval呼び出しで使用されていることを確認
      expect(managerSource).toMatch(/String\s*\(\s*lockInfo\.lockKey\s*\)/);
      expect(managerSource).toMatch(/String\s*\(\s*lockInfo\.lockValue\s*\)/);
      expect(managerSource).toMatch(/redisClient\.eval\s*\(.*String\s*\(\s*lockInfo\.lockKey\s*\)/);
      expect(managerSource).toMatch(/redisClient\.eval\s*\(.*String\s*\(\s*lockInfo\.lockValue\s*\)/);
    });

    it('関数が正常にエクスポートされていることを確認', () => {
      expect(typeof manager.releaseDistributedLock).toBe('function');
      expect(typeof manager.acquireDistributedLock).toBe('function');
    });
  });
});