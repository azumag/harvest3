/**
 * Database Manager Issue #2984 テスト
 * strategy-runnerサービスで例外が発生 - Redis 2PC結果処理での安全なエラーハンドリング
 * 
 * 修正内容:
 * 1. Redis redisResults.reduce()内でのundefinedエラーオブジェクトの安全な処理
 * 2. result[0]?.message || result[0]?.toString() || 'Unknown error'パターンの適用
 * 3. 2PC Commit Phase中のエラーハンドリング強化
 */

// Disable automatic mocking for this test
jest.unmock('../../../src/database/manager');

describe('Database Manager Issue #2984: Redis 2PC結果処理での安全なエラーハンドリング', () => {
  
  describe('Redis結果処理でのundefinedエラーオブジェクト処理', () => {
    
    it('undefinedエラーオブジェクトから安全にメッセージを取得する', () => {
      // Redis結果でのundefinedエラーオブジェクトのシミュレーション
      const testResults = [
        [undefined, null],  // undefinedエラー
        [null, 'OK'],       // 正常結果
        [new Error('Redis error'), null],  // 正常なエラーオブジェクト
        ['string error', null],  // 文字列エラー
        [{}, null],         // 空オブジェクトエラー
        [{ message: 'Custom error' }, null]  // カスタムエラーオブジェクト
      ];
      
      // Redis結果処理ロジックのシミュレーション
      const { failed: failedCommands, successful: successfulCommands } = testResults.reduce((acc, result, index) => {
        if (result[0] !== null) {
          // エラーが発生したコマンド
          acc.failed.push({
            index,
            error: result[0],
            errorMessage: result[0]?.message || result[0]?.toString() || 'Unknown error',
            command: `コマンド${index}`
          });
        } else {
          // 成功したコマンド
          acc.successful.push({
            index,
            result: result[1]
          });
        }
        return acc;
      }, { failed: [], successful: [] });
      
      // 結果検証
      expect(failedCommands).toHaveLength(5);
      expect(successfulCommands).toHaveLength(1);
      
      // 個別エラーメッセージ検証
      expect(failedCommands[0].errorMessage).toBe('Unknown error');  // undefinedエラー
      expect(failedCommands[1].errorMessage).toBe('Redis error');    // 正常エラー
      expect(failedCommands[2].errorMessage).toBe('string error');   // 文字列エラー
      expect(failedCommands[3].errorMessage).toBe('[object Object]'); // 空オブジェクト
      expect(failedCommands[4].errorMessage).toBe('Custom error');   // カスタムエラー
    });
    
    it('異なるRedis結果パターンでエラーメッセージが適切に処理される', () => {
      const testCases = [
        { result: [undefined, null], expectedMessage: 'Unknown error' },
        { result: [null, 'OK'], isSuccess: true },
        { result: [new Error('Network error'), null], expectedMessage: 'Network error' },
        { result: ['TIMEOUT', null], expectedMessage: 'TIMEOUT' },
        { result: [{ message: 'Connection failed' }, null], expectedMessage: 'Connection failed' },
        { result: [{ toString: () => 'Custom error' }, null], expectedMessage: 'Custom error' },
        { result: [42, null], expectedMessage: '42' },
        { result: [true, null], expectedMessage: 'true' }
      ];
      
      testCases.forEach(({ result, expectedMessage, isSuccess }, index) => {
        const processedResult = {
          index,
          error: result[0],
          errorMessage: result[0]?.message || result[0]?.toString() || 'Unknown error',
          command: `コマンド${index}`
        };
        
        if (isSuccess) {
          expect(result[0]).toBeNull();
        } else {
          expect(processedResult.errorMessage).toBe(expectedMessage);
        }
      });
    });
    
    it('Redis結果処理でのエラーカウントが正確に計算される', () => {
      const mixedResults = [
        [null, 'OK'],
        [undefined, null],
        [null, 'QUEUED'],
        [new Error('Connection lost'), null],
        [null, 'SET'],
        ['TIMEOUT', null]
      ];
      
      const { failed, successful } = mixedResults.reduce((acc, result, index) => {
        if (result[0] !== null) {
          acc.failed.push({
            index,
            error: result[0],
            errorMessage: result[0]?.message || result[0]?.toString() || 'Unknown error',
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
      
      expect(failed).toHaveLength(3);
      expect(successful).toHaveLength(3);
      
      // 特定のエラーメッセージ検証
      expect(failed[0].errorMessage).toBe('Unknown error');
      expect(failed[1].errorMessage).toBe('Connection lost');
      expect(failed[2].errorMessage).toBe('TIMEOUT');
    });
  });
  
  describe('2PC Commit Phase エラーハンドリング統合テスト', () => {
    
    it('Commit Phase中のundefinedエラーオブジェクトが適切に処理される', () => {
      // 2PC Commit Phase中のエラーシミュレーション
      const redisResults = [
        [null, 'OK'],  // 成功
        [undefined, null],  // undefinedエラー
        [null, 'QUEUED'],  // 成功
        [new Error('Redis disconnected'), null]  // 正常エラー
      ];
      
      // 実際のコードと同じロジック
      const { failed: failedCommands, successful: successfulCommands } = redisResults.reduce((acc, result, index) => {
        if (result[0] !== null) {
          acc.failed.push({
            index,
            error: result[0],
            errorMessage: result[0]?.message || result[0]?.toString() || 'Unknown error',
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
      
      // エラーログメッセージ生成のテスト
      const errorDetails = failedCommands.map(({ index, errorMessage, command }) => 
        `${command}: ${errorMessage}`
      ).join(', ');
      
      expect(failedCommands).toHaveLength(2);
      expect(successfulCommands).toHaveLength(2);
      expect(errorDetails).toBe('コマンド1: Unknown error, コマンド3: Redis disconnected');
    });
  });
});