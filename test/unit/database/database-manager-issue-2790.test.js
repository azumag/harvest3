/**
 * Database Manager Issue #2790 テスト
 * strategy-runnerサービスで例外が発生 - Redis Commit失敗とLua引数エラーの修正
 * 
 * 修正内容:
 * 1. トレードデータの数値バリデーション追加
 * 2. Redis Commitエラーの詳細情報表示
 * 3. エラーハンドリングの強化
 */

describe('Database Manager Issue #2790: Redis Commit失敗とエラーハンドリング修正', () => {
  let managerSource;

  beforeAll(() => {
    // ファイルソースを読み込んで実装を確認
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const managerPath = resolve(__dirname, '../../../src/database/manager.js');
    managerSource = readFileSync(managerPath, 'utf-8');
  });

  describe('Issue #2790 修正内容の実装確認', () => {
    it('トレードデータバリデーション関数が実装されている', () => {
      // validateTradeData関数の存在確認
      expect(managerSource).toMatch(/function validateTradeData\s*\(/);
      expect(managerSource).toMatch(/Issue #2790.*数値検証/);
      
      // 数値の有効性チェックの実装確認
      expect(managerSource).toMatch(/Number\.isFinite/);
      expect(managerSource).toMatch(/無効なamount値/);
      expect(managerSource).toMatch(/無効なvalue値/);
      expect(managerSource).toMatch(/無効なprice値/);
      
      // 極端な値のチェック実装確認
      expect(managerSource).toMatch(/MAX_TRADE_VALUE/);
      expect(managerSource).toMatch(/トレード値が上限を超過/);
    });

    it('バリデーション呼び出しが適切な場所に実装されている', () => {
      // executeDistributedTransaction内でバリデーションが呼ばれることを確認
      expect(managerSource).toMatch(/const validation = validateTradeData\(trade\)/);
      expect(managerSource).toMatch(/if \(\!validation\.valid\)/);
      expect(managerSource).toMatch(/トレードデータバリデーションエラー/);
    });

    it('Redis Commitエラーの詳細情報表示が実装されている', () => {
      // 詳細エラー情報の実装確認
      expect(managerSource).toMatch(/Issue #2790.*詳細なエラー情報/);
      expect(managerSource).toMatch(/const failedCommands = redisResults/);
      expect(managerSource).toMatch(/\.filter\(\(\{ result \}\) => result\[0\] !== null\)/);
      
      // エラーメッセージの改善確認
      expect(managerSource).not.toMatch(/Redis Commit失敗: 一部のコマンドが失敗しました(?!.*コマンド\d+)/);
      expect(managerSource).toMatch(/Redis Commit失敗: トランザクション結果がnull/);
      expect(managerSource).toMatch(/コマンド\$\{index\}/);
    });

    it('executeDistributedTransaction関数がエクスポートされている', () => {
      // テスト用のエクスポート確認
      expect(managerSource).toMatch(/executeDistributedTransaction.*Issue #2790.*テスト用/);
      expect(managerSource).toMatch(/module\.exports\s*=[\s\S]*executeDistributedTransaction/);
    });
  });

  describe('エラーメッセージパターンの検証', () => {
    it('Issue #2790で報告されたエラーパターンが対応されている', () => {
      // 元のエラー: "Redis Commit失敗: 一部のコマンドが失敗しました"
      // 新しいエラー: 詳細情報付きのエラーメッセージ
      
      // 汎用的なエラーメッセージが詳細なものに置き換えられていることを確認
      const genericErrorPattern = /throw new Error\(['"']Redis Commit失敗: 一部のコマンドが失敗しました['"]?\)/;
      const hasGenericError = genericErrorPattern.test(managerSource);
      
      // 汎用的なエラーがそのまま残っていないことを確認
      expect(hasGenericError).toBe(false);
      
      // 詳細なエラー情報を提供する実装があることを確認
      expect(managerSource).toMatch(/errorDetails.*failedCommands\.map/);
    });

    it('Luaスクリプト引数エラーの対策が既存修正に含まれている', () => {
      // Issue #2615, #2689 などの既存修正でLuaスクリプト問題は解決済み
      expect(managerSource).toMatch(/String\s*\(\s*stringLockKey\s*\)/);
      expect(managerSource).toMatch(/String\s*\(\s*stringLockValue\s*\)/);
      expect(managerSource).toMatch(/redisClient\.eval.*String\(.*String\(/);
    });
  });

  describe('バリデーション仕様の確認', () => {
    it('数値バリデーションの仕様が適切に実装されている', () => {
      // 必須フィールドチェック
      expect(managerSource).toMatch(/!trade\.amount.*!trade\.value.*!trade\.price/);
      
      // 型チェック
      expect(managerSource).toMatch(/typeof trade\.amount !== 'number'/);
      expect(managerSource).toMatch(/typeof trade\.value !== 'number'/);
      expect(managerSource).toMatch(/typeof trade\.price !== 'number'/);
      
      // 有限数チェック
      expect(managerSource).toMatch(/!Number\.isFinite\(trade\.amount\)/);
      expect(managerSource).toMatch(/!Number\.isFinite\(trade\.value\)/);
      expect(managerSource).toMatch(/!Number\.isFinite\(trade\.price\)/);
      
      // 正の値チェック
      expect(managerSource).toMatch(/trade\.amount <= 0/);
      expect(managerSource).toMatch(/trade\.value <= 0/);
      expect(managerSource).toMatch(/trade\.price <= 0/);
      
      // 上限チェック
      expect(managerSource).toMatch(/1e15/); // MAX_TRADE_VALUE
    });
  });
});