// OHLCVデータ自動回復機能の統合テスト
const { loadHistoricalOHLCVToBacktestRedis } = require('../../../src/database/manager');

// モック設定
jest.mock('../../../src/database/mongoDatabase', () => ({
  fetchHistoricalOHLCVData: jest.fn(),
  connectDB: jest.fn()
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  updateBacktestOHLCVRedisSortedSet: jest.fn()
}));

jest.mock('../../../src/database/exchangeAPI', () => ({
  fetchOHLCVDataAPI: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

// 必要な依存関係のモック
jest.mock('../../../src/database/ohlcvQueue', () => ({
  getOHLCVQueue: jest.fn().mockReturnValue({
    add: jest.fn(),
    process: jest.fn()
  })
}));

jest.mock('../../../src/database/ohlcvCache', () => ({
  getOHLCVCacheManager: jest.fn().mockReturnValue({
    get: jest.fn(),
    set: jest.fn()
  })
}));

jest.mock('../../../src/common/utils', () => ({
  sleep: jest.fn(),
  timeframeToMs: jest.fn().mockReturnValue(60000),
  isBacktestMode: jest.fn().mockReturnValue(false)
}));

const { fetchHistoricalOHLCVData } = require('../../../src/database/mongoDatabase');
const { updateBacktestOHLCVRedisSortedSet } = require('../../../src/database/redisDatabase');
const { fetchOHLCVDataAPI } = require('../../../src/database/exchangeAPI');

describe('OHLCV自動データ回復機能統合テスト', () => {
  const mockExchange = { id: 'bitbank' };
  const mockSymbol = 'XRP/JPY';
  const mockTimeframe = '15m';
  const mockLimit = 100;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('通常ケース: データが存在する場合はそのまま返す', async () => {
    const mockOhlcvData = [
      { timestamp: 1640995200000, open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      { timestamp: 1641000000000, open: 102, high: 106, low: 100, close: 104, volume: 1200 }
    ];

    fetchHistoricalOHLCVData.mockResolvedValue(mockOhlcvData);
    updateBacktestOHLCVRedisSortedSet.mockResolvedValue();

    const result = await loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit);

    expect(result).toEqual(mockOhlcvData);
    expect(fetchHistoricalOHLCVData).toHaveBeenCalledWith(mockExchange.id, mockSymbol, mockTimeframe, mockLimit);
    expect(updateBacktestOHLCVRedisSortedSet).toHaveBeenCalledWith(
      mockExchange.id, 
      mockSymbol, 
      mockTimeframe, 
      mockOhlcvData
    );
  });

  test('データ欠損時のログメッセージ確認', async () => {
    fetchHistoricalOHLCVData.mockResolvedValue([]);
    fetchOHLCVDataAPI.mockResolvedValue([]);

    const result = await loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit);

    expect(result).toEqual([]);
    expect(fetchHistoricalOHLCVData).toHaveBeenCalled();
    // データが見つからない場合、自動取得を試行する
    expect(fetchOHLCVDataAPI).toHaveBeenCalled();
  });

  test('エラー処理: Redis保存エラー時の例外', async () => {
    const mockOhlcvData = [
      { timestamp: 1640995200000, open: 100, high: 105, low: 98, close: 102, volume: 1000 }
    ];

    fetchHistoricalOHLCVData.mockResolvedValue(mockOhlcvData);
    const redisError = new Error('Redis connection failed');
    updateBacktestOHLCVRedisSortedSet.mockRejectedValue(redisError);

    await expect(loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit))
      .rejects.toThrow('Redis connection failed');

    expect(fetchHistoricalOHLCVData).toHaveBeenCalledTimes(1);
    expect(updateBacktestOHLCVRedisSortedSet).toHaveBeenCalledTimes(1);
  });
});