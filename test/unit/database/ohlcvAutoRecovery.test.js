// モック設定
const mockFetchOHLCVData = jest.fn();
const mockFetchHistoricalOHLCVData = jest.fn();
const mockUpdateBacktestOHLCVRedisSortedSet = jest.fn();

jest.mock('../../../src/database/mongoDatabase', () => ({
  fetchHistoricalOHLCVData: mockFetchHistoricalOHLCVData,
  connectDB: jest.fn()
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  updateBacktestOHLCVRedisSortedSet: mockUpdateBacktestOHLCVRedisSortedSet
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

// manager.jsから個別にfetchOHLCVDataをモック
jest.mock('../../../src/database/manager', () => {
  const originalModule = jest.requireActual('../../../src/database/manager');
  return {
    ...originalModule,
    fetchOHLCVData: mockFetchOHLCVData,
    loadHistoricalOHLCVToBacktestRedis: originalModule.loadHistoricalOHLCVToBacktestRedis
  };
});

const { loadHistoricalOHLCVToBacktestRedis } = require('../../../src/database/manager');

describe('OHLCV自動データ回復機能', () => {
  const mockExchange = { id: 'bitbank' };
  const mockSymbol = 'XRP/JPY';
  const mockTimeframe = '15m';
  const mockLimit = 100;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('通常ケース: データが存在する場合はそのまま返す', async () => {
    // モックデータ
    const mockOhlcvData = [
      { timestamp: 1640995200000, open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      { timestamp: 1641000000000, open: 102, high: 106, low: 100, close: 104, volume: 1200 }
    ];

    mockFetchHistoricalOHLCVData.mockResolvedValue(mockOhlcvData);
    mockUpdateBacktestOHLCVRedisSortedSet.mockResolvedValue();

    const result = await loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit);

    expect(result).toEqual(mockOhlcvData);
    expect(mockFetchHistoricalOHLCVData).toHaveBeenCalledTimes(1);
    expect(mockFetchOHLCVData).not.toHaveBeenCalled();
    expect(mockUpdateBacktestOHLCVRedisSortedSet).toHaveBeenCalledWith(
      mockExchange.id, 
      mockSymbol, 
      mockTimeframe, 
      mockOhlcvData
    );
  });

  test('自動回復ケース: データが存在しない場合、自動取得を試行し成功', async () => {
    const mockAutoFetchedData = [
      { timestamp: 1640995200000, open: 95, high: 100, low: 93, close: 98, volume: 800 },
      { timestamp: 1641000000000, open: 98, high: 102, low: 96, close: 100, volume: 900 }
    ];

    // 最初の呼び出しではデータなし、2回目で取得成功
    mockFetchHistoricalOHLCVData
      .mockResolvedValueOnce([]) // 最初はデータなし
      .mockResolvedValueOnce(mockAutoFetchedData); // 自動取得後にデータあり

    mockFetchOHLCVData.mockResolvedValue();
    mockUpdateBacktestOHLCVRedisSortedSet.mockResolvedValue();

    const result = await loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit);

    expect(result).toEqual(mockAutoFetchedData);
    expect(mockFetchHistoricalOHLCVData).toHaveBeenCalledTimes(2);
    expect(mockFetchOHLCVData).toHaveBeenCalledWith(
      mockExchange,
      mockSymbol,
      mockTimeframe,
      1000, // 自動取得時は最低1000件
      { forceUpdate: true }
    );
    expect(mockUpdateBacktestOHLCVRedisSortedSet).toHaveBeenCalledWith(
      mockExchange.id,
      mockSymbol,
      mockTimeframe,
      mockAutoFetchedData
    );
  });

  test('自動回復失敗ケース: データ取得APIエラー時は空配列を返す', async () => {
    mockFetchHistoricalOHLCVData
      .mockResolvedValueOnce([]) // 最初はデータなし
      .mockResolvedValueOnce([]); // 自動取得後もデータなし

    const apiError = new Error('API rate limit exceeded');
    mockFetchOHLCVData.mockRejectedValue(apiError);

    const result = await loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit);

    expect(result).toEqual([]);
    expect(mockFetchHistoricalOHLCVData).toHaveBeenCalledTimes(1);
    expect(mockFetchOHLCVData).toHaveBeenCalledTimes(1);
    expect(mockUpdateBacktestOHLCVRedisSortedSet).not.toHaveBeenCalled();
  });

  test('自動回復部分成功ケース: API成功但しデータが取得できない場合', async () => {
    mockFetchHistoricalOHLCVData
      .mockResolvedValueOnce([]) // 最初はデータなし
      .mockResolvedValueOnce([]); // 自動取得後もデータなし

    mockFetchOHLCVData.mockResolvedValue(); // API呼び出しは成功

    const result = await loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit);

    expect(result).toEqual([]);
    expect(mockFetchHistoricalOHLCVData).toHaveBeenCalledTimes(2);
    expect(mockFetchOHLCVData).toHaveBeenCalledTimes(1);
    expect(mockUpdateBacktestOHLCVRedisSortedSet).not.toHaveBeenCalled();
  });

  test('Redis保存エラー時の例外処理', async () => {
    const mockOhlcvData = [
      { timestamp: 1640995200000, open: 100, high: 105, low: 98, close: 102, volume: 1000 }
    ];

    mockFetchHistoricalOHLCVData.mockResolvedValue(mockOhlcvData);
    const redisError = new Error('Redis connection failed');
    mockUpdateBacktestOHLCVRedisSortedSet.mockRejectedValue(redisError);

    await expect(loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, mockLimit))
      .rejects.toThrow('Redis connection failed');

    expect(mockFetchHistoricalOHLCVData).toHaveBeenCalledTimes(1);
    expect(mockUpdateBacktestOHLCVRedisSortedSet).toHaveBeenCalledTimes(1);
  });

  test('limitパラメータのテスト: 小さなlimitでも自動取得時は1000件要求', async () => {
    const smallLimit = 50;
    const mockAutoFetchedData = [
      { timestamp: 1640995200000, open: 95, high: 100, low: 93, close: 98, volume: 800 }
    ];

    mockFetchHistoricalOHLCVData
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockAutoFetchedData);

    mockFetchOHLCVData.mockResolvedValue();
    mockUpdateBacktestOHLCVRedisSortedSet.mockResolvedValue();

    const result = await loadHistoricalOHLCVToBacktestRedis(mockExchange, mockSymbol, mockTimeframe, smallLimit);

    expect(result).toEqual(mockAutoFetchedData);
    expect(mockFetchOHLCVData).toHaveBeenCalledWith(
      mockExchange,
      mockSymbol,
      mockTimeframe,
      1000, // smallLimitより大きい値
      { forceUpdate: true }
    );
  });
});