/**
 * Issue #1873 修正のテスト
 * strategy-runnerサービスでの重複ログ問題の修正
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

// Logger のモック
const mockLoggerInstance = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
};

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => mockLoggerInstance);
});

describe('Issue #1873 修正テスト - 重複ログ問題', () => {
  let balanceChecker;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // バランスチェッカーモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/common/balanceChecker')];
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('MANA重複ログの修正', () => {
    test('同一MANAエントリの重複ログが防止されること', async () => {
      // Issue #1873で報告されたMANAの具体的なケースを再現
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          'MANA': 4.4588,
          'AVAX': 0.0141,
          'AXS': 0.1488,
          'FLR': 235.7937,
          'SAND': 16.288,
          'GALA': 273.3722,
          'CHZ': 14.0043,
          'APE': 0.9309,
          'OAS': 921.0375
        }
      });
      
      // Bot管理残高のモック（実際のログに基づく）
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'MANA/JPY',
          side: 'buy',
          amount: 0.009,
          status: 'open'
        },
        {
          symbol: 'AVAX/JPY',
          side: 'buy',
          amount: 0.0002,
          status: 'open'
        },
        {
          symbol: 'AXS/JPY',
          side: 'buy',
          amount: 0.0021,
          status: 'open'
        },
        {
          symbol: 'FLR/JPY',
          side: 'buy',
          amount: 0,
          status: 'open'
        },
        {
          symbol: 'SAND/JPY',
          side: 'buy',
          amount: 0.0032,
          status: 'open'
        },
        {
          symbol: 'GALA/JPY',
          side: 'buy',
          amount: 0.0073,
          status: 'open'
        },
        {
          symbol: 'CHZ/JPY',
          side: 'buy',
          amount: 0.0999,
          status: 'open'
        },
        {
          symbol: 'APE/JPY',
          side: 'buy',
          amount: 0.0035,
          status: 'open'
        },
        {
          symbol: 'OAS/JPY',
          side: 'buy',
          amount: 0,
          status: 'open'
        }
      ]);
      
      // 比較実行
      const result = await balanceChecker.compareBalances('bitbank');
      
      // 不整合が検出されることを確認
      expect(result.discrepancies.length).toBeGreaterThan(0);
      
      // MANAの不整合データを特定
      const manaDiscrepancy = result.discrepancies.find(d => d.currency === 'MANA');
      expect(manaDiscrepancy).toBeDefined();
      expect(manaDiscrepancy.exchangeAmount).toBeCloseTo(4.4588, 4);
      expect(manaDiscrepancy.botAmount).toBeCloseTo(0.009, 3);
      expect(manaDiscrepancy.difference).toBeCloseTo(4.4498, 4);
      expect(Math.round(manaDiscrepancy.discrepancyPercent)).toBe(100); // 99.8% ≈ 100%
      
      // 重複がないことを確認
      const currencies = result.discrepancies.map(d => d.currency);
      const uniqueCurrencies = [...new Set(currencies)];
      expect(currencies).toHaveLength(uniqueCurrencies.length);
      
      // MANAが1回のみ処理されていることを確認
      const manaCount = currencies.filter(c => c === 'MANA').length;
      expect(manaCount).toBe(1);
    });
    
    test('強化された重複除去ロジックが機能すること', async () => {
      // 意図的に重複を含むテストデータ
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          'MANA': 4.4588,
          'mana': 0.001,  // 小文字版（重複として扱われるべき）
          'Mana': 0.002   // 混合ケース（重複として扱われるべき）
        }
      });
      
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'MANA/JPY',
          side: 'buy',
          amount: 0.009,
          status: 'open'
        }
      ]);
      
      const result = await balanceChecker.compareBalances('bitbank');
      
      // 重複除去により1件のMANAエントリのみが残ることを確認
      const manaEntries = result.discrepancies.filter(d => d.currency === 'MANA');
      expect(manaEntries).toHaveLength(1);
      
      // 重複除去の警告ログが出力されることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringContaining('通貨の重複処理を検出しスキップ')
      );
    });
    
    test('ログ出力時の重複防止が機能すること', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          'MANA': 4.4588
        }
      });
      
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'MANA/JPY',
          side: 'buy',
          amount: 0.009,
          status: 'open'
        }
      ]);
      
      await balanceChecker.compareBalances('bitbank');
      
      // INFOレベルのログが呼ばれることを確認（99.8%は外部取引として扱われる）
      const infoLogs = mockLoggerInstance.info.mock.calls;
      const manaLogs = infoLogs.filter(call => 
        call[0] && call[0].includes('MANA') && call[0].includes('[')
      );
      
      // MANAのログが1回のみ出力されることを確認
      expect(manaLogs).toHaveLength(1);
      
      // ログの内容が正しいことを確認
      const manaLog = manaLogs[0][0];
      expect(manaLog).toContain('MANA');
      expect(manaLog).toContain('4.4588');
      expect(manaLog).toContain('0.009');
      expect(manaLog).toContain('99.8%');
      expect(manaLog).toMatch(/\[\d+\]/); // インデックス番号が含まれていることを確認
    });
  });

  describe('緊急重複除去機能', () => {
    test('最終的な一意性チェックが機能すること', async () => {
      // 通常の処理では発生しないが、万が一重複が残った場合のテスト
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          'BTC': 1.0
        }
      });
      
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.5,
          status: 'open'
        }
      ]);
      
      const result = await balanceChecker.compareBalances('bitbank');
      
      // 正常ケースでは緊急重複除去は発生しない
      expect(mockLoggerInstance.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('緊急重複除去を実行')
      );
      
      // ログ出力数の不整合エラーも発生しない
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('ログ出力数不整合')
      );
    });
  });

  describe('元の通貨名の保持', () => {
    test('originalCurrency フィールドが適切に設定されること', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          ' mana ': 4.4588  // スペース付きの元通貨名
        }
      });
      
      getAllPositionsRedis.mockResolvedValue([
        {
          symbol: 'MANA/JPY',
          side: 'buy',
          amount: 0.009,
          status: 'open'
        }
      ]);
      
      const result = await balanceChecker.compareBalances('bitbank');
      
      const manaDiscrepancy = result.discrepancies.find(d => d.currency === 'MANA');
      expect(manaDiscrepancy).toBeDefined();
      expect(manaDiscrepancy.currency).toBe('MANA');
      expect(manaDiscrepancy.originalCurrency).toBe(' mana ');
      expect(manaDiscrepancy.processedAt).toBeDefined();
    });
  });
});