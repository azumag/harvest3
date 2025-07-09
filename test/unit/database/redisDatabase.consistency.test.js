/**
 * redisDatabase.js の整合性チェック機能のテスト
 * アトミック操作、負のポジション検出、戦略マッピング強化
 * t-wada流TDDアプローチ
 */

// モックの設定
const mockClient = {
  connect: jest.fn(),
  quit: jest.fn(),
  exists: jest.fn(),
  hSet: jest.fn(),
  hGetAll: jest.fn(),
  hMGet: jest.fn(),
  hIncrByFloat: jest.fn(),
  multi: jest.fn(),
  on: jest.fn()
};

const mockMulti = {
  hSet: jest.fn(),
  hIncrByFloat: jest.fn(),
  exec: jest.fn(),
  discard: jest.fn()
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockClient)
}));

jest.mock('../../../src/database/redisClient', () => ({
  client: mockClient,
  initRedisClient: jest.fn()
}));

// manager.jsのgetStrategyKeyをモック化
const mockGetStrategyKey = jest.fn();
jest.mock('../../../src/database/manager', () => ({
  getStrategyKey: mockGetStrategyKey
}));

// mongoDatabase.jsのgetOrderByOrderIdをモック化
const mockGetOrderByOrderId = jest.fn();
jest.mock('../../../src/database/mongoDatabase', () => ({
  getOrderByOrderId: mockGetOrderByOrderId
}));

// スキーマバリデーションのモック
const mockSafeValidateTradeSummaryData = jest.fn();
jest.mock('../../../src/database/schemas', () => ({
  safeValidateTradeSummaryData: mockSafeValidateTradeSummaryData
}));

// テスト対象をインポート
const {
  updateTradeSummary,
  validateAndFixTradeSummary,
  getValidatedStrategyKey
} = require('../../../src/database/redisDatabase');

describe.skip('redisDatabase - 整合性チェック機能', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // デフォルトのモック設定
    mockGetStrategyKey.mockImplementation(strategy => strategy);
    mockSafeValidateTradeSummaryData.mockImplementation(trade => trade);
    mockClient.multi.mockReturnValue(mockMulti);
    mockMulti.exec.mockResolvedValue([[null, 'OK'], [null, 'OK'], [null, 'OK']]);
  });

  describe('updateTradeSummary - アトミック操作', () => {
    describe('🔴 Red: Redis transactions による原子性が保証されること', () => {
      it('買い注文の更新が単一トランザクションで実行されること', async () => {
        const trade = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'TEST_STRATEGY',
          side: 'buy',
          amount: 1.0,
          value: 1000000,
          fee: 1000
        };

        mockClient.exists.mockResolvedValue(0); // サマリーが存在しない

        await updateTradeSummary(trade);

        // multi() が呼ばれることを確認
        expect(mockClient.multi).toHaveBeenCalled();

        // トランザクション内で適切な操作が実行されることを確認
        expect(mockMulti.hSet).toHaveBeenCalledWith(
          'summary:trade:bitbank:BTC/JPY:TEST_STRATEGY',
          expect.objectContaining({
            buyAmount: 0,
            sellAmount: 0,
            netPosition: 0
          })
        );

        expect(mockMulti.hIncrByFloat).toHaveBeenCalledWith(
          'summary:trade:bitbank:BTC/JPY:TEST_STRATEGY',
          'buyAmount',
          1.0
        );

        expect(mockMulti.hIncrByFloat).toHaveBeenCalledWith(
          'summary:trade:bitbank:BTC/JPY:TEST_STRATEGY',
          'netPosition',
          1.0
        );

        expect(mockMulti.exec).toHaveBeenCalled();
      });

      it('売り注文の更新で実現損益が正しく計算されること', async () => {
        const trade = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'TEST_STRATEGY',
          side: 'sell',
          amount: 0.5,
          value: 600000,
          fee: 500
        };

        mockClient.exists.mockResolvedValue(1); // サマリーが存在
        mockClient.hMGet.mockResolvedValue(['1.0', '1000000']); // buyAmount: 1.0, totalBuyCost: 1000000

        await updateTradeSummary(trade);

        // 売り注文の操作が実行されることを確認
        expect(mockMulti.hIncrByFloat).toHaveBeenCalledWith(
          'summary:trade:bitbank:BTC/JPY:TEST_STRATEGY',
          'sellAmount',
          0.5
        );

        expect(mockMulti.hIncrByFloat).toHaveBeenCalledWith(
          'summary:trade:bitbank:BTC/JPY:TEST_STRATEGY',
          'netPosition',
          -0.5
        );

        // 実現損益の計算: 売却価格600000 - (平均購入価格1000000 * 売却量0.5) = 100000
        expect(mockMulti.hIncrByFloat).toHaveBeenCalledWith(
          'summary:trade:bitbank:BTC/JPY:TEST_STRATEGY',
          'realizedPnL',
          100000
        );
      });

      it('トランザクション失敗時にdiscardが呼ばれること', async () => {
        const trade = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'TEST_STRATEGY',
          side: 'buy',
          amount: 1.0,
          value: 1000000,
          fee: 1000
        };

        mockClient.exists.mockResolvedValue(0);
        mockMulti.exec.mockResolvedValue([[new Error('Transaction failed'), null]]);

        await expect(updateTradeSummary(trade)).rejects.toThrow('Redis transaction failed');
        expect(mockMulti.discard).toHaveBeenCalled();
      });
    });
  });

  describe('validateAndFixTradeSummary', () => {
    describe('🔴 Red: ネットポジション不整合の検出と修正', () => {
      it('正常なサマリーの場合はバリデーション成功を返すこと', async () => {
        const summaryData = {
          buyAmount: '2.0',
          sellAmount: '1.0',
          netPosition: '1.0',
          totalBuyCost: '2000000',
          totalSellValue: '1000000',
          realizedPnL: '0'
        };

        mockClient.hGetAll.mockResolvedValue(summaryData);

        const result = await validateAndFixTradeSummary('test:summary:key');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it('ネットポジション不整合を検出すること', async () => {
        const summaryData = {
          buyAmount: '2.0',
          sellAmount: '1.0',
          netPosition: '0.5', // 期待値1.0との不整合
          totalBuyCost: '2000000',
          totalSellValue: '1000000',
          realizedPnL: '0'
        };

        mockClient.hGetAll.mockResolvedValue(summaryData);

        const result = await validateAndFixTradeSummary('test:summary:key');

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('ネットポジション不整合: 記録値=0.5, 計算値=1, 差=0.5');
      });

      it('負のネットポジションを検出すること', async () => {
        const summaryData = {
          buyAmount: '1.0',
          sellAmount: '2.0',
          netPosition: '-1.0',
          totalBuyCost: '1000000',
          totalSellValue: '2000000',
          realizedPnL: '0'
        };

        mockClient.hGetAll.mockResolvedValue(summaryData);

        const result = await validateAndFixTradeSummary('test:summary:key');

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('負のネットポジション検出: -1');
      });

      it('autoFix=trueの場合に自動修正が実行されること', async () => {
        const summaryData = {
          buyAmount: '2.0',
          sellAmount: '1.0',
          netPosition: '0.5', // 不整合
          totalBuyCost: '2000000',
          totalSellValue: '1000000',
          realizedPnL: '0'
        };

        mockClient.hGetAll.mockResolvedValue(summaryData);
        mockClient.multi.mockReturnValue(mockMulti);
        mockMulti.exec.mockResolvedValue([[null, 'OK']]);

        const result = await validateAndFixTradeSummary('test:summary:key', { autoFix: true });

        expect(result.actions).toContain('ネットポジション修正: 0.5 → 1');
        expect(mockMulti.hSet).toHaveBeenCalledWith('test:summary:key', 'netPosition', '1');
        expect(result.fixed).toBe(true);
      });

      it('極端に負のネットポジションの場合にサマリー全体がリセットされること', async () => {
        const summaryData = {
          buyAmount: '0',
          sellAmount: '0',
          netPosition: '-5.0', // 極端に負
          totalBuyCost: '0',
          totalSellValue: '0',
          realizedPnL: '0'
        };

        mockClient.hGetAll.mockResolvedValue(summaryData);
        mockClient.multi.mockReturnValue(mockMulti);
        mockMulti.exec.mockResolvedValue([[null, 'OK']]);

        const result = await validateAndFixTradeSummary('test:summary:key', { autoFix: true });

        expect(result.actions).toContain('サマリー全体をリセット');
        expect(mockMulti.hSet).toHaveBeenCalledWith('test:summary:key', expect.objectContaining({
          buyAmount: '0',
          sellAmount: '0',
          netPosition: '0',
          realizedPnL: '0'
        }));
      });
    });

    describe('🔴 Red: 極端な値の検出', () => {
      it('極端なネットポジションを警告として検出すること', async () => {
        const summaryData = {
          buyAmount: '1500000.0',
          sellAmount: '0',
          netPosition: '1500000.0', // 150万 > 100万の上限
          totalBuyCost: '1500000000000',
          totalSellValue: '0',
          realizedPnL: '0'
        };

        mockClient.hGetAll.mockResolvedValue(summaryData);

        const result = await validateAndFixTradeSummary('test:summary:key');

        expect(result.warnings).toContain('極端なネットポジション: 1500000');
      });

      it('極端な実現損益を警告として検出すること', async () => {
        const summaryData = {
          buyAmount: '1.0',
          sellAmount: '0',
          netPosition: '1.0',
          totalBuyCost: '1000000',
          totalSellValue: '0',
          realizedPnL: '150000000' // 1.5億円
        };

        mockClient.hGetAll.mockResolvedValue(summaryData);

        const result = await validateAndFixTradeSummary('test:summary:key');

        expect(result.warnings).toContain('極端な実現損益: 150000000円');
      });
    });
  });

  describe('getValidatedStrategyKey', () => {
    describe('🔴 Red: 戦略キーマッピングの強化', () => {
      it('Redis内の未約定注文から戦略キーを取得できること', async () => {
        const orderData = {
          strategyKey: 'BOLLINGER_BANDS'
        };

        mockClient.hGetAll.mockResolvedValue(orderData);

        const result = await getValidatedStrategyKey('order123');

        expect(result).toBe('BOLLINGER_BANDS');
        expect(mockClient.hGetAll).toHaveBeenCalledWith('pending_order:order123');
      });

      it('MongoDBの注文履歴から戦略キーを取得できること', async () => {
        mockClient.hGetAll.mockResolvedValue({}); // Redisに情報なし
        mockGetOrderByOrderId.mockResolvedValue({
          strategy: 'BB戦略'
        });
        mockGetStrategyKey.mockReturnValue('BOLLINGER_BANDS');

        const result = await getValidatedStrategyKey('order123');

        expect(result).toBe('BOLLINGER_BANDS');
        expect(mockGetOrderByOrderId).toHaveBeenCalledWith('order123');
        expect(mockGetStrategyKey).toHaveBeenCalledWith('BB戦略');
      });

      it('戦略情報が見つからない場合はフォールバックを返すこと', async () => {
        mockClient.hGetAll.mockResolvedValue({});
        mockGetOrderByOrderId.mockResolvedValue(null);

        const result = await getValidatedStrategyKey('order123', 'FALLBACK_STRATEGY');

        expect(result).toBe('FALLBACK_STRATEGY');
      });

      it('エラー発生時もフォールバックを返すこと', async () => {
        mockClient.hGetAll.mockRejectedValue(new Error('Redis error'));

        const result = await getValidatedStrategyKey('order123', 'ERROR_FALLBACK');

        expect(result).toBe('ERROR_FALLBACK');
      });
    });
  });

  describe('統合テスト', () => {
    describe('🔴 Red: 更新後の自動整合性チェック', () => {
      it('updateTradeSummary実行後に自動でvalidateAndFixTradeSummaryが呼ばれること', async () => {
        const trade = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'TEST_STRATEGY',
          side: 'buy',
          amount: 1.0,
          value: 1000000,
          fee: 1000
        };

        mockClient.exists.mockResolvedValue(0);

        // validateAndFixTradeSummaryのスパイを作成
        const validateSpy = jest.spyOn(require('../../../src/database/redisDatabase'), 'validateAndFixTradeSummary');
        validateSpy.mockResolvedValue({ isValid: true, errors: [], warnings: [], actions: [] });

        await updateTradeSummary(trade);

        expect(validateSpy).toHaveBeenCalledWith(
          'summary:trade:bitbank:BTC/JPY:TEST_STRATEGY',
          { autoFix: true, logLevel: 'warn' }
        );

        validateSpy.mockRestore();
      });
    });
  });

  describe('エラーハンドリング', () => {
    describe('🔴 Red: 適切なエラー処理が行われること', () => {
      it('バリデーション失敗のトレードは更新をスキップすること', async () => {
        mockSafeValidateTradeSummaryData.mockReturnValue(null); // バリデーション失敗

        const trade = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          strategy: 'TEST_STRATEGY',
          side: 'buy'
        };

        await updateTradeSummary(trade);

        expect(mockClient.multi).not.toHaveBeenCalled();
      });

      it('validateAndFixTradeSummaryで例外が発生してもエラーオブジェクトを返すこと', async () => {
        mockClient.hGetAll.mockRejectedValue(new Error('Redis connection failed'));

        const result = await validateAndFixTradeSummary('test:summary:key');

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('検証処理エラー: Redis connection failed');
      });
    });
  });
});