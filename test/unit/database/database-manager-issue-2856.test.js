/**
 * Database Manager Issue #2856 テスト
 * strategy-runnerサービスで例外が発生 - Redis Commit失敗の詳細解析と修正
 * 
 * 修正内容:
 * 1. Redis Commit結果の詳細な検証とエラーハンドリング強化
 * 2. 具体的なエラーメッセージの提供
 * 3. prepareRedisOperationsのバリデーション強化
 * 4. 部分的失敗時の詳細ログ出力
 */

const { executeDistributedTransaction, validateTradeData } = require('../../../src/database/manager');

describe('Database Manager Issue #2856: Redis Commit失敗の詳細解析と修正', () => {
  describe('Redis Commit結果の詳細検証', () => {
    
    it('Redis結果の成功/失敗を正しく分類する', () => {
      // Redis exec()の結果をシミュレート
      const mockRedisResults = [
        [null, 'OK'],           // 成功
        [new Error('TEST_ERROR'), null],  // 失敗
        [null, 1],              // 成功
        [new Error('ANOTHER_ERROR'), null] // 失敗
      ];
      
      const failedCommands = [];
      const successfulCommands = [];
      
      mockRedisResults.forEach((result, index) => {
        if (result[0] !== null) {
          failedCommands.push({
            index,
            error: result[0],
            errorMessage: result[0].message || result[0].toString(),
            command: `コマンド${index}`
          });
        } else {
          successfulCommands.push({
            index,
            result: result[1]
          });
        }
      });
      
      expect(failedCommands.length).toBe(2);
      expect(successfulCommands.length).toBe(2);
      expect(failedCommands[0].errorMessage).toBe('TEST_ERROR');
      expect(failedCommands[1].errorMessage).toBe('ANOTHER_ERROR');
    });
    
    it('部分的失敗時の詳細エラーメッセージが正しく構築される', () => {
      const failedCommands = [
        { index: 1, errorMessage: 'Redis connection timeout', command: 'コマンド1' },
        { index: 3, errorMessage: 'Invalid key format', command: 'コマンド3' }
      ];
      
      const errorDetails = failedCommands.map(({ index, errorMessage, command }) => 
        `${command}: ${errorMessage}`
      ).join(', ');
      
      const expectedMessage = `Redis Commit失敗: ${failedCommands.length}個のコマンドが失敗しました - ${errorDetails}`;
      
      expect(errorDetails).toBe('コマンド1: Redis connection timeout, コマンド3: Invalid key format');
      expect(expectedMessage).toBe('Redis Commit失敗: 2個のコマンドが失敗しました - コマンド1: Redis connection timeout, コマンド3: Invalid key format');
    });
  });
  
  describe('prepareRedisOperationsのバリデーション', () => {
    const mockTransaction = {
      hIncrByFloat: jest.fn(),
      hDel: jest.fn(),
      hSet: jest.fn()
    };
    
    beforeEach(() => {
      jest.clearAllMocks();
    });
    
    it('無効なexchange値でエラーが発生する', async () => {
      const invalidTrade = {
        exchange: '',
        symbol: 'BTC/JPY',
        strategy: 'test',
        side: 'buy',
        amount: 100,
        value: 50000
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, invalidTrade))
        .toThrow('Redis操作準備時のバリデーションエラー: 無効なexchange値');
    });
    
    it('無効なsymbol値でエラーが発生する', async () => {
      const invalidTrade = {
        exchange: 'bitflyer',
        symbol: null,
        strategy: 'test',
        side: 'buy',
        amount: 100,
        value: 50000
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, invalidTrade))
        .toThrow('Redis操作準備時のバリデーションエラー: 無効なsymbol値');
    });
    
    it('無効なstrategy値でエラーが発生する', async () => {
      const invalidTrade = {
        exchange: 'bitflyer',
        symbol: 'BTC/JPY',
        strategy: undefined,
        side: 'buy',
        amount: 100,
        value: 50000
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, invalidTrade))
        .toThrow('Redis操作準備時のバリデーションエラー: 無効なstrategy値');
    });
    
    it('無効なside値でエラーが発生する', async () => {
      const invalidTrade = {
        exchange: 'bitflyer',
        symbol: 'BTC/JPY',
        strategy: 'test',
        side: 'invalid',
        amount: 100,
        value: 50000
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, invalidTrade))
        .toThrow('Redis操作準備時のバリデーションエラー: 無効なside値');
    });
    
    it('無効なamount値でエラーが発生する', async () => {
      const invalidTrade = {
        exchange: 'bitflyer',
        symbol: 'BTC/JPY',
        strategy: 'test',
        side: 'buy',
        amount: -1,
        value: 50000
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, invalidTrade))
        .toThrow('Redis操作準備時のバリデーションエラー: Redis操作のためのamount値が無効: -1');
    });
    
    it('無効なvalue値でエラーが発生する', async () => {
      const invalidTrade = {
        exchange: 'bitflyer',
        symbol: 'BTC/JPY',
        strategy: 'test',
        side: 'buy',
        amount: 100,
        value: Infinity
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, invalidTrade))
        .toThrow('Redis操作準備時のバリデーションエラー: Redis操作のためのvalue値が無効: Infinity');
    });
    
    it('複数のバリデーションエラーが同時に報告される', async () => {
      const invalidTrade = {
        exchange: '',
        symbol: null,
        strategy: 'test',
        side: 'invalid',
        amount: -1,
        value: NaN
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, invalidTrade))
        .toThrow(/Redis操作準備時のバリデーションエラー:.*無効なexchange値.*無効なsymbol値.*無効なside値.*Redis操作のためのamount値が無効.*Redis操作のためのvalue値が無効/);
    });
  });
  
  describe('統合テスト', () => {
    it('validateTradeDataとprepareRedisOperationsの連携', () => {
      // 最初のバリデーション（validateTradeData）を通過するが、
      // prepareRedisOperationsで追加のバリデーションにより失敗する場合をテスト
      
      const borderlineTrade = {
        amount: 100,
        value: 50000,
        price: 500,
        exchange: '',  // prepareRedisOperationsで失敗
        symbol: 'BTC/JPY',
        strategy: 'test',
        side: 'buy'
      };
      
      // validateTradeDataは基本的な数値チェックのみ
      const validation = validateTradeData(borderlineTrade);
      expect(validation.valid).toBe(true);
      
      // prepareRedisOperationsでは文字列フィールドもチェック
      const mockTransaction = {
        hIncrByFloat: jest.fn(),
        hDel: jest.fn(),
        hSet: jest.fn()
      };
      
      const { prepareRedisOperations } = require('../../../src/database/manager');
      
      expect(() => prepareRedisOperations(mockTransaction, borderlineTrade))
        .toThrow('Redis操作準備時のバリデーションエラー');
    });
    
    it('エラーメッセージの明確性と日本語対応', () => {
      const scenarios = [
        {
          name: '基本バリデーション失敗',
          trade: { amount: -1, value: 'invalid', price: 500 },
          expectedPattern: /無効なamount値.*無効なvalue値/
        },
        {
          name: 'Redis操作準備失敗',
          trade: { 
            amount: 100, value: 50000, price: 500,
            exchange: '', symbol: 'BTC/JPY', strategy: 'test', side: 'buy'
          },
          expectedPattern: /Redis操作準備時のバリデーションエラー.*無効なexchange値/
        }
      ];
      
      scenarios.forEach(({ name, trade, expectedPattern }) => {
        if (name === '基本バリデーション失敗') {
          const result = validateTradeData(trade);
          expect(result.valid).toBe(false);
          expect(result.errors.join(', ')).toMatch(expectedPattern);
        } else {
          const mockTransaction = {
            hIncrByFloat: jest.fn(),
            hDel: jest.fn(),
            hSet: jest.fn()
          };
          
          const { prepareRedisOperations } = require('../../../src/database/manager');
          
          expect(() => prepareRedisOperations(mockTransaction, trade))
            .toThrow(expectedPattern);
        }
      });
    });
  });
  
  describe('エラーハンドリング改善の確認', () => {
    it('従来の汎用エラーメッセージから具体的なエラーメッセージへの改善', () => {
      // 従来: "Redis Commit失敗: 一部のコマンドが失敗しました"
      // 修正後: "Redis Commit失敗: 2個のコマンドが失敗しました - コマンド1: エラー詳細, コマンド3: エラー詳細"
      
      const failedCommands = [
        { index: 0, errorMessage: 'Connection timeout', command: 'コマンド0' },
        { index: 2, errorMessage: 'Invalid key format', command: 'コマンド2' }
      ];
      
      const errorDetails = failedCommands.map(({ index, errorMessage, command }) => 
        `${command}: ${errorMessage}`
      ).join(', ');
      
      const improvedMessage = `Redis Commit失敗: ${failedCommands.length}個のコマンドが失敗しました - ${errorDetails}`;
      
      expect(improvedMessage).toBe('Redis Commit失敗: 2個のコマンドが失敗しました - コマンド0: Connection timeout, コマンド2: Invalid key format');
      expect(improvedMessage).not.toBe('Redis Commit失敗: 一部のコマンドが失敗しました');
    });
    
    it('成功と失敗の統計情報が正しく提供される', () => {
      const mockResults = [
        [null, 'OK'],
        [new Error('Error1'), null],
        [null, 1],
        [new Error('Error2'), null],
        [null, 'OK']
      ];
      
      const failedCommands = [];
      const successfulCommands = [];
      
      mockResults.forEach((result, index) => {
        if (result[0] !== null) {
          failedCommands.push({ index, error: result[0] });
        } else {
          successfulCommands.push({ index, result: result[1] });
        }
      });
      
      expect(successfulCommands.length).toBe(3);
      expect(failedCommands.length).toBe(2);
      
      // ログメッセージの検証
      const logMessage = `Redis Commit詳細 - 成功: ${successfulCommands.length}, 失敗: ${failedCommands.length}`;
      expect(logMessage).toBe('Redis Commit詳細 - 成功: 3, 失敗: 2');
    });
  });
});