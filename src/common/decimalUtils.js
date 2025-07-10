/**
 * 高精度数値計算ユーティリティ
 * 
 * 残高計算における浮動小数点誤差を解消するため、
 * Decimal.jsを使用した高精度計算機能を提供
 */

const Decimal = require('decimal.js');

// 計算精度の設定
Decimal.set({
  precision: 20,  // 20桁の精度
  rounding: Decimal.ROUND_DOWN,  // 切り捨て（安全側に倒す）
  toExpNeg: -10,  // 指数表記の閾値
  toExpPos: 10
});

/**
 * 通貨ごとの最小単位設定
 */
const CURRENCY_PRECISION = {
  BTC: 8,
  ETH: 8,
  XRP: 6,
  LTC: 8,
  BCH: 8,
  SOL: 9,
  DOT: 10,
  XLM: 7,
  LINK: 8,
  JPY: 0
};

/**
 * 数値をDecimal型に変換
 */
function toDecimal(value) {
  if (value === null || value === undefined) {
    return new Decimal(0);
  }
  
  if (value instanceof Decimal) {
    return value;
  }
  
  // 文字列または数値をDecimalに変換
  try {
    return new Decimal(value.toString());
  } catch (error) {
    console.error('Decimal変換エラー:', error, 'value:', value);
    return new Decimal(0);
  }
}

/**
 * 通貨に応じた精度で丸める
 */
function roundByCurrency(value, currency) {
  const decimal = toDecimal(value);
  const precision = CURRENCY_PRECISION[currency] || 8;
  
  return decimal.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
}

/**
 * 残高の加算
 */
function addBalance(balance1, balance2, currency) {
  const sum = toDecimal(balance1).plus(toDecimal(balance2));
  return roundByCurrency(sum, currency);
}

/**
 * 残高の減算
 */
function subtractBalance(balance1, balance2, currency) {
  const diff = toDecimal(balance1).minus(toDecimal(balance2));
  return roundByCurrency(diff, currency);
}

/**
 * 残高の乗算
 */
function multiplyBalance(balance, multiplier, currency) {
  const product = toDecimal(balance).times(toDecimal(multiplier));
  return roundByCurrency(product, currency);
}

/**
 * 残高の除算
 */
function divideBalance(balance, divisor, currency) {
  const div = toDecimal(divisor);
  
  if (div.isZero()) {
    throw new Error('ゼロ除算エラー');
  }
  
  const quotient = toDecimal(balance).dividedBy(div);
  return roundByCurrency(quotient, currency);
}

/**
 * 残高の比較（差分計算）
 */
function compareBalance(balance1, balance2, currency) {
  const b1 = roundByCurrency(balance1, currency);
  const b2 = roundByCurrency(balance2, currency);
  
  const difference = b1.minus(b2);
  const absoluteDifference = difference.abs();
  const percentageDifference = b2.isZero() 
    ? new Decimal(100) 
    : absoluteDifference.dividedBy(b2).times(100);
  
  return {
    difference: difference.toNumber(),
    absoluteDifference: absoluteDifference.toNumber(),
    percentageDifference: percentageDifference.toNumber(),
    isEqual: difference.isZero(),
    balance1GreaterThan2: difference.isPositive()
  };
}

/**
 * 残高配列の合計
 */
function sumBalances(balances, currency) {
  const sum = balances.reduce((acc, balance) => {
    return acc.plus(toDecimal(balance));
  }, new Decimal(0));
  
  return roundByCurrency(sum, currency);
}

/**
 * 数値を通常の数値型に変換
 */
function toNumber(decimalValue) {
  if (decimalValue instanceof Decimal) {
    return decimalValue.toNumber();
  }
  return Number(decimalValue);
}

/**
 * 数値を文字列に変換（精度保持）
 */
function toString(decimalValue, currency) {
  const decimal = toDecimal(decimalValue);
  const rounded = roundByCurrency(decimal, currency);
  return rounded.toFixed();
}

/**
 * 安全な残高更新（既存の残高に対する変更を適用）
 */
function updateBalance(currentBalance, change, operation, currency) {
  const current = toDecimal(currentBalance);
  const changeAmount = toDecimal(change);
  
  let newBalance;
  switch (operation) {
    case 'add':
    case 'increment':
      newBalance = current.plus(changeAmount);
      break;
    case 'subtract':
    case 'decrement':
      newBalance = current.minus(changeAmount);
      break;
    case 'set':
      newBalance = changeAmount;
      break;
    default:
      throw new Error(`不明な操作: ${operation}`);
  }
  
  // 負の残高を防ぐ
  if (newBalance.isNegative()) {
    console.warn(`警告: 負の残高が検出されました。ゼロに設定します。currency: ${currency}, current: ${current}, change: ${change}, operation: ${operation}`);
    newBalance = new Decimal(0);
  }
  
  return roundByCurrency(newBalance, currency);
}

/**
 * 残高の検証
 */
function validateBalance(balance, currency) {
  try {
    const decimal = toDecimal(balance);
    
    // 負の値チェック
    if (decimal.isNegative()) {
      return {
        valid: false,
        error: '残高は負の値にできません'
      };
    }
    
    // 無限大チェック
    if (!decimal.isFinite()) {
      return {
        valid: false,
        error: '無効な数値です'
      };
    }
    
    // 最大値チェック（各通貨の現実的な最大値）
    const maxValues = {
      BTC: 21000000,  // BTCの最大供給量
      ETH: 1000000000, // 現実的な最大値
      JPY: 1000000000000 // 1兆円
    };
    
    const maxValue = maxValues[currency] || 1000000000;
    if (decimal.greaterThan(maxValue)) {
      return {
        valid: false,
        error: `${currency}の最大値を超えています`
      };
    }
    
    return {
      valid: true,
      value: roundByCurrency(decimal, currency).toNumber()
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

module.exports = {
  Decimal,
  toDecimal,
  roundByCurrency,
  addBalance,
  subtractBalance,
  multiplyBalance,
  divideBalance,
  compareBalance,
  sumBalances,
  toNumber,
  toString,
  updateBalance,
  validateBalance,
  CURRENCY_PRECISION
};