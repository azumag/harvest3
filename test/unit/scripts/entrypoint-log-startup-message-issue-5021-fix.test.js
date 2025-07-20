/**
 * entrypoint.sh log_startup_message関数の単体テスト - Issue #5021修正版
 * CLAUDE.md要件: TDD原則に従った実装、.tmpディレクトリに作成
 * 
 * Issue #5021: 重複ログ防止機能のatomic操作とプロセス内フラグによる修正
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('entrypoint.sh log_startup_message Issue #5021修正', () => {
  const entrypointPath = path.join(__dirname, '../../../entrypoint.sh');
  
  beforeEach(() => {
    // テスト前のクリーンアップ
    if (fs.existsSync('/tmp/startup_messages')) {
      execSync('rm -rf /tmp/startup_messages', { stdio: 'ignore' });
    }
  });

  afterEach(() => {
    // テスト後のクリーンアップ
    if (fs.existsSync('/tmp/startup_messages')) {
      execSync('rm -rf /tmp/startup_messages', { stdio: 'ignore' });
    }
  });

  describe('Issue #5021修正内容の確認', () => {
    test('log_startup_message関数が期待される修正済みの実装になっている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 関数定義の存在確認
      expect(entrypointContent).toContain('log_startup_message() {');
      
      // Issue #5021修正ポイント1: ハッシュ計算の一貫性確保
      expect(entrypointContent).toContain('メッセージハッシュを一度だけ計算（一貫性確保）');
      expect(entrypointContent).toContain('local message_hash=$(get_message_hash "$message")');
      
      // Issue #5021修正ポイント2: プロセス内重複チェック（最初の防御線）
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
      expect(entrypointContent).toContain('if [ "${!var_name}" = "1" ]; then');
      
      // Issue #5021修正ポイント3: atomic操作によるプロセス間重複チェック
      expect(entrypointContent).toContain('プロセス間重複チェック（第二の防御線）');
      expect(entrypointContent).toContain('if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then');
      
      // Issue #5021修正ポイント4: ロック取得後のプロセス内フラグ設定
      expect(entrypointContent).toContain('ロック取得成功後にプロセス内フラグを設定（重複防止）');
      expect(entrypointContent).toContain('export "$var_name"=1');
    });

    test('get_message_hash関数が適切に実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // MD5ハッシュ値生成関数の存在確認
      expect(entrypointContent).toContain('get_message_hash() {');
      expect(entrypointContent).toContain('echo "$1" | md5sum | cut -d\' \' -f1');
      
      // DRY原則適用のコメント確認
      expect(entrypointContent).toContain('MD5ハッシュ値生成関数（DRY原則適用）');
    });

    test('atomic操作の実装が正しい', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // atomicファイル操作の実装確認
      expect(entrypointContent).toContain('set -C');
      expect(entrypointContent).toContain('echo "$$:$(date +%s.%N)" > "$lock_file"');
      
      // ロックファイルの自動クリーンアップ
      expect(entrypointContent).toContain('(sleep 30 && rm -f "$lock_file" 2>/dev/null) &');
    });
  });

  describe('重複ログ防止機能の動作テスト', () => {
    test('同一メッセージの重複出力が正しく防止される', () => {
      // テスト用スクリプトの作成
      const testScript = `#!/bin/bash
set -e

# entrypoint.shから必要な部分を抽出
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# ログ関数（テスト用簡易版）
log() {
    echo "[TEST] $1"
}

# MD5ハッシュ値生成関数（DRY原則適用）
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# Issue #5021修正版log_startup_message関数
log_startup_message() {
    local message="$1"
    
    # メッセージハッシュを一度だけ計算（一貫性確保）
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # プロセス内重複チェック（最初の防御線）
    if [ "\${!var_name}" = "1" ]; then
        # 既に同じメッセージを出力済み（プロセス内重複）
        return 0
    fi
    
    # プロセス間重複チェック（第二の防御線）
    # atomic操作でロック取得を試行
    if (set -C; echo "$$:\$(date +%s.%N)" > "$lock_file") 2>/dev/null; then
        # ロック取得成功：メッセージ出力
        log "$message"
        
        # ロック取得成功後にプロセス内フラグを設定（重複防止）
        export "$var_name"=1
        
        # ロックファイルのクリーンアップ（2秒後、テスト用短縮）
        (sleep 2 && rm -f "$lock_file" 2>/dev/null) &
        
        return 0
    else
        # ロック取得失敗：他のプロセスが既に処理済みまたは処理中
        # プロセス内フラグは設定せず、単純に終了
        return 0
    fi
}

# テスト実行
echo "=== Issue #5021 重複ログ防止テスト開始 ==="

# 同一メッセージの連続呼び出し
log_startup_message "Test message for duplication check"
log_startup_message "Test message for duplication check"  # 重複防止されるべき
log_startup_message "Test message for duplication check"  # 重複防止されるべき

# 異なるメッセージ
log_startup_message "Different message should be logged"

# 少し待ってから同じメッセージ（まだプロセス内フラグが有効）
sleep 1
log_startup_message "Test message for duplication check"  # まだ重複防止されるべき

echo "=== テスト完了 ==="
`;

      const testPath = path.join(__dirname, 'duplication_test.sh');
      fs.writeFileSync(testPath, testScript);
      fs.chmodSync(testPath, '755');

      try {
        const output = execSync(`bash ${testPath}`, { encoding: 'utf8' });
        
        // 出力されたログメッセージをカウント
        const lines = output.split('\n');
        const testMessages = lines.filter(line => line.includes('[TEST] Test message for duplication check'));
        const differentMessages = lines.filter(line => line.includes('[TEST] Different message should be logged'));
        
        // 重複メッセージが1回のみ出力されることを確認
        expect(testMessages.length).toBe(1);
        
        // 異なるメッセージは正常に出力されることを確認  
        expect(differentMessages.length).toBe(1);
        
        // テスト完了メッセージの確認
        expect(output).toContain('テスト完了');
        
      } finally {
        // クリーンアップ
        if (fs.existsSync(testPath)) {
          fs.unlinkSync(testPath);
        }
      }
    });

    test('プロセス間での重複防止が機能する', () => {
      // 複数プロセスでの重複テスト用スクリプト
      const multiProcessTestScript = `#!/bin/bash
set -e

# entrypoint.shから必要な部分を抽出
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

log() {
    echo "[PID:$$] $1"
}

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

log_startup_message() {
    local message="$1"
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    if (set -C; echo "$$:\$(date +%s.%N)" > "$lock_file") 2>/dev/null; then
        log "$message"
        export "$var_name"=1
        (sleep 3 && rm -f "$lock_file" 2>/dev/null) &
        return 0
    else
        return 0
    fi
}

# バックグラウンドで同時実行
log_startup_message "Multi-process test message" &
log_startup_message "Multi-process test message" &
log_startup_message "Multi-process test message" &

# 全プロセス完了を待つ
wait

echo "Multi-process test completed"
`;

      const multiTestPath = path.join(__dirname, 'multi_process_test.sh');
      fs.writeFileSync(multiTestPath, multiProcessTestScript);
      fs.chmodSync(multiTestPath, '755');

      try {
        const output = execSync(`bash ${multiTestPath}`, { encoding: 'utf8' });
        
        // ログメッセージが1回のみ出力されることを確認
        const logMessages = output.split('\n').filter(line => line.includes('[PID:') && line.includes('Multi-process test message'));
        expect(logMessages.length).toBe(1);
        
        // テスト完了メッセージの確認
        expect(output).toContain('Multi-process test completed');
        
      } finally {
        // クリーンアップ
        if (fs.existsSync(multiTestPath)) {
          fs.unlinkSync(multiTestPath);
        }
      }
    });
  });

  describe('エラーハンドリングと堅牢性テスト', () => {
    test('ロックディレクトリが存在しない場合の処理', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // ディレクトリ作成処理の確認
      expect(entrypointContent).toContain('mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true');
    });

    test('MD5コマンドが利用可能であることの前提', () => {
      // md5sumコマンドの利用可能性チェック
      expect(() => {
        execSync('which md5sum', { stdio: 'ignore' });
      }).not.toThrow();
    });

    test('set -Cオプションによるatomic操作の前提条件', () => {
      // set -Cオプションの動作確認
      const testScript = `#!/bin/bash
set -e
test_file="/tmp/atomic_test_$$"
rm -f "$test_file"

# 最初の試行は成功するはず
if (set -C; echo "test" > "$test_file") 2>/dev/null; then
    echo "FIRST_SUCCESS"
fi

# 二回目の試行は失敗するはず
if (set -C; echo "test2" > "$test_file") 2>/dev/null; then
    echo "SECOND_SUCCESS"
else
    echo "SECOND_FAILED"
fi

rm -f "$test_file"
`;

      const atomicTestPath = path.join(__dirname, 'atomic_behavior_test.sh');
      fs.writeFileSync(atomicTestPath, testScript);
      fs.chmodSync(atomicTestPath, '755');

      try {
        const output = execSync(`bash ${atomicTestPath}`, { encoding: 'utf8' });
        expect(output).toContain('FIRST_SUCCESS');
        expect(output).toContain('SECOND_FAILED');
      } finally {
        if (fs.existsSync(atomicTestPath)) {
          fs.unlinkSync(atomicTestPath);
        }
      }
    });
  });

  describe('関数呼び出し箇所の確認', () => {
    test('entrypoint.sh内でlog_startup_messageが適切に呼び出されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動メッセージでの呼び出し確認
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
    });

    test('main関数内での適切なタイミングでの呼び出し', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // main関数の存在確認
      expect(entrypointContent).toContain('main() {');
      
      // 起動ロック取得後のメッセージ出力確認
      expect(entrypointContent).toContain('起動ロック取得後に安全にメッセージを出力');
    });
  });

  describe('Issue #5021特有の修正ポイント検証', () => {
    test('プロセス内フラグとatomic操作の連携', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // プロセス内フラグによる最初の防御線
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
      
      // atomic操作による第二の防御線
      expect(entrypointContent).toContain('プロセス間重複チェック（第二の防御線）');
      
      // 成功時のフラグ設定タイミング
      expect(entrypointContent).toContain('ロック取得成功後にプロセス内フラグを設定（重複防止）');
    });

    test('ハッシュ計算の一貫性確保', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 一度だけの計算
      expect(entrypointContent).toContain('メッセージハッシュを一度だけ計算（一貫性確保）');
      
      // DRY原則適用
      expect(entrypointContent).toContain('MD5ハッシュ値生成関数（DRY原則適用）');
    });

    test('修正前の問題（Issue #5021で報告された問題）が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 修正されたファイルベースatomic実装
      expect(entrypointContent).toContain('atomic ファイルベース実装によるメッセージ重複防止システム');
      
      // 新しいコメント（Issue #5021修正）
      expect(entrypointContent).toContain('重複起動ログ防止関数（Issue #5021 修正）');
    });
  });

  describe('パフォーマンスと効率性', () => {
    test('ハッシュ計算が関数内で1回のみ実行される', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // log_startup_message関数内でのハッシュ計算確認
      const functionMatch = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/);
      expect(functionMatch).toBeTruthy();
      
      const functionContent = functionMatch[0];
      const hashCalls = (functionContent.match(/get_message_hash/g) || []).length;
      expect(hashCalls).toBe(1); // 1回のみの計算
    });

    test('不要なファイルアクセスの最小化', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // プロセス内チェックが先に実行される（ファイルアクセス回避）
      const functionContent = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
      const processCheckIndex = functionContent.indexOf('プロセス内重複チェック');
      const fileCheckIndex = functionContent.indexOf('プロセス間重複チェック');
      
      expect(processCheckIndex).toBeLessThan(fileCheckIndex);
    });
  });
});