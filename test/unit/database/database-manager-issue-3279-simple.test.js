/**
 * Issue #3279: strategy-runnerサービスの分散ロック解放エラー修正テスト
 * 簡易版 - 実装の型安全性チェックのみ
 */

describe('Issue #3279: 分散ロック解放エラー修正 - 簡易版', () => {
  
  describe('型安全性チェック実装の確認', () => {
    it('Issue #3279の修正が実装されていることを確認', () => {
      const { readFileSync } = require('fs');
      const { resolve } = require('path');
      
      const managerPath = resolve(__dirname, '../../../src/database/manager.js');
      const managerSource = readFileSync(managerPath, 'utf8');
      
      // Issue #3279 の修正が含まれていることを確認
      expect(managerSource).toMatch(/Issue #3279: Redis Lua script引数の型安全性を強化/);
      expect(managerSource).toMatch(/最終的な型チェック/);
      expect(managerSource).toMatch(/typeof finalLockKey !== 'string'/);
      expect(managerSource).toMatch(/typeof finalLockValue !== 'string'/);
      expect(managerSource).toMatch(/finalLockKey, finalLockValue/);
    });

    it('releaseDistributedLock関数がエクスポートされていることを確認', () => {
      const manager = require('../../../src/database/manager');
      expect(typeof manager.releaseDistributedLock).toBe('function');
    });

    it('変数名がfinalLockKey、finalLockValueに変更されていることを確認', () => {
      const { readFileSync } = require('fs');
      const { resolve } = require('path');
      
      const managerPath = resolve(__dirname, '../../../src/database/manager.js');
      const managerSource = readFileSync(managerPath, 'utf8');
      
      // 新しい変数名が使用されていることを確認
      expect(managerSource).toMatch(/const finalLockKey = ensureString\(stringLockKey\)/);
      expect(managerSource).toMatch(/const finalLockValue = ensureString\(stringLockValue\)/);
    });

    it('最終的な型チェックが実装されていることを確認', () => {
      const { readFileSync } = require('fs');
      const { resolve } = require('path');
      
      const managerPath = resolve(__dirname, '../../../src/database/manager.js');
      const managerSource = readFileSync(managerPath, 'utf8');
      
      // 最終的な型チェックのログ出力が含まれていることを確認
      expect(managerSource).toMatch(/分散ロック解放スキップ: 最終的な型チェック失敗/);
      expect(managerSource).toMatch(/lockKey: \${typeof finalLockKey}/);
      expect(managerSource).toMatch(/lockValue: \${typeof finalLockValue}/);
    });
  });
});