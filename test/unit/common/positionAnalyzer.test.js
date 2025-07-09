/**
 * PositionAnalyzer単体テスト
 * TDD原則に従い、品質担保のためのテストを実装
 */

const { PositionAnalyzer } = require('../../../src/common/positionAnalyzer');

// Redis関数のモック化
jest.mock('../../../src/database/redisDatabase', () => ({
  getAllTradeSummaries: jest.fn()
}));

describe('PositionAnalyzer', () => {
  let analyzer;
  let mockExchange;
  let mockGetAllTradeSummaries;

  beforeEach(() => {
    // デフォルト設定でアナライザーを初期化
    analyzer = new PositionAnalyzer();
    
    // モック取引所の設定
    mockExchange = {
      fetchBalance: jest.fn()
    };

    // Redis関数のモック取得
    mockGetAllTradeSummaries = require('../../../src/database/redisDatabase').getAllTradeSummaries;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('初期化', () => {
    test('デフォルト設定で正常に初期化される', () => {
      expect(analyzer.options.toleranceThreshold).toBe(0.0001);
      expect(analyzer.options.logLevel).toBe('info');
      expect(analyzer.inconsistencies).toEqual([]);
    });

    test('カスタム設定で初期化される', () => {
      const customOptions = {
        toleranceThreshold: 0.001,
        logLevel: 'debug',
        includeZeroPositions: true
      };
      
      const customAnalyzer = new PositionAnalyzer(customOptions);
      expect(customAnalyzer.options.toleranceThreshold).toBe(0.001);
      expect(customAnalyzer.options.logLevel).toBe('debug');
      expect(customAnalyzer.options.includeZeroPositions).toBe(true);
    });
  });

  describe('getExchangeBalances', () => {
    test('正常な残高取得', async () => {
      const mockBalances = {
        total: { BTC: 1.5, ETH: 10.0 },
        free: { BTC: 1.0, ETH: 8.0 },
        used: { BTC: 0.5, ETH: 2.0 }
      };

      mockExchange.fetchBalance.mockResolvedValue(mockBalances);

      const result = await analyzer.getExchangeBalances(mockExchange);
      
      expect(result).toEqual(mockBalances);
      expect(mockExchange.fetchBalance).toHaveBeenCalledTimes(1);
    });

    test('取引所エラー時の処理', async () => {
      mockExchange.fetchBalance.mockRejectedValue(new Error('API Error'));

      const result = await analyzer.getExchangeBalances(mockExchange);
      
      expect(result).toBe(null);
    });
  });

  describe('aggregateNetPositionsBySymbol', () => {
    test('正常なポジション集計', async () => {
      const mockTradeSummaries = {
        'summary:trade:bitbank:BTC/JPY:strategy1': { netPosition: '1.5' },
        'summary:trade:bitbank:BTC/JPY:strategy2': { netPosition: '0.5' },
        'summary:trade:bitbank:ETH/JPY:strategy1': { netPosition: '10.0' },
        'summary:trade:other:BTC/JPY:strategy1': { netPosition: '2.0' } // 他の取引所は除外
      };

      mockGetAllTradeSummaries.mockResolvedValue(mockTradeSummaries);

      const result = await analyzer.aggregateNetPositionsBySymbol('bitbank');
      
      expect(result).toEqual({
        'BTC/JPY': {
          totalNetPosition: 2.0,
          strategies: {
            strategy1: 1.5,
            strategy2: 0.5
          }
        },
        'ETH/JPY': {
          totalNetPosition: 10.0,
          strategies: {
            strategy1: 10.0
          }
        }
      });
    });

    test('ゼロポジション除外設定', async () => {
      const mockTradeSummaries = {
        'summary:trade:bitbank:BTC/JPY:strategy1': { netPosition: '1.5' },
        'summary:trade:bitbank:ETH/JPY:strategy1': { netPosition: '0.000001' } // 閾値以下
      };

      mockGetAllTradeSummaries.mockResolvedValue(mockTradeSummaries);

      const result = await analyzer.aggregateNetPositionsBySymbol('bitbank');
      
      expect(result).toEqual({
        'BTC/JPY': {
          totalNetPosition: 1.5,
          strategies: {
            strategy1: 1.5
          }
        }
      });
    });
  });

  describe('categorizeInconsistency', () => {
    test('重大な不整合の分類', () => {
      const result = analyzer.categorizeInconsistency(0.2, 1.0);
      expect(result).toBe('critical');
    });

    test('中程度の不整合の分類', () => {
      const result = analyzer.categorizeInconsistency(0.02, 1.0);
      expect(result).toBe('moderate');
    });

    test('軽微な不整合の分類', () => {
      const result = analyzer.categorizeInconsistency(0.005, 1.0);
      expect(result).toBe('minor');
    });
  });

  describe('createFixProposal', () => {
    test('Redisポジション過多の修復提案', () => {
      const inconsistency = {
        symbol: 'BTC/JPY',
        netPosition: 1.5,
        exchangeBalance: 1.0,
        difference: 0.5,
        severity: 'critical'
      };

      const proposal = analyzer.createFixProposal('bitbank', inconsistency);
      
      expect(proposal.actions).toContainEqual(
        expect.objectContaining({
          type: 'backup_data',
          description: '修復前のデータバックアップ'
        })
      );
      
      expect(proposal.actions).toContainEqual(
        expect.objectContaining({
          type: 'reduce_redis_position',
          description: 'Redisのポジションを 1 に調整'
        })
      );
    });

    test('実残高過多の修復提案', () => {
      const inconsistency = {
        symbol: 'BTC/JPY',
        netPosition: 1.0,
        exchangeBalance: 1.5,
        difference: 0.5,
        severity: 'moderate'
      };

      const proposal = analyzer.createFixProposal('bitbank', inconsistency);
      
      expect(proposal.actions).toContainEqual(
        expect.objectContaining({
          type: 'investigate_missing_trades',
          description: '未記録取引の調査と補正 (差分: 0.5)'
        })
      );
    });
  });

  describe('generateRecommendations', () => {
    test('重大な不整合がある場合の推奨事項', () => {
      analyzer.inconsistencies = [
        { severity: 'critical' },
        { severity: 'moderate' }
      ];

      const recommendations = analyzer.generateRecommendations();
      
      expect(recommendations).toContainEqual(
        expect.objectContaining({
          priority: 'high',
          action: '重大な不整合の即座修復'
        })
      );
    });

    test('多数の不整合がある場合の推奨事項', () => {
      analyzer.inconsistencies = new Array(15).fill({ severity: 'minor' });

      const recommendations = analyzer.generateRecommendations();
      
      expect(recommendations).toContainEqual(
        expect.objectContaining({
          priority: 'medium',
          action: 'システム全体の見直し'
        })
      );
    });

    test('常時含まれる推奨事項', () => {
      analyzer.inconsistencies = [];

      const recommendations = analyzer.generateRecommendations();
      
      expect(recommendations).toContainEqual(
        expect.objectContaining({
          priority: 'low',
          action: '定期的な整合性チェック'
        })
      );
    });
  });

  describe('エラー処理', () => {
    test('Redis接続エラー時の処理', async () => {
      mockGetAllTradeSummaries.mockRejectedValue(new Error('Redis connection failed'));

      const result = await analyzer.aggregateNetPositionsBySymbol('bitbank');
      
      expect(result).toEqual({});
    });
  });
});