const { 
  BITBANK_ERRORS, 
  BITFLYER_ERRORS, 
  isBitbankError, 
  isBitflyerError 
} = require('../../../src/common/exchangeErrors');

describe('Exchange Error Constants', () => {
  describe('BITBANK_ERRORS', () => {
    test('定数が定義されている', () => {
      expect(BITBANK_ERRORS).toBeDefined();
      expect(BITBANK_ERRORS.SYSTEM_ERROR).toBe('10009');
      expect(BITBANK_ERRORS.AUTHENTICATION_ERROR).toBe('20001');
      expect(BITBANK_ERRORS.INSUFFICIENT_FUNDS).toBe('20003');
      expect(BITBANK_ERRORS.RATE_LIMIT_EXCEEDED).toBe('50429');
    });
  });

  describe('BITFLYER_ERRORS', () => {
    test('定数が定義されている', () => {
      expect(BITFLYER_ERRORS).toBeDefined();
      expect(BITFLYER_ERRORS.INVALID_API_KEY).toBe('INVALID_API_KEY');
      expect(BITFLYER_ERRORS.INSUFFICIENT_FUNDS).toBe('INSUFFICIENT_FUNDS');
      expect(BITFLYER_ERRORS.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
      expect(BITFLYER_ERRORS.MARKET_CLOSED).toBe('MARKET_CLOSED');
    });

    test('すべての主要なエラーカテゴリが含まれている', () => {
      // 認証関連
      expect(BITFLYER_ERRORS.INVALID_API_KEY).toBeDefined();
      expect(BITFLYER_ERRORS.INVALID_SIGNATURE).toBeDefined();
      
      // 注文関連
      expect(BITFLYER_ERRORS.ORDER_NOT_FOUND).toBeDefined();
      expect(BITFLYER_ERRORS.INVALID_SIZE).toBeDefined();
      expect(BITFLYER_ERRORS.INVALID_PRICE).toBeDefined();
      
      // 残高関連
      expect(BITFLYER_ERRORS.INSUFFICIENT_FUNDS).toBeDefined();
      expect(BITFLYER_ERRORS.INSUFFICIENT_MARGIN).toBeDefined();
      
      // システム関連
      expect(BITFLYER_ERRORS.SYSTEM_BUSY).toBeDefined();
      expect(BITFLYER_ERRORS.RATE_LIMIT_EXCEEDED).toBeDefined();
      
      // 市場関連
      expect(BITFLYER_ERRORS.MARKET_CLOSED).toBeDefined();
      expect(BITFLYER_ERRORS.TRADE_SUSPENDED).toBeDefined();
    });
  });
});

describe('isBitbankError', () => {
  test('nullエラーでfalseを返す', () => {
    expect(isBitbankError(null, BITBANK_ERRORS.SYSTEM_ERROR)).toBe(false);
    expect(isBitbankError(undefined, BITBANK_ERRORS.SYSTEM_ERROR)).toBe(false);
  });

  test('エラーメッセージでの文字列マッチング', () => {
    const error = new Error('System error occurred: 10009');
    expect(isBitbankError(error, BITBANK_ERRORS.SYSTEM_ERROR)).toBe(true);
    
    const error2 = new Error('Authentication failed with code 20001');
    expect(isBitbankError(error2, BITBANK_ERRORS.AUTHENTICATION_ERROR)).toBe(true);
  });

  test('エラーコードでのマッチング', () => {
    const error = { code: '20003', message: 'Insufficient funds' };
    expect(isBitbankError(error, BITBANK_ERRORS.INSUFFICIENT_FUNDS)).toBe(true);
  });

  test('レスポンスボディでのマッチング', () => {
    const error = {
      message: 'API Error',
      response: {
        error: 'Rate limit exceeded: 50429'
      }
    };
    expect(isBitbankError(error, BITBANK_ERRORS.RATE_LIMIT_EXCEEDED)).toBe(true);
  });

  test('マッチしない場合はfalseを返す', () => {
    const error = new Error('Different error message');
    expect(isBitbankError(error, BITBANK_ERRORS.SYSTEM_ERROR)).toBe(false);
  });
});

describe('isBitflyerError', () => {
  test('nullエラーでfalseを返す', () => {
    expect(isBitflyerError(null, BITFLYER_ERRORS.INVALID_API_KEY)).toBe(false);
    expect(isBitflyerError(undefined, BITFLYER_ERRORS.INVALID_API_KEY)).toBe(false);
  });

  test('エラーメッセージでの文字列マッチング', () => {
    const error = new Error('INVALID_API_KEY: API key is invalid');
    expect(isBitflyerError(error, BITFLYER_ERRORS.INVALID_API_KEY)).toBe(true);
    
    const error2 = new Error('insufficient_funds detected');
    expect(isBitflyerError(error2, BITFLYER_ERRORS.INSUFFICIENT_FUNDS)).toBe(true);
  });

  test('大文字小文字を区別しない', () => {
    const error = new Error('invalid_api_key in lowercase');
    expect(isBitflyerError(error, BITFLYER_ERRORS.INVALID_API_KEY)).toBe(true);
  });

  test('エラーコードでのマッチング', () => {
    const error = { code: 'ORDER_NOT_FOUND', message: 'Order not found' };
    expect(isBitflyerError(error, BITFLYER_ERRORS.ORDER_NOT_FOUND)).toBe(true);
  });

  test('レスポンスボディでのマッチング', () => {
    const error = {
      message: 'API Error',
      response: {
        error: 'RATE_LIMIT_EXCEEDED: Too many requests'
      }
    };
    expect(isBitflyerError(error, BITFLYER_ERRORS.RATE_LIMIT_EXCEEDED)).toBe(true);
  });

  test('マッチしない場合はfalseを返す', () => {
    const error = new Error('Different error message');
    expect(isBitflyerError(error, BITFLYER_ERRORS.INVALID_API_KEY)).toBe(false);
  });
});

// エラー定数の完全性チェック
describe('Error Constants Coverage', () => {
  test('bitbank エラーコードに重複がない', () => {
    const values = Object.values(BITBANK_ERRORS);
    const uniqueValues = [...new Set(values)];
    expect(values.length).toBe(uniqueValues.length);
  });

  test('bitflyer エラーコードに重複がない', () => {
    const values = Object.values(BITFLYER_ERRORS);
    const uniqueValues = [...new Set(values)];
    expect(values.length).toBe(uniqueValues.length);
  });

  test('重要なエラーカテゴリがカバーされている', () => {
    // bitbank
    expect(Object.values(BITBANK_ERRORS)).toContain('20001'); // 認証
    expect(Object.values(BITBANK_ERRORS)).toContain('20003'); // 残高不足
    expect(Object.values(BITBANK_ERRORS)).toContain('50429'); // レート制限
    
    // bitflyer
    expect(Object.values(BITFLYER_ERRORS)).toContain('INVALID_API_KEY'); // 認証
    expect(Object.values(BITFLYER_ERRORS)).toContain('INSUFFICIENT_FUNDS'); // 残高不足
    expect(Object.values(BITFLYER_ERRORS)).toContain('RATE_LIMIT_EXCEEDED'); // レート制限
  });
});