/**
 * Tests for balanceChecker Issue #2456 fixes
 * ENJ重複ログとシステム的問題検出機能のテスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'ENJ/JPY'],
        instance: {
          id: 'bitbank',
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
  getClient: jest.fn().mockReturnValue({ isReady: true }),
  getAllPositionsRedis: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn().mockResolvedValue({ isReady: true })
}));

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger');

const {
  compareBalances,
  getExchangeBalance,
  getBotManagedBalance
} = require('../../../src/common/balanceChecker');

const { getValidatedConfig } = require('../../../src/common/balanceCheckerConfig');
const { postOrderToDiscord } = require('../../../src/common/notifications');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { withBitbankErrorHandling } = require('../../../src/common/bitbankErrorHandler');

describe('BalanceChecker Issue #2456 Fixes', () => {
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Logger mock
    const Logger = require('../../../src/hft/utils/Logger');
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    Logger.mockImplementation(() => mockLogger);
  });

  describe('通貨重複処理の改善', () => {
    it('正規化後に重複する通貨を適切に処理する', async () => {
      // Setup: 大文字小文字が異なる同じ通貨
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'enj': 100.5,    // 小文字
          'ENJ': 0.001,    // 大文字（重複）
          'BTC': 0.5
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'ENJ/JPY',
          side: 'buy',
          amount: 50.0,
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 重複通貨が適切に統合され、ENJとBTCの2つの不整合が検出されることを確認
      expect(result.discrepancies.length).toBe(2);
      const enjDiscrepancies = result.discrepancies.filter(d => d.currency === 'ENJ');
      expect(enjDiscrepancies.length).toBe(1);
      expect(enjDiscrepancies[0].currency).toBe('ENJ');
    });

    it('通貨名の正規化が一貫して適用される', async () => {
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          ' btc ': 1.0,      // 前後に空白
          'eth\t': 2.0,      // タブ文字
          'LTC': 3.0         // 正常
        }
      });

      getAllPositionsRedis.mockResolvedValue([]);

      const result = await compareBalances('bitbank');

      // 全通貨が正規化されて処理されることを確認
      if (result.discrepancies.length > 0) {
        result.discrepancies.forEach(disc => {
          expect(disc.currency).toMatch(/^[A-Z]+$/); // 大文字のみ
          expect(disc.currency).not.toMatch(/\s/);   // 空白なし
        });
      }
    });
  });

  describe('システム的問題検出機能', () => {
    it('大規模な残高不整合をシステム問題として検出する', async () => {
      // Setup: 複数通貨でBot残高がほぼゼロ（5通貨以上で80%以上がゼロに近い）
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'BTC': 1.0,
          'ETH': 2.0,
          'ENJ': 100.0,
          'XLM': 50.0,
          'QTUM': 30.0,
          'BAT': 25.0
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        // 全通貨でBot残高がほぼゼロになるように設定（6通貨中5通貨がほぼゼロ = 83%）
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'ETH/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'ENJ/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'XLM/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'QTUM/JPY', side: 'buy', amount: 0.0001, status: 'open' }
        // BATは残高がないため自動的にBot残高=0になる
      ]);

      const result = await compareBalances('bitbank');

      // システム問題検出のログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('システム的問題を検出')
      );

      // Discord通知にシステム警告が含まれることを確認
      expect(postOrderToDiscord).toHaveBeenCalledWith(
        expect.stringContaining('システム')
      );
    });

    it('90%以上の高い差異が多数の場合、システム問題として検出する', async () => {
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'BTC': 1.0,
          'ETH': 2.0,
          'ENJ': 3.0
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.05,  // 95%の差異
          status: 'open'
        },
        {
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 0.1,   // 95%の差異
          status: 'open'
        },
        {
          symbol: 'ENJ/JPY',
          side: 'buy',
          amount: 0.15,  // 95%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 3通貨すべてが90%以上の差異でシステム問題として検出されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('システム的問題を検出')
      );
    });

    it('軽微な不整合の場合、システム問題として検出されない', async () => {
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'BTC': 1.0,
          'ETH': 2.0
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.96,  // 4%の差異
          status: 'open'
        },
        {
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 1.92,  // 4%の差異
          status: 'open'
        }
      ]);

      await compareBalances('bitbank');

      // システム問題として検出されないことを確認
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('システム的問題を検出')
      );
    });
  });

  describe('拡張Discord通知機能', () => {
    it('システム緊急警告メッセージが適切にフォーマットされる', async () => {
      // Setup: Critical level システム問題
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'BTC': 1.0,
          'ETH': 2.0,
          'ENJ': 3.0,
          'XLM': 4.0,
          'QTUM': 5.0
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        // すべてBot残高がほぼゼロ
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'ETH/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'ENJ/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'XLM/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'QTUM/JPY', side: 'buy', amount: 0.0001, status: 'open' }
      ]);

      await compareBalances('bitbank');

      const discordMessage = postOrderToDiscord.mock.calls[0][0];
      
      // システム緊急警告のメッセージが含まれることを確認
      expect(discordMessage).toContain('🔥');
      expect(discordMessage).toContain('システム緊急警告');
      expect(discordMessage).toContain('**推奨対応**');
      expect(discordMessage).toContain('Redis接続とポジションデータの整合性を緊急確認');
      expect(discordMessage).toContain('**追加確認事項**');
      expect(discordMessage).toContain('Docker環境のRedisサービス状態確認');
    });

    it('システム警告レベルのメッセージが適切にフォーマットされる', async () => {
      // Setup: High level システム問題
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'BTC': 1.0,
          'ETH': 2.0,
          'ENJ': 3.0
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        // 90%以上の高い差異
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },
        { symbol: 'ETH/JPY', side: 'buy', amount: 0.1, status: 'open' },
        { symbol: 'ENJ/JPY', side: 'buy', amount: 0.15, status: 'open' }
      ]);

      await compareBalances('bitbank');

      const discordMessage = postOrderToDiscord.mock.calls[0][0];
      
      // システム警告のメッセージが含まれることを確認
      expect(discordMessage).toContain('⚠️');
      expect(discordMessage).toContain('システム警告');
      expect(discordMessage).toContain('データ同期プロセスの確認が必要');
    });

    it('通常の外部取引の場合、従来のメッセージが表示される', async () => {
      // Setup: 通常の外部取引パターン
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'BTC': 1.0
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.25,  // 75%の差異（外部取引の可能性）
          status: 'open'
        }
      ]);

      await compareBalances('bitbank');

      const discordMessage = postOrderToDiscord.mock.calls[0][0];
      
      // 従来の外部取引メッセージが表示されることを確認
      expect(discordMessage).toContain('💡');
      expect(discordMessage).toContain('外部取引による残高差異検出');
      expect(discordMessage).toContain('外部取引が原因の可能性があります');
    });
  });

  describe('Issue #2456 specific scenario', () => {
    it('ENJ重複ログ問題のシナリオを再現して修正を確認', async () => {
      // Issue #2456で報告された実際のシナリオを再現
      withBitbankErrorHandling.mockResolvedValue({
        total: {
          'XLM': 13.0594,
          'QTUM': 6.0666,
          'BAT': 5.6061,
          'OMG': 0.9147,
          'XYM': 235.6213,
          'LINK': 0.1798,
          'MKR': 0.0093,
          'BOBA': 9.8464,
          'ENJ': 33.5976,
          'enj': 33.5976  // 重複エントリ（小文字）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'XLM/JPY', side: 'buy', amount: 0, status: 'open' },
        { symbol: 'QTUM/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'BAT/JPY', side: 'buy', amount: 0.017, status: 'open' },
        { symbol: 'OMG/JPY', side: 'buy', amount: 0.0271, status: 'open' },
        { symbol: 'XYM/JPY', side: 'buy', amount: 0.4081, status: 'open' },
        { symbol: 'LINK/JPY', side: 'buy', amount: 0, status: 'open' },
        { symbol: 'MKR/JPY', side: 'buy', amount: 0, status: 'open' },
        { symbol: 'BOBA/JPY', side: 'buy', amount: 0.0724, status: 'open' },
        { symbol: 'ENJ/JPY', side: 'buy', amount: 0.0014, status: 'open' }
      ]);

      const result = await compareBalances('bitbank');

      // ENJが重複して報告されないことを確認
      const enjDiscrepancies = result.discrepancies.filter(d => d.currency === 'ENJ');
      expect(enjDiscrepancies.length).toBe(1);

      // 複数の不整合が検出されることを確認（Issue #2456の実際の状況）
      expect(result.discrepancies.length).toBeGreaterThan(5);

      // システム問題として検出されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('システム的問題を検出')
      );

      // 適切な警告メッセージが生成されることを確認
      const discordMessage = postOrderToDiscord.mock.calls[0][0];
      expect(discordMessage).toContain('システム');
      expect(discordMessage).toContain('Redis接続');
    });
  });
});