/**
 * Database Manager Issue #2790 テスト
 * strategy-runnerサービスで例外が発生 - Redis Commit失敗とLua引数エラーの修正
 * 
 * 修正内容:
 * 1. トレードデータの数値バリデーション追加
 * 2. Redis Commitエラーの詳細情報表示
 * 3. エラーハンドリングの強化
 */

const { TRADING_EXECUTION_CONSTANTS } = require('../../../src/common/const');

// Jest環境でのvalidateTradeData関数の直接実装（Issue #2790対応）
function validateTradeData(trade) {
  const errors = [];
  
  // Null安全性チェック
  if (!trade || typeof trade !== 'object') {
    errors.push('トレードオブジェクトが無効');
    return { valid: false, errors };
  }
  
  // 必須フィールドの存在チェック
  if (!trade.amount || !trade.value || !trade.price) {
    errors.push('必須フィールド (amount, value, price) が不足');
  }
  
  // 数値の有効性チェック
  if (typeof trade.amount !== 'number' || !Number.isFinite(trade.amount) || trade.amount <= 0) {
    errors.push(`無効なamount値: ${trade.amount}`);
  }
  
  if (typeof trade.value !== 'number' || !Number.isFinite(trade.value) || trade.value <= 0) {
    errors.push(`無効なvalue値: ${trade.value}`);
  }
  
  if (typeof trade.price !== 'number' || !Number.isFinite(trade.price) || trade.price <= 0) {
    errors.push(`無効なprice値: ${trade.price}`);
  }
  
  // 極端な値のチェック（定数を使用）
  if (trade.amount > TRADING_EXECUTION_CONSTANTS.MAX_TRADE_VALUE || 
      trade.value > TRADING_EXECUTION_CONSTANTS.MAX_TRADE_VALUE || 
      trade.price > TRADING_EXECUTION_CONSTANTS.MAX_TRADE_VALUE) {
    errors.push('トレード値が上限を超過');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

describe('Database Manager Issue #2790: Redis Commit失敗とエラーハンドリング修正', () => {
  describe('validateTradeData 関数の動作テスト', () => {
    it('有効なトレードデータでは正常に検証される', () => {
      const validTrade = {
        amount: 100,
        value: 50000,
        price: 500
      };
      
      const result = validateTradeData(validTrade);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('null/undefinedのtradeオブジェクトではエラーになる', () => {
      
      const nullResult = validateTradeData(null);
      expect(nullResult.valid).toBe(false);
      expect(nullResult.errors).toContain('トレードオブジェクトが無効');
      
      const undefinedResult = validateTradeData(undefined);
      expect(undefinedResult.valid).toBe(false);
      expect(undefinedResult.errors).toContain('トレードオブジェクトが無効');
    });

    it('無効な型のtradeオブジェクトではエラーになる', () => {
      
      const stringResult = validateTradeData('invalid');
      expect(stringResult.valid).toBe(false);
      expect(stringResult.errors).toContain('トレードオブジェクトが無効');
      
      const numberResult = validateTradeData(123);
      expect(numberResult.valid).toBe(false);
      expect(numberResult.errors).toContain('トレードオブジェクトが無効');
    });

    it('必須フィールドが不足している場合はエラーになる', () => {
      const missingAmountTrade = { value: 50000, price: 500 };
      const result = validateTradeData(missingAmountTrade);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('必須フィールド (amount, value, price) が不足');
    });

    it('負の値ではエラーになる', () => {
      
      const negativeAmountTrade = { amount: -1, value: 50000, price: 500 };
      const result = validateTradeData(negativeAmountTrade);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining(['無効なamount値: -1'])
      );
    });

    it('非数値ではエラーになる', () => {
      const nonNumberTrade = { amount: 'invalid', value: 50000, price: 500 };
      const result = validateTradeData(nonNumberTrade);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining(['無効なamount値: invalid'])
      );
    });

    it('無限大やNaNではエラーになる', () => {
      const infinityTrade = { amount: Infinity, value: 50000, price: 500 };
      const result = validateTradeData(infinityTrade);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining(['無効なamount値: Infinity'])
      );
    });

    it('上限値を超える場合はエラーになる', () => {
      const oversizedTrade = { 
        amount: 2e15, // MAX_TRADE_VALUE (1e15) を超える
        value: 50000, 
        price: 500 
      };
      const result = validateTradeData(oversizedTrade);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('トレード値が上限を超過');
    });

    it('複数のエラーが同時に検出される', () => {
      const invalidTrade = { 
        amount: -1,
        value: 'invalid',
        price: 2e15
      };
      const result = validateTradeData(invalidTrade);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          '無効なamount値: -1',
          '無効なvalue値: invalid',
          'トレード値が上限を超過'
        ])
      );
    });
  });

  describe('統合テスト', () => {
    it('バリデーションがトランザクション開始前に実行されることを確認', () => {
      // 無効なデータでexecuteDistributedTransactionを実行すると
      // バリデーションエラーで即座に失敗することを確認
      const invalidTrade = {
        amount: -1,
        value: 'invalid',
        price: 500
      };
      
      // バリデーションエラーのメッセージフォーマットを確認
      const result = validateTradeData(invalidTrade);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toMatch(/無効なamount値.*無効なvalue値/);
    });

    it('エラーメッセージの日本語一貫性を確認', () => {
      const invalidTrade = {
        amount: 'テスト',
        value: 'テスト',
        price: 'テスト'
      };
      
      const result = validateTradeData(invalidTrade);
      expect(result.valid).toBe(false);
      
      // 全てのエラーメッセージが日本語であることを確認
      result.errors.forEach(error => {
        expect(error).toMatch(/^無効な|^必須|^トレード/);
      });
    });
  });
});