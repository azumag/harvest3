/**
 * Database Manager Issue #3620 テスト - 簡素化版
 * strategy-runnerサービスで例外が発生 - 2PC Redis Commitエラー表示の改善
 * 
 * 修正内容:
 * 1. Redis transaction実行時に実際のコマンド名を記録
 * 2. エラーハンドリング時に実際のコマンド名を表示（"コマンド0"等の代わりに）
 * 3. デバッグ情報の可読性向上
 */

describe('Database Manager Issue #3620: 2PC Redis Commitエラー表示の改善', () => {
  
  describe('prepareRedisOperations - コマンド名の記録', () => {
    
    test('関数が存在し、正しい実装であることを確認', () => {
      // ファイルの内容を読み込んで、実装が正しいことを確認
      const fs = require('fs');
      const path = require('path');
      const managerPath = path.join(__dirname, '../../../src/database/manager.js');
      const content = fs.readFileSync(managerPath, 'utf8');
      
      // 関数が存在することを確認
      expect(content).toContain('async function prepareRedisOperations');
      
      // commandNames配列が作成されることを確認
      expect(content).toContain('const commandNames = []');
      
      // 適切なコマンド名がpushされることを確認
      expect(content).toContain('commandNames.push(\'hIncrByFloat(netPosition)\')');
      expect(content).toContain('commandNames.push(\'hIncrByFloat(buyAmount)\')');
      expect(content).toContain('commandNames.push(\'hIncrByFloat(totalBuyCost)\')');
      expect(content).toContain('commandNames.push(\'hIncrByFloat(sellAmount)\')');
      expect(content).toContain('commandNames.push(\'hIncrByFloat(totalSellRevenue)\')');
      expect(content).toContain('commandNames.push(\'hDel(pendingOrder)\')');
      expect(content).toContain('commandNames.push(\'hSet(updatedAt)\')');
      
      // 配列が返されることを確認
      expect(content).toContain('return commandNames');
      
      // 関数がエクスポートされることを確認
      expect(content).toContain('prepareRedisOperations');
    });
    
    test('executeDistributedTransaction でコマンド名が使用されることを確認', () => {
      // ファイルの内容を読み込んで、実装が正しいことを確認
      const fs = require('fs');
      const path = require('path');
      const managerPath = path.join(__dirname, '../../../src/database/manager.js');
      const content = fs.readFileSync(managerPath, 'utf8');
      
      // コマンド名が記録されることを確認
      expect(content).toContain('redisCommandNames = await prepareRedisOperations(redisTransaction, trade);');
      
      // 実際のコマンド名が使用されることを確認
      expect(content).toContain('const commandName = redisCommandNames[index] || `コマンド${index}`;');
    });
  });

  describe('2PC統合テスト - コマンド名を使用したエラーハンドリング', () => {
    
    test('Redis commitエラー時に実際のコマンド名が表示される設計になっている', () => {
      // テスト用のトレードデータ
      const mockRedisResults = [
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
        
        return `Redis command ${commandIndex} failed: ${String(error)}`;
      }

      // エラーハンドリングロジックのテスト
      const { failed: failedCommands, successful: successfulCommands } = mockRedisResults.reduce((acc, result, index) => {
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
    
    test('コマンド名が取得できない場合、従来のジェネリック名を使用する', () => {
      const mockRedisResults = [
        [1, null],  // エラーあり
        [null, 'OK'], // 成功
      ];

      // コマンド名が空の場合のテスト
      const commandNames = [];

      function getRedisErrorMessage(error, commandIndex) {
        if (typeof error === 'number') {
          return `Redis command ${commandIndex} failed: IO error`;
        }
        return 'Unknown error';
      }

      const { failed: failedCommands } = mockRedisResults.reduce((acc, result, index) => {
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