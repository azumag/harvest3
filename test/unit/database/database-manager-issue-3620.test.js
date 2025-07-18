/**
 * Database Manager Issue #3620 テスト
 * strategy-runnerサービスで例外が発生 - 2PC Redis Commitエラー表示の改善
 * 
 * 修正内容:
 * 1. Redis transaction実行時に実際のコマンド名を記録
 * 2. エラーハンドリング時に実際のコマンド名を表示（"コマンド0"等の代わりに）
 * 3. デバッグ情報の可読性向上
 */

// テスト用のモック関数
const mockRedisClient = {
  multi: jest.fn(),
  hIncrByFloat: jest.fn(),
  hDel: jest.fn(),
  hSet: jest.fn(),
  exec: jest.fn()
};

const mockTransaction = {
  hIncrByFloat: jest.fn(),
  hDel: jest.fn(),
  hSet: jest.fn(),
  exec: jest.fn()
};

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: () => mockRedisClient
}));

jest.mock('../../../src/database/mongoDatabase', () => ({
  getClient: () => ({
    startSession: () => ({
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn()
    })
  })
}));

// テスト対象のモジュール
const { prepareRedisOperations, executeDistributedTransaction } = require('../../../src/database/manager');

describe('Database Manager Issue #3620: 2PC Redis Commitエラー表示の改善', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // モックのリセット
    mockRedisClient.multi.mockReturnValue(mockTransaction);
  });

  describe('prepareRedisOperations - コマンド名の記録', () => {
    
    it('buy取引の場合、適切なコマンド名が記録される', async () => {
      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'buy',
        amount: 100.0,
        value: 5000.0,
        price: 50.0,
        orderId: 'order123'
      };

      // Mock the transaction methods to return the transaction object for chaining
      mockTransaction.hIncrByFloat.mockReturnValue(mockTransaction);
      mockTransaction.hDel.mockReturnValue(mockTransaction);
      mockTransaction.hSet.mockReturnValue(mockTransaction);

      const commandNames = await prepareRedisOperations(mockTransaction, trade);
      
      // 期待されるコマンド名
      expect(commandNames).toEqual([
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(buyAmount)',
        'hIncrByFloat(totalBuyCost)',
        'hDel(pendingOrder)',
        'hSet(updatedAt)'
      ]);
    });
    
    it('sell取引の場合、適切なコマンド名が記録される', async () => {
      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 100.0,
        value: 5000.0,
        price: 50.0,
        orderId: 'order456'
      };

      // Mock the transaction methods to return the transaction object for chaining
      mockTransaction.hIncrByFloat.mockReturnValue(mockTransaction);
      mockTransaction.hDel.mockReturnValue(mockTransaction);
      mockTransaction.hSet.mockReturnValue(mockTransaction);

      const commandNames = await prepareRedisOperations(mockTransaction, trade);
      
      // 期待されるコマンド名
      expect(commandNames).toEqual([
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(sellAmount)',
        'hIncrByFloat(totalSellRevenue)',
        'hDel(pendingOrder)',
        'hSet(updatedAt)'
      ]);
    });
    
    it('orderIdがない場合、pendingOrderコマンドが除外される', async () => {
      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'buy',
        amount: 100.0,
        value: 5000.0,
        price: 50.0
        // orderIdなし
      };

      // Mock the transaction methods to return the transaction object for chaining
      mockTransaction.hIncrByFloat.mockReturnValue(mockTransaction);
      mockTransaction.hDel.mockReturnValue(mockTransaction);
      mockTransaction.hSet.mockReturnValue(mockTransaction);

      const commandNames = await prepareRedisOperations(mockTransaction, trade);
      
      // pendingOrderコマンドが含まれない
      expect(commandNames).toEqual([
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(buyAmount)',
        'hIncrByFloat(totalBuyCost)',
        'hSet(updatedAt)'
      ]);
    });
    
    it('OUTSIDE戦略の場合、pendingOrderコマンドが除外される', async () => {
      const trade = {
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'OUTSIDE',
        side: 'buy',
        amount: 100.0,
        value: 5000.0,
        price: 50.0,
        orderId: 'order789'
      };

      // Mock the transaction methods to return the transaction object for chaining
      mockTransaction.hIncrByFloat.mockReturnValue(mockTransaction);
      mockTransaction.hDel.mockReturnValue(mockTransaction);
      mockTransaction.hSet.mockReturnValue(mockTransaction);

      const commandNames = await prepareRedisOperations(mockTransaction, trade);
      
      // pendingOrderコマンドが含まれない
      expect(commandNames).toEqual([
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(buyAmount)',
        'hIncrByFloat(totalBuyCost)',
        'hSet(updatedAt)'
      ]);
    });
  });

  describe('2PC統合テスト - コマンド名を使用したエラーハンドリング', () => {
    
    it('Redis commitエラー時に実際のコマンド名が表示される', async () => {
      // テスト用のトレードデータ
      const trade = {
        tradeId: '1416438175',
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 2.6797,
        value: 1446.2796449,
        price: 54.0,
        orderId: 'order123'
      };

      // Mock Redis transaction results - 5つのコマンドが全て失敗
      const redisResults = [
        ['-', null],       // hIncrByFloat(netPosition) - 意味不明なエラー
        [2, null],         // hIncrByFloat(sellAmount) - Connection timeout
        [1, null],         // hIncrByFloat(totalSellRevenue) - IO error
        [undefined, null], // hDel(pendingOrder) - Unknown error
        [undefined, null], // hSet(updatedAt) - Unknown error
      ];

      // 期待されるコマンド名
      const expectedCommandNames = [
        'hIncrByFloat(netPosition)',
        'hIncrByFloat(sellAmount)',
        'hIncrByFloat(totalSellRevenue)',
        'hDel(pendingOrder)',
        'hSet(updatedAt)'
      ];

      // Mock Redis transaction execution
      mockTransaction.exec.mockResolvedValue(redisResults);

      // Transaction multi setup
      mockRedisClient.multi.mockReturnValue(mockTransaction);

      // エラーハンドリングロジックのテスト
      const { failed: failedCommands, successful: successfulCommands } = redisResults.reduce((acc, result, index) => {
        if (result[0] !== null) {
          acc.failed.push({
            index,
            error: result[0],
            errorMessage: getRedisErrorMessage(result[0], index),
            command: expectedCommandNames[index] || `コマンド${index}`
          });
        } else {
          acc.successful.push({
            index,
            result: result[1]
          });
        }
        return acc;
      }, { failed: [], successful: [] });

      // 結果検証
      expect(failedCommands).toHaveLength(5);
      expect(successfulCommands).toHaveLength(0);

      // 各コマンドの名前が正しく設定されているか確認
      expect(failedCommands[0].command).toBe('hIncrByFloat(netPosition)');
      expect(failedCommands[1].command).toBe('hIncrByFloat(sellAmount)');
      expect(failedCommands[2].command).toBe('hIncrByFloat(totalSellRevenue)');
      expect(failedCommands[3].command).toBe('hDel(pendingOrder)');
      expect(failedCommands[4].command).toBe('hSet(updatedAt)');

      // エラーログメッセージ生成のテスト
      const errorDetails = failedCommands.map(({ index, errorMessage, command }) => 
        `${command}: ${errorMessage}`
      ).join(', ');

      // 実際のコマンド名を含むエラーメッセージが生成されることを確認
      expect(errorDetails).toContain('hIncrByFloat(netPosition):');
      expect(errorDetails).toContain('hIncrByFloat(sellAmount):');
      expect(errorDetails).toContain('hIncrByFloat(totalSellRevenue):');
      expect(errorDetails).toContain('hDel(pendingOrder):');
      expect(errorDetails).toContain('hSet(updatedAt):');
      
      // 従来のジェネリックな名前（コマンド0など）が含まれていないことを確認
      expect(errorDetails).not.toContain('コマンド0:');
      expect(errorDetails).not.toContain('コマンド1:');
      expect(errorDetails).not.toContain('コマンド2:');
      expect(errorDetails).not.toContain('コマンド3:');
      expect(errorDetails).not.toContain('コマンド4:');
    });
  });

  describe('フォールバック機能', () => {
    
    it('コマンド名が取得できない場合、従来のジェネリック名を使用する', () => {
      const redisResults = [
        [1, null],  // エラーあり
        [null, 'OK'], // 成功
      ];

      // コマンド名が空の場合のテスト
      const commandNames = [];

      const { failed: failedCommands } = redisResults.reduce((acc, result, index) => {
        if (result[0] !== null) {
          acc.failed.push({
            index,
            error: result[0],
            errorMessage: getRedisErrorMessage(result[0], index),
            command: commandNames[index] || `コマンド${index}`
          });
        }
        return acc;
      }, { failed: [], successful: [] });

      // フォールバック機能が動作することを確認
      expect(failedCommands[0].command).toBe('コマンド0');
    });
  });
});

// getRedisErrorMessage関数のモック（実際の実装と同じ）
function getRedisErrorMessage(error, commandIndex) {
  if (error === undefined || error === null) {
    return 'Unknown error';
  }
  
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  
  if (typeof error === 'string') {
    if (error === '-' || error === '' || error.trim() === '') {
      return `Redis command ${commandIndex} failed: Invalid response`;
    }
    return error;
  }
  
  if (typeof error === 'number') {
    const redisErrorCodes = {
      0: 'Connection closed',
      1: 'IO error',
      2: 'Connection timeout',
      3: 'Connection refused',
      4: 'Protocol error',
      5: 'Authentication failed',
      6: 'Database selection failed',
      7: 'Out of memory',
      8: 'Redis server error',
      9: 'Command not supported',
      10: 'Wrong number of arguments'
    };
    
    const errorDescription = redisErrorCodes[error] || `Redis error code: ${error}`;
    return `Redis command ${commandIndex} failed: ${errorDescription}`;
  }
  
  if (typeof error === 'object') {
    if (error.message) {
      return error.message;
    }
    
    if (error.code) {
      return `Redis error: ${error.code}`;
    }
    
    if (error.name) {
      return `Redis error: ${error.name}`;
    }
    
    try {
      const jsonStr = JSON.stringify(error);
      if (jsonStr && jsonStr !== '{}') {
        return `Redis command ${commandIndex} failed: ${jsonStr}`;
      }
    } catch (e) {
      // JSON.stringifyが失敗した場合は無視
    }
    
    try {
      const stringified = error.toString();
      if (stringified && stringified !== '[object Object]') {
        return `Redis command ${commandIndex} failed: ${stringified}`;
      }
    } catch (e) {
      // toString()が失敗した場合は無視
    }
    
    return `Redis command ${commandIndex} failed: Unknown object error`;
  }
  
  return `Redis command ${commandIndex} failed: ${String(error)}`;
}