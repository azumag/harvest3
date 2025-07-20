/**
 * @fileoverview Issue #2682 の修正のテスト
 * Database Manager の分散ロック解放エラー修正: Redis Lua script引数の型チェック強化
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

describe('Database Manager - Issue #2682: Redis Lua script引数の型チェック強化', function() {
  
  it('型安全性チェックが実装されていることを確認', function() {
    // ソースコード読み込み
    const managerPath = resolve(__dirname, '../../../src/database/manager.js');
    const managerSource = readFileSync(managerPath, 'utf8');
    
    // 型チェックのパターンが実装されているかを確認
    expect(managerSource).toMatch(/Array\.isArray\(lockInfo\.lockKey\)/);
    expect(managerSource).toMatch(/Array\.isArray\(lockInfo\.lockValue\)/);
    expect(managerSource).toMatch(/typeof lockInfo\.lockKey === 'function'/);
    expect(managerSource).toMatch(/typeof lockInfo\.lockValue === 'function'/);
    expect(managerSource).toMatch(/typeof lockInfo\.lockKey === 'object'/);
    expect(managerSource).toMatch(/typeof lockInfo\.lockValue === 'object'/);
    
    // 文字列化チェックのパターンが実装されているかを確認
    expect(managerSource).toMatch(/stringLockKey === 'null'/);
    expect(managerSource).toMatch(/stringLockKey === 'undefined'/);
    expect(managerSource).toMatch(/stringLockKey === '\[object Object\]'/);
    expect(managerSource).toMatch(/stringLockKey\.includes\(','\)/);
    expect(managerSource).toMatch(/stringLockKey\.includes\('\[object'\)/);
    
    expect(managerSource).toMatch(/stringLockValue === 'null'/);
    expect(managerSource).toMatch(/stringLockValue === 'undefined'/);
    expect(managerSource).toMatch(/stringLockValue === '\[object Object\]'/);
    // Note: stringLockValue.includes(',') check was removed as it incorrectly rejected JSON values
    // JSON strings legitimately contain commas, so this check was causing false rejections
    expect(managerSource).toMatch(/stringLockValue\.includes\('\[object'\)/);
    
    // サニタイズ処理が実装されているかを確認
    expect(managerSource).toMatch(/replace\(\/\[\\x00-\\x1F\\x7F-\\x9F\]\/g, ''\)/);
    
    // Redis evalに渡す引数がstringLockKey、stringLockValueとして型安全性が確保されているかを確認
    expect(managerSource).toMatch(/redisClient\.eval\s*\(.*stringLockKey\s*,\s*stringLockValue\s*\)/);
    expect(managerSource).toMatch(/let finalLockKey = stringLockKey/);
    expect(managerSource).toMatch(/let finalLockValue = stringLockValue/);
  });

  it('関数が正常にエクスポートされていることを確認', function() {
    const manager = require('../../../src/database/manager');
    expect(typeof manager.releaseDistributedLock).toBe('function');
  });

  it('BalanceCheckerと同等の型安全性チェックが実装されていることを確認', function() {
    // BalanceCheckerのソースコード読み込み
    const balanceCheckerPath = resolve(__dirname, '../../../src/common/balanceChecker.js');
    const balanceCheckerSource = readFileSync(balanceCheckerPath, 'utf8');
    
    // Database Managerのソースコード読み込み  
    const managerPath = resolve(__dirname, '../../../src/database/manager.js');
    const managerSource = readFileSync(managerPath, 'utf8');
    
    // 主要な型チェックパターンが両方に存在することを確認
    const criticalPatterns = [
      /Array\.isArray\(/,
      /typeof .* === 'function'/,
      /typeof .* === 'object'/,
      /=== 'null'/,
      /=== 'undefined'/,
      /=== '\[object Object\]'/,
      /\.includes\(','\)/,
      /\.includes\('\[object'\)/,
      /\.replace\(\/\[\\x00-\\x1F\\x7F-\\x9F\]\/g, ''\)/
    ];
    
    for (const pattern of criticalPatterns) {
      expect(balanceCheckerSource).toMatch(pattern);
      expect(managerSource).toMatch(pattern);
    }
  });

});