/**
 * BalanceChecker Issue #2709 テスト
 * Redis分散ロック解放時のLua引数型エラー修正のテスト
 */

// Mock dependencies
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

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  isConnected: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/common/utils', () => ({
  validateLockParameters: jest.fn()
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn()
}));

const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn()
};

const mockRedisDatabase = require('../../../src/database/redisDatabase');
const mockUtils = require('../../../src/common/utils');
mockRedisDatabase.getClient.mockReturnValue(mockRedisClient);
mockRedisDatabase.isConnected.mockReturnValue(true);

describe('BalanceChecker Issue #2709: Redis Lua引数型エラー修正', () => {
  let balanceChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUtils.validateLockParameters.mockReturnValue({ valid: true });
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - 制御文字・非印字文字のサニタイズ', () => {
    it('正常な文字列の場合はサニタイズされずに処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'normal-lock-id-123');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test',
        'normal-lock-id-123'
      );
    });

    it('制御文字を含むlockKeyはサニタイズされる', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      // \x01 (SOH), \x1F (US), \x7F (DEL) などの制御文字を含むテスト
      const result = await balanceChecker.releaseDistributedLock('balance\x01_checker\x1F_lock:test\x7F', 'lock-id');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test', // 制御文字が除去されている
        'lock-id'
      );
    });

    it('非印字文字を含むlockIdはサニタイズされる', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      // \x80-\x9F の非印字文字を含むテスト
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'lock\x80id\x9F123');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test',
        'lockid123' // 非印字文字が除去されている
      );
    });

    it('タブ文字（\\t）と改行文字（\\n）は制御文字として除去される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance\t_checker_lock:test\n', 'lock\tid\n');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test', // タブと改行が除去されている
        'lockid' // タブと改行が除去されている
      );
    });

    it('サニタイズ後に空文字列になる場合はfalseを返し、Redis呼び出しを避ける', async () => {
      // 制御文字のみで構成された文字列
      const result = await balanceChecker.releaseDistributedLock('\x01\x02\x03', '\t\n\r');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('先頭末尾の空白はtrimされる', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('  balance_checker_lock:test  ', '  lock-id-123  ');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test', // 先頭末尾の空白が除去されている
        'lock-id-123' // 先頭末尾の空白が除去されている
      );
    });

    it('複合的な問題文字を含む場合の包括的なサニタイズ', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      // 制御文字、非印字文字、先頭末尾空白の組み合わせ
      const result = await balanceChecker.releaseDistributedLock(
        ' \x01balance\x80_checker\t_lock:test\x9F \n',
        '\r lock\x1F-id\x7F-123\x85 \t'
      );
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test', // 全ての問題文字が除去されている
        'lock-id-123' // 全ての問題文字が除去されている
      );
    });

    it('Redisエラーが発生した場合はfalseを返し、エラーログを出力する', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('ERR Lua redis lib command arguments must be strings or integers'));
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'lock-id');
      
      expect(result).toBe(false);
    });
  });

  describe('acquireDistributedLock - lockId生成時の文字列安全性', () => {
    it('正常なlockId生成時に不正な文字が含まれないことを確認', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      
      const lockId = await balanceChecker.acquireDistributedLock('balance_checker_lock:test');
      
      expect(lockId).toBeTruthy();
      expect(typeof lockId).toBe('string');
      // 生成されたlockIdに制御文字が含まれないことを確認
      expect(lockId).toMatch(/^[0-9]+-[a-z0-9]+$/);
    });
  });
});