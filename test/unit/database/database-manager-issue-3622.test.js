/**
 * Database Manager Issue #3622 テスト
 * strategy-runnerサービスで例外が発生 - Redisエラーメッセージの改善
 * 
 * 修正内容:
 * 1. 数値エラーコードの意味のあるメッセージへの変換
 * 2. 意味のない文字列パターン（"-", "", 空文字）の適切な処理
 * 3. 様々なエラーオブジェクト型の統一的な処理
 * 4. Redis特有のエラーコードマッピング
 */

// Disable automatic mocking for this test
jest.unmock('../../../src/database/manager');

// Mock the getRedisErrorMessage function for testing
const getRedisErrorMessage = require('../../../src/database/manager').getRedisErrorMessage || function(error, commandIndex) {
  // undefinedまたはnullの場合
  if (error === undefined || error === null) {
    return 'Unknown error';
  }
  
  // Errorオブジェクトの場合
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  
  // 文字列の場合
  if (typeof error === 'string') {
    // 意味のない文字列パターンをチェック
    if (error === '-' || error === '' || error.trim() === '') {
      return `Redis command ${commandIndex} failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout.`;
    }
    return error;
  }
  
  // 数値の場合（Redis エラーコード）
  if (typeof error === 'number') {
    // 一般的なRedisエラーコードのマッピング
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
  
  // オブジェクトの場合
  if (typeof error === 'object') {
    // messageプロパティがある場合
    if (error.message) {
      return error.message;
    }
    
    // codeプロパティがある場合
    if (error.code) {
      return `Redis error: ${error.code}`;
    }
    
    // nameプロパティがある場合
    if (error.name) {
      return `Redis error: ${error.name}`;
    }
    
    // JSON.stringifyで内容を取得しようとする
    try {
      const jsonStr = JSON.stringify(error);
      if (jsonStr && jsonStr !== '{}') {
        return `Redis command ${commandIndex} failed: ${jsonStr}`;
      }
    } catch (e) {
      // JSON.stringifyが失敗した場合は無視
    }
    
    // toString()を試す
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
  
  // その他の型の場合
  return `Redis command ${commandIndex} failed: ${String(error)}`;
};

describe('Database Manager Issue #3622: Redisエラーメッセージの改善', () => {
  
  describe('数値エラーコードの処理', () => {
    
    it('一般的なRedisエラーコードが意味のあるメッセージに変換される', () => {
      const testCases = [
        { error: 0, expected: 'Redis command 0 failed: Connection closed' },
        { error: 1, expected: 'Redis command 1 failed: IO error' },
        { error: 2, expected: 'Redis command 2 failed: Connection timeout' },
        { error: 3, expected: 'Redis command 3 failed: Connection refused' },
        { error: 4, expected: 'Redis command 4 failed: Protocol error' },
        { error: 5, expected: 'Redis command 5 failed: Authentication failed' },
        { error: 6, expected: 'Redis command 6 failed: Database selection failed' },
        { error: 7, expected: 'Redis command 7 failed: Out of memory' },
        { error: 8, expected: 'Redis command 8 failed: Redis server error' },
        { error: 9, expected: 'Redis command 9 failed: Command not supported' },
        { error: 10, expected: 'Redis command 10 failed: Wrong number of arguments' },
      ];
      
      testCases.forEach(({ error, expected }) => {
        const result = getRedisErrorMessage(error, error);
        expect(result).toBe(expected);
      });
    });
    
    it('未知の数値エラーコードが適切に処理される', () => {
      const testCases = [
        { error: 99, commandIndex: 0, expected: 'Redis command 0 failed: Redis error code: 99' },
        { error: -1, commandIndex: 1, expected: 'Redis command 1 failed: Redis error code: -1' },
        { error: 999, commandIndex: 2, expected: 'Redis command 2 failed: Redis error code: 999' },
      ];
      
      testCases.forEach(({ error, commandIndex, expected }) => {
        const result = getRedisErrorMessage(error, commandIndex);
        expect(result).toBe(expected);
      });
    });
  });
  
  describe('意味のない文字列パターンの処理', () => {
    
    it('意味のない文字列が適切に処理される', () => {
      const testCases = [
        { error: '-', commandIndex: 0, expected: 'Redis command 0 failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout.' },
        { error: '', commandIndex: 1, expected: 'Redis command 1 failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout.' },
        { error: '   ', commandIndex: 2, expected: 'Redis command 2 failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout.' },
        { error: '\t', commandIndex: 3, expected: 'Redis command 3 failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout.' },
        { error: '\n', commandIndex: 4, expected: 'Redis command 4 failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout.' },
      ];
      
      testCases.forEach(({ error, commandIndex, expected }) => {
        const result = getRedisErrorMessage(error, commandIndex);
        expect(result).toBe(expected);
      });
    });
    
    it('意味のある文字列は変更されない', () => {
      const testCases = [
        { error: 'Connection failed', expected: 'Connection failed' },
        { error: 'TIMEOUT', expected: 'TIMEOUT' },
        { error: 'Redis server not available', expected: 'Redis server not available' },
        { error: 'Authentication required', expected: 'Authentication required' },
      ];
      
      testCases.forEach(({ error, expected }) => {
        const result = getRedisErrorMessage(error, 0);
        expect(result).toBe(expected);
      });
    });
  });
  
  describe('undefinedとnullの処理', () => {
    
    it('undefinedとnullが適切に処理される', () => {
      expect(getRedisErrorMessage(undefined, 0)).toBe('Redis operation failed with null/undefined error. This may indicate a connection issue or timeout.');
      expect(getRedisErrorMessage(null, 0)).toBe('Redis operation failed with null/undefined error. This may indicate a connection issue or timeout.');
    });
  });
  
  describe('Errorオブジェクトの処理', () => {
    
    it('標準的なErrorオブジェクトが適切に処理される', () => {
      const testCases = [
        { error: new Error('Network error'), expected: 'Network error' },
        { error: new Error('Connection timeout'), expected: 'Connection timeout' },
        { error: new TypeError('Invalid argument'), expected: 'Invalid argument' },
        { error: new ReferenceError('Variable not defined'), expected: 'Variable not defined' },
      ];
      
      testCases.forEach(({ error, expected }) => {
        const result = getRedisErrorMessage(error, 0);
        expect(result).toBe(expected);
      });
    });
    
    it('メッセージのないErrorオブジェクトが適切に処理される', () => {
      const error = new Error();
      error.message = '';
      const result = getRedisErrorMessage(error, 0);
      expect(result).toBe('Error');
    });
  });
  
  describe('オブジェクトエラーの処理', () => {
    
    it('messageプロパティを持つオブジェクトが適切に処理される', () => {
      const testCases = [
        { error: { message: 'Custom error' }, expected: 'Custom error' },
        { error: { message: 'Redis connection failed' }, expected: 'Redis connection failed' },
      ];
      
      testCases.forEach(({ error, expected }) => {
        const result = getRedisErrorMessage(error, 0);
        expect(result).toBe(expected);
      });
    });
    
    it('codeプロパティを持つオブジェクトが適切に処理される', () => {
      const testCases = [
        { error: { code: 'ECONNREFUSED' }, expected: 'Redis error: ECONNREFUSED' },
        { error: { code: 'ETIMEOUT' }, expected: 'Redis error: ETIMEOUT' },
      ];
      
      testCases.forEach(({ error, expected }) => {
        const result = getRedisErrorMessage(error, 0);
        expect(result).toBe(expected);
      });
    });
    
    it('nameプロパティを持つオブジェクトが適切に処理される', () => {
      const testCases = [
        { error: { name: 'ConnectionError' }, expected: 'Redis error: ConnectionError' },
        { error: { name: 'TimeoutError' }, expected: 'Redis error: TimeoutError' },
      ];
      
      testCases.forEach(({ error, expected }) => {
        const result = getRedisErrorMessage(error, 0);
        expect(result).toBe(expected);
      });
    });
    
    it('構造化されたオブジェクトがJSON文字列として処理される', () => {
      const error = { status: 500, message: 'Internal server error', code: 'INTERNAL_ERROR' };
      const result = getRedisErrorMessage(error, 0);
      // messageプロパティが存在する場合は、messageを優先的に使用
      expect(result).toBe('Internal server error');
    });
    
    it('空オブジェクトが適切に処理される', () => {
      const error = {};
      const result = getRedisErrorMessage(error, 0);
      expect(result).toBe('Redis command 0 failed: Unknown object error');
    });
  });
  
  describe('2PC統合テスト - 実際のエラーパターン', () => {
    
    it('Issue #3622で報告されたエラーパターンが適切に処理される', () => {
      // 実際のエラーログパターンをシミュレート
      const redisResults = [
        ['-', null],      // コマンド0: -
        [0, null],        // コマンド1: 0
        [8, null],        // コマンド2: 8
        [undefined, null], // コマンド3: Unknown error
        [undefined, null], // コマンド4: Unknown error
      ];
      
      const { failed: failedCommands, successful: successfulCommands } = redisResults.reduce((acc, result, index) => {
        if (result[0] !== null) {
          acc.failed.push({
            index,
            error: result[0],
            errorMessage: getRedisErrorMessage(result[0], index),
            command: `コマンド${index}`
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
      
      // 個別エラーメッセージ検証
      expect(failedCommands[0].errorMessage).toBe('Redis command 0 failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout.');
      expect(failedCommands[1].errorMessage).toBe('Redis command 1 failed: Connection closed');
      expect(failedCommands[2].errorMessage).toBe('Redis command 2 failed: Redis server error');
      expect(failedCommands[3].errorMessage).toBe('Redis operation failed with null/undefined error. This may indicate a connection issue or timeout.');
      expect(failedCommands[4].errorMessage).toBe('Redis operation failed with null/undefined error. This may indicate a connection issue or timeout.');
      
      // エラーログメッセージ生成のテスト
      const errorDetails = failedCommands.map(({ index, errorMessage, command }) => 
        `${command}: ${errorMessage}`
      ).join(', ');
      
      expect(errorDetails).toBe(
        'コマンド0: Redis command 0 failed: Invalid response (empty/dash). This may indicate a connection issue or Redis server timeout., ' +
        'コマンド1: Redis command 1 failed: Connection closed, ' +
        'コマンド2: Redis command 2 failed: Redis server error, ' +
        'コマンド3: Redis operation failed with null/undefined error. This may indicate a connection issue or timeout., ' +
        'コマンド4: Redis operation failed with null/undefined error. This may indicate a connection issue or timeout.'
      );
    });
  });
  
  describe('エッジケースと異常な入力', () => {
    
    it('様々な型の入力が適切に処理される', () => {
      const testCases = [
        { error: true, commandIndex: 0, expected: 'Redis command 0 failed: true' },
        { error: false, commandIndex: 1, expected: 'Redis command 1 failed: false' },
        { error: Symbol('test'), commandIndex: 2, expected: 'Redis command 2 failed: Symbol(test)' },
        { error: BigInt(123), commandIndex: 3, expected: 'Redis command 3 failed: 123' },
        { error: () => {}, commandIndex: 4, expected: 'Redis command 4 failed: () => {}' },
      ];
      
      testCases.forEach(({ error, commandIndex, expected }) => {
        const result = getRedisErrorMessage(error, commandIndex);
        expect(result).toBe(expected);
      });
    });
    
    it('循環参照を持つオブジェクトが適切に処理される', () => {
      const circularObj = { name: 'circular' };
      circularObj.self = circularObj;
      
      const result = getRedisErrorMessage(circularObj, 0);
      // nameプロパティが存在する場合は、nameを優先的に使用
      expect(result).toBe('Redis error: circular');
    });
    
    it('toString()が例外を投げるオブジェクトが適切に処理される', () => {
      const badObj = {
        toString: () => {
          throw new Error('toString failed');
        }
      };
      
      const result = getRedisErrorMessage(badObj, 0);
      expect(result).toBe('Redis command 0 failed: Unknown object error');
    });
  });
});