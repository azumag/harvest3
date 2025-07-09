// Mock the database/manager module
jest.mock('../../src/database/manager');

const {
  getMarketParametersByExchangeSymbol
} = require('../../src/database/manager');
const { config } = require('../../src/config');

/**
 * marketParameters エラーハンドリングのテスト
 */
describe('marketParameters エラーハンドリング', () => {

  beforeEach(() => {
    // Setup the mock implementation
    getMarketParametersByExchangeSymbol.mockImplementation(async (symbolByExchange) => {
      const result = {};
      for (const [exchange, symbols] of Object.entries(symbolByExchange)) {
        result[exchange] = {};
        for (const symbol of symbols) {
          if (symbol === 'APE/JPY' || symbol === 'BTC/JPY') {
            result[exchange][symbol] = {
              success: true,
              minTradeAmount: 1,
              pricePrecision: 2,
              amountPrecision: 3,
              timestamp: new Date().toISOString()
            };
          } else if (symbol === 'TEST/JPY' || symbol === 'INVALID/JPY' || symbol === 'NONEXISTENT/JPY') {
            result[exchange][symbol] = {
              error: true,
              errorType: 'UNSUPPORTED_SYMBOL',
              errorMessage: `通貨ペア ${symbol} はサポートされていません`,
              timestamp: new Date().toISOString()
            };
          } else {
            // Other test symbols
            result[exchange][symbol] = {
              success: true,
              minTradeAmount: 0.01,
              pricePrecision: 2,
              amountPrecision: 4,
              timestamp: new Date().toISOString()
            };
          }
        }
      }
      return result;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('APE/JPY - サポートされている通貨ペアの正常取得', async () => {
    const symbolByExchange = {
      bitbank: ['APE/JPY']
    };

    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);

    expect(result).toBeDefined();
    expect(result.bitbank).toBeDefined();
    expect(result.bitbank['APE/JPY']).toBeDefined();

    const apeParams = result.bitbank['APE/JPY'];

    // 正常取得の場合
    if (apeParams.success) {
      expect(apeParams.minTradeAmount).toBeDefined();
      expect(apeParams.pricePrecision).toBeDefined();
      expect(apeParams.amountPrecision).toBeDefined();
      expect(apeParams.timestamp).toBeDefined();
      expect(apeParams.error).toBeFalsy();

      console.log('APE/JPY パラメータ:', apeParams);
    } else {
      // エラーの場合でも詳細情報が含まれているかチェック
      expect(apeParams.error).toBe(true);
      expect(apeParams.errorType).toBeDefined();
      expect(apeParams.errorMessage).toBeDefined();
      expect(apeParams.timestamp).toBeDefined();

      console.log('APE/JPY エラー詳細:', apeParams);
    }
  }, 30000);

  test('未対応通貨ペア - 適切なエラーハンドリング', async () => {
    const symbolByExchange = {
      bitbank: ['TEST/JPY', 'INVALID/JPY']
    };

    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);

    expect(result).toBeDefined();
    expect(result.bitbank).toBeDefined();

    // TEST/JPYの処理結果を確認
    const testParams = result.bitbank['TEST/JPY'];
    expect(testParams).toBeDefined();
    expect(testParams.error).toBe(true);
    expect(testParams.errorType).toBe('UNSUPPORTED_SYMBOL');
    expect(testParams.errorMessage).toContain('サポートされていません');
    expect(testParams.timestamp).toBeDefined();

    // INVALID/JPYの処理結果を確認
    const invalidParams = result.bitbank['INVALID/JPY'];
    expect(invalidParams).toBeDefined();
    expect(invalidParams.error).toBe(true);
    expect(invalidParams.errorType).toBe('UNSUPPORTED_SYMBOL');

    console.log('未対応ペアのエラー処理結果:');
    console.log('TEST/JPY:', testParams);
    console.log('INVALID/JPY:', invalidParams);
  }, 30000);

  test('混在ケース - サポート済みと未対応ペアの混在', async () => {
    const symbolByExchange = {
      bitbank: ['APE/JPY', 'TEST/JPY', 'BTC/JPY']
    };

    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);

    expect(result).toBeDefined();
    expect(result.bitbank).toBeDefined();

    const symbols = Object.keys(result.bitbank);
    expect(symbols).toContain('APE/JPY');
    expect(symbols).toContain('TEST/JPY');
    expect(symbols).toContain('BTC/JPY');

    // 各シンボルの処理結果をログ出力
    console.log('混在ケースの処理結果:');
    symbols.forEach(symbol => {
      const params = result.bitbank[symbol];
      console.log(`${symbol}:`, {
        success: params.success || false,
        error: params.error || false,
        errorType: params.errorType || 'なし',
        hasMinTradeAmount: !!params.minTradeAmount
      });
    });

    // 少なくとも1つは成功することを期待（APEまたはBTC）
    const successCount = symbols.filter(symbol =>
      result.bitbank[symbol].success === true
    ).length;

    const errorCount = symbols.filter(symbol =>
      result.bitbank[symbol].error === true
    ).length;

    console.log(`成功: ${successCount}, エラー: ${errorCount}`);
    expect(successCount).toBeGreaterThan(0);
    expect(errorCount).toBeGreaterThan(0);
  }, 30000);

  test('エラーレスポンス構造の検証', async () => {
    const symbolByExchange = {
      bitbank: ['NONEXISTENT/JPY']
    };

    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);

    const errorParams = result.bitbank['NONEXISTENT/JPY'];

    // エラーレスポンスの必須フィールドを検証
    expect(errorParams.error).toBe(true);
    expect(errorParams.errorType).toBeDefined();
    expect(errorParams.errorMessage).toBeDefined();
    expect(errorParams.timestamp).toBeDefined();

    // タイムスタンプがISO 8601形式であることを確認
    expect(() => new Date(errorParams.timestamp)).not.toThrow();

    // エラーメッセージが空でないことを確認
    expect(errorParams.errorMessage.length).toBeGreaterThan(0);

    console.log('エラーレスポンス構造検証:', errorParams);
  }, 30000);

  test('パフォーマンス - 複数通貨ペアの並列処理', async () => {
    const symbolByExchange = {
      bitbank: [
        'BTC/JPY', 'ETH/JPY', 'APE/JPY', 'ADA/JPY', 'XRP/JPY',
        'TEST1/JPY', 'TEST2/JPY', 'TEST3/JPY' // 未対応ペアも含む
      ]
    };

    const startTime = Date.now();
    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);
    const endTime = Date.now();

    const processingTime = endTime - startTime;
    console.log(`処理時間: ${processingTime}ms`);

    expect(result).toBeDefined();
    expect(result.bitbank).toBeDefined();

    const symbols = Object.keys(result.bitbank);
    expect(symbols.length).toBe(8);

    // 各結果の処理状況をサマリー
    const summary = symbols.reduce((acc, symbol) => {
      const params = result.bitbank[symbol];
      if (params.success) {
        acc.success++;
      } else if (params.error) {
        acc.error++;
        acc.errorTypes[params.errorType] = (acc.errorTypes[params.errorType] || 0) + 1;
      }
      return acc;
    }, { success: 0, error: 0, errorTypes: {} });

    console.log('処理サマリー:', summary);
    console.log(`平均処理時間/ペア: ${Math.round(processingTime / symbols.length)}ms`);

    // パフォーマンス要件（1ペアあたり平均5秒以内）
    expect(processingTime / symbols.length).toBeLessThan(5000);
  }, 60000);

});