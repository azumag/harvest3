/**
 * Issue #5515: Redis結果処理でDRY原則の違反を解決
 * parseRedisResult ヘルパー関数の単体テスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

const databaseManager = require('../../../src/database/manager');

describe('Issue #5515: parseRedisResult ヘルパー関数テスト', () => {
  
  describe('配列形式の結果処理', () => {
    test('成功結果 [null, value] を正しく処理する', () => {
      const result = [null, 'test-value'];
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: 'test-value'
      });
    });

    test('エラー結果 [Error, null] を正しく処理する', () => {
      const error = new Error('Redis error');
      const result = [error, null];
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: error,
        value: null
      });
    });

    test('数値結果 [null, 123] を正しく処理する', () => {
      const result = [null, 123];
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: 123
      });
    });

    test('オブジェクト結果 [null, {...}] を正しく処理する', () => {
      const testObject = { key: 'value', count: 42 };
      const result = [null, testObject];
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: testObject
      });
    });
  });

  describe('直接値形式の結果処理', () => {
    test('文字列値を正しく処理する', () => {
      const result = 'direct-value';
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: 'direct-value'
      });
    });

    test('数値値を正しく処理する', () => {
      const result = 456;
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: 456
      });
    });

    test('オブジェクト値を正しく処理する', () => {
      const testObject = { status: 'ok', data: [1, 2, 3] };
      const result = testObject;
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: testObject
      });
    });

    test('null値を正しく処理する', () => {
      const result = null;
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: null
      });
    });

    test('undefined値を正しく処理する', () => {
      const result = undefined;
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: undefined
      });
    });
  });

  describe('エッジケース', () => {
    test('空配列を正しく処理する', () => {
      const result = [];
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: undefined,
        value: undefined
      });
    });

    test('単一要素配列を正しく処理する', () => {
      const result = ['single-element'];
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: 'single-element',
        value: undefined
      });
    });

    test('3要素以上の配列を正しく処理する', () => {
      const result = ['error', 'value', 'extra'];
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: 'error',
        value: 'value'
      });
    });

    test('boolean値を正しく処理する', () => {
      const result = true;
      const parsed = databaseManager.parseRedisResult(result);
      
      expect(parsed).toEqual({
        error: null,
        value: true
      });
    });
  });
});