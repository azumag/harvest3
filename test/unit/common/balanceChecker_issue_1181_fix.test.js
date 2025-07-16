/**
 * Issue #1181 修正のテスト
 * 浮動小数点精度問題と重複エントリの問題を修正
 */

const { config } = require('../../../src/config');
const { postErrorToDiscord, postOrderToDiscord } = require('../../../src/common/notifications');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { initRedisClient } = require('../../../src/database/redisClient');

// モック設定
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        instance: {
          fetchBalance: jest.fn()
        }
      }
    }
  }
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => ({
    isReady: true
  })),
  getAllPositionsRedis: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn(() => ({
    isReady: true
  }))
}));

describe('Issue #1181 修正テスト', () => {
  let balanceChecker;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // バランスチェッカーモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/common/balanceChecker')];
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('浮動小数点精度の修正', () => {
    test('浮動小数点演算による精度問題が修正されていること', async () => {
      // 浮動小数点精度問題を再現するデータ
      const exchangeAmount = 0.9271;
      const botAmount = 0.0023;
      const expectedDifference = 0.9248; // 正確な差異値
      
      // 取引所残高のモック
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          'XRP': exchangeAmount
        }
      });
      
      // Bot管理残高のモック
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'XRP/JPY',
          side: 'buy',
          amount: botAmount,
          status: 'open'
        }
      ]);
      
      // 比較実行
      const result = await balanceChecker.compareBalances('bitbank');
      
      // 不整合が検出されることを確認
      expect(result.discrepancies).toHaveLength(1);
      
      const discrepancy = result.discrepancies[0];
      
      // 浮動小数点精度が修正されていることを確認
      expect(discrepancy.difference).toBeCloseTo(expectedDifference, 8);
      expect(discrepancy.discrepancyPercent).toBeCloseTo(99.75, 2);
      
      // 精度問題による不正確な値でないことを確認
      expect(discrepancy.difference).not.toBe(0.9248000000000001);
      expect(discrepancy.difference.toString()).not.toMatch(/0000000/);
    });
  });

  describe('重複エントリの修正', () => {
    test('重複する通貨エントリが排除されること', async () => {
      // 重複データを含むテストケース
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          'XRP': 0.9271,
          'xrp': 0.0001,  // 小文字版（重複として扱われるべき）
          'BTC': 0.0472
        }
      });
      
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'XRP/JPY',
          side: 'buy',
          amount: 0.0023,
          status: 'open'
        },
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.0100,
          status: 'open'
        }
      ]);
      
      // 比較実行
      const result = await balanceChecker.compareBalances('bitbank');
      
      // 重複が排除されていることを確認
      const currencies = result.discrepancies.map(d => d.currency);
      const uniqueCurrencies = [...new Set(currencies)];
      
      expect(currencies).toEqual(uniqueCurrencies);
      expect(result.discrepancies).toHaveLength(2); // XRP と BTC のみ
      
      // 正規化された通貨名が使用されていることを確認
      expect(result.discrepancies.find(d => d.currency === 'XRP')).toBeDefined();
      expect(result.discrepancies.find(d => d.currency === 'BTC')).toBeDefined();
      expect(result.discrepancies.find(d => d.currency === 'xrp')).toBeUndefined();
    });
    
    test('通貨名の正規化が正しく動作すること', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          ' eth ': 1.0,  // 前後にスペース
          'ETH': 0.1,    // 大文字版（重複）
          'btc': 0.5     // 小文字
        }
      });
      
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 0.5,
          status: 'open'
        },
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.1,
          status: 'open'
        }
      ]);
      
      const result = await balanceChecker.compareBalances('bitbank');
      
      // 正規化された通貨名が使用されていることを確認
      const currencies = result.discrepancies.map(d => d.currency);
      expect(currencies).toEqual(['BTC', 'ETH']);
      
      // 重複が排除されていることを確認
      expect(result.discrepancies).toHaveLength(2);
    });
  });

  describe('Discord通知の改善', () => {
    test('修正された値がDiscord通知に反映されること', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          'XRP': 0.9271
        }
      });
      
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'XRP/JPY',
          side: 'buy',
          amount: 0.0023,
          status: 'open'
        }
      ]);
      
      await balanceChecker.compareBalances('bitbank');
      
      // Discord通知が送信されることを確認
      expect(postOrderToDiscord).toHaveBeenCalledTimes(1);
      
      const discordMessage = postOrderToDiscord.mock.calls[0][0];
      
      // 正確な値が通知に含まれていることを確認
      expect(discordMessage).toContain('XRP');
      expect(discordMessage).toContain('0.92710000'); // 取引所残高
      expect(discordMessage).toContain('0.00230000'); // Bot残高
      expect(discordMessage).toContain('99.75%');     // 差異パーセント
      
      // 不正確な浮動小数点値が含まれていないことを確認
      expect(discordMessage).not.toContain('0.9248000000000001');
    });
  });

  describe('エラーハンドリングの改善', () => {
    test('Redis接続エラーが適切に処理されること', async () => {
      // Redis接続エラーをシミュレート
      getAllPositionsRedis.mockRejectedValue(new Error('Redis connection failed'));
      
      await expect(balanceChecker.compareBalances('bitbank')).rejects.toThrow();
      
      // エラー通知が送信されることを確認
      expect(postErrorToDiscord).toHaveBeenCalledTimes(1);
      
      const errorMessage = postErrorToDiscord.mock.calls[0][0];
      expect(errorMessage).toContain('Redis接続エラー');
      expect(errorMessage).toContain('strategy-runnerサービスとRedisサービス間の接続を確認してください');
    });
  });
});