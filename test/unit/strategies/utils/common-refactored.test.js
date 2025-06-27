/**
 * リファクタリングで追加された共通関数のテスト
 * src/strategies/utils/common.js の新機能をテスト
 */

const {
  handleStrategyError,
  getCurrentPrice,
  saveStrategySignal,
  createLogInfoBase,
  fetchAndValidateOHLCVWithBacktestSetup,
  executeStrategyTemplate
} = require('../../../../src/strategies/utils/common');

// 依存関係のモック
jest.mock('../../../../src/database/manager', () => ({
  fetchTicker: jest.fn(),
  addSignal: jest.fn()
}));

jest.mock('../../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn()
}));

jest.mock('../../../../src/database/manager', () => ({
  fetchTicker: jest.fn(),
  addSignal: jest.fn(),
  fetchOHLCVData: jest.fn()
}));

const { fetchTicker, addSignal, fetchOHLCVData } = require('../../../../src/database/manager');
const { postErrorToDiscord } = require('../../../../src/common/notifications');

describe('リファクタリング共通関数テスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleStrategyError', () => {
    test('エラーオブジェクトの標準化された処理', async () => {
      const error = new Error('テスト戦略エラー');
      const symbol = 'BTC/JPY';
      const strategyName = 'テスト戦略';
      const strategyId = 'TEST_STRATEGY';
      const exchange = { id: 'bitbank' };

      const result = await handleStrategyError(error, symbol, strategyName, strategyId, exchange);

      expect(result).toEqual({
        strategy: 'TEST_STRATEGY',
        symbol: 'BTC/JPY',
        error: 'テスト戦略エラー'
      });

      expect(postErrorToDiscord).toHaveBeenCalledWith(
        '[テスト戦略] エラー: bitbank - BTC/JPY - テスト戦略エラー'
      );
    });

    test('Discord通知が無効の場合でも正常動作', async () => {
      // postErrorToDiscordを一時的に無効にする
      require('../../../../src/common/notifications').postErrorToDiscord = null;

      const error = new Error('通知なしエラー');
      const result = await handleStrategyError(error, 'BTC/JPY', 'テスト', 'TEST', { id: 'test' });

      expect(result.error).toBe('通知なしエラー');
      // エラーが発生しないことを確認
    });
  });

  describe('getCurrentPrice', () => {
    test('ティッカーから現在価格を取得', async () => {
      const mockTicker = {
        symbol: 'BTC/JPY',
        last: 5000000,
        bid: 4999000,
        ask: 5001000
      };
      
      fetchTicker.mockResolvedValue(mockTicker);

      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      const options = { backtest: false };

      const price = await getCurrentPrice(exchange, symbol, options);

      expect(price).toBe(5000000);
      expect(fetchTicker).toHaveBeenCalledWith(exchange, symbol, options);
    });

    test('バックテストモードでの価格取得', async () => {
      const mockTicker = {
        symbol: 'BTC/JPY',
        last: 4800000
      };
      
      fetchTicker.mockResolvedValue(mockTicker);

      const exchange = { id: 'test' };
      const options = { backtest: true };

      const price = await getCurrentPrice(exchange, 'BTC/JPY', options);

      expect(price).toBe(4800000);
    });
  });

  describe('saveStrategySignal', () => {
    test('買いシグナルの保存', async () => {
      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      const strategyKey = 'MA_STRATEGY';
      const currentPrice = 5000000;
      const strategyResults = { ma: 4950000 };
      const options = { backtest: false };

      await saveStrategySignal(exchange, symbol, strategyKey, 'buy', currentPrice, strategyResults, options);

      expect(addSignal).toHaveBeenCalledWith(
        exchange, symbol, strategyKey, 'buy', currentPrice, strategyResults, options
      );
    });

    test('売りシグナルの保存', async () => {
      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      const strategyKey = 'RSI_STRATEGY';
      const currentPrice = 4900000;
      const strategyResults = { rsi: 75 };

      await saveStrategySignal(exchange, symbol, strategyKey, 'sell', currentPrice, strategyResults);

      expect(addSignal).toHaveBeenCalledWith(
        exchange, symbol, strategyKey, 'sell', currentPrice, strategyResults, {}
      );
    });

    test('noneシグナルは保存されない', async () => {
      await saveStrategySignal({}, 'BTC/JPY', 'TEST', 'none', 5000000, {});

      expect(addSignal).not.toHaveBeenCalled();
    });
  });

  describe('createLogInfoBase', () => {
    test('基本的なログ情報フォーマット', () => {
      const currentPrice = 5000000;
      const strategySpecificInfo = {
        buy: 'MA上抜けによる買いシグナル',
        sell: 'MA下抜けによる売りシグナル', 
        none: 'シグナル条件未満',
        orderInfo: { amount: 0.01, type: 'limit' },
        result: { ma: 4950000, signal: 'buy' }
      };

      const logInfo = createLogInfoBase(currentPrice, strategySpecificInfo);

      expect(logInfo).toEqual({
        buy: 'MA上抜けによる買いシグナル',
        sell: 'MA下抜けによる売りシグナル',
        none: 'シグナル条件未満',
        orderInfo: { amount: 0.01, type: 'limit' },
        result: { ma: 4950000, signal: 'buy', currentPrice: 5000000 }
      });
    });

    test('情報不足時のデフォルト値適用', () => {
      const currentPrice = 4800000;
      const strategySpecificInfo = {
        buy: 'テスト買い信号'
        // sell, none, orderInfo, resultは省略
      };

      const logInfo = createLogInfoBase(currentPrice, strategySpecificInfo);

      expect(logInfo).toEqual({
        buy: 'テスト買い信号',
        sell: 'シグナル情報なし',
        none: 'シグナルなし',
        orderInfo: {},
        result: { currentPrice: 4800000 }
      });
    });
  });

  describe('fetchAndValidateOHLCVWithBacktestSetup', () => {
    test('正常なOHLCVデータ取得とバックテスト設定', async () => {
      // 50期間の十分なデータを作成（最低必要数45以上）
      const mockOHLCV = Array.from({ length: 50 }, (_, i) => [
        1640995200000 + i * 60000, // timestamp
        5000000 + i * 1000,        // open
        5100000 + i * 1000,        // high  
        4900000 + i * 1000,        // low
        5050000 + i * 1000,        // close
        100 + i                    // volume
      ]);

      fetchOHLCVData.mockResolvedValue(mockOHLCV);

      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      const options = { backtest: {} }; // backtest should be an object

      const result = await fetchAndValidateOHLCVWithBacktestSetup(
        exchange, symbol, '1m', 50, 'テスト戦略', options
      );

      expect(result).toEqual({
        closes: mockOHLCV.map(candle => candle[4]),
        ohlcv: mockOHLCV
      });
      expect(options.backtest.ohlcvData).toEqual(mockOHLCV);
      expect(fetchOHLCVData).toHaveBeenCalled();
    });

    test('データ取得失敗時はnullを返す', async () => {
      fetchOHLCVData.mockResolvedValue([]); // 空の配列でデータ不足をシミュレート

      const result = await fetchAndValidateOHLCVWithBacktestSetup(
        {}, 'BTC/JPY', '1h', 20, 'テスト戦略', { backtest: true }
      );

      expect(result).toBe(null);
    });

    test('非バックテストモードではohlcvData設定されない', async () => {
      // 十分なデータを提供して、テストが実際の機能をテストできるようにする
      const mockOHLCV = Array.from({ length: 15 }, (_, i) => [
        1640995200000 + i * 60000, // timestamp
        5000000, 5000000, 5000000, 5000000, 100 // ohlcv
      ]);

      fetchOHLCVData.mockResolvedValue(mockOHLCV);

      const options = { backtest: false };
      const result = await fetchAndValidateOHLCVWithBacktestSetup({}, 'BTC/JPY', '1m', 10, 'テスト', options);

      // 非バックテストモードでは backtest プロパティは変更されない
      expect(options.backtest).toBeFalsy();
      // 結果は正常に返される（バックテストモードでないのでohlcvDataは設定されない）
      expect(result).toEqual({
        closes: mockOHLCV.map(candle => candle[4]),
        ohlcv: mockOHLCV
      });
    });
  });

  describe('executeStrategyTemplate', () => {
    test('正常な戦略実行', async () => {
      const mockStrategyResult = {
        strategy: 'TEST_STRATEGY',
        symbol: 'BTC/JPY',
        signal: 'buy',
        price: 5000000
      };

      const strategyLogic = jest.fn().mockResolvedValue(mockStrategyResult);
      const context = {
        exchange: { id: 'bitbank' },
        symbol: 'BTC/JPY',
        strategyName: 'テスト戦略',
        strategyId: 'TEST_STRATEGY'
      };

      const result = await executeStrategyTemplate(strategyLogic, context);

      expect(result).toEqual(mockStrategyResult);
      expect(strategyLogic).toHaveBeenCalled();
    });

    test('戦略実行エラーの統一処理', async () => {
      const strategyError = new Error('戦略計算エラー');
      const strategyLogic = jest.fn().mockRejectedValue(strategyError);
      const context = {
        exchange: { id: 'bitbank' },
        symbol: 'BTC/JPY',
        strategyName: 'テスト戦略',
        strategyId: 'TEST_STRATEGY'
      };

      const result = await executeStrategyTemplate(strategyLogic, context);

      expect(result).toEqual({
        strategy: 'TEST_STRATEGY',
        symbol: 'BTC/JPY',
        error: '戦略計算エラー'
      });
      expect(postErrorToDiscord).toHaveBeenCalledWith(
        '[テスト戦略] エラー: bitbank - BTC/JPY - 戦略計算エラー'
      );
    });

    test('非同期エラーの適切な処理', async () => {
      const strategyLogic = async () => {
        throw new Error('非同期処理エラー');
      };

      const context = {
        exchange: { id: 'test' },
        symbol: 'TEST/USD',
        strategyName: 'テスト',
        strategyId: 'TEST'
      };

      const result = await executeStrategyTemplate(strategyLogic, context);

      expect(result.error).toBe('非同期処理エラー');
      expect(result.strategy).toBe('TEST');
      expect(result.symbol).toBe('TEST/USD');
    });
  });
});