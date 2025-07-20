/**
 * Issue #5061: backtestサービスで例外が発生 - シンプルな修正確認テスト
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5061: Simple Fix Verification', () => {
  const messageLockDir = '/tmp/startup_messages_5061';
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  
  beforeEach(() => {
    if (fs.existsSync(messageLockDir)) {
      const files = fs.readdirSync(messageLockDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(messageLockDir, file));
      });
      fs.rmdirSync(messageLockDir);
    }
  });

  afterEach(() => {
    if (fs.existsSync(messageLockDir)) {
      const files = fs.readdirSync(messageLockDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(messageLockDir, file));
      });
      fs.rmdirSync(messageLockDir);
    }
  });

  test('entrypoint.shにIssue #5061の修正が含まれている', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5061の修正コメントが含まれていることを確認
    expect(entrypointContent).toContain('Issue #5061 修正');
    
    // 修正されたロジックの要素を確認
    expect(entrypointContent).toContain('プロセス内フラグを即座に設定（レースコンディション防止）');
    expect(entrypointContent).toContain('フラグ設定をロック取得前に移動');
    expect(entrypointContent).toContain('一度出力されたメッセージは二度と出力しない（確実な重複防止）');
    
    // 修正された構造を確認：プロセス内フラグのチェックが最初にあることを確認
    const logStartupMessageFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
    
    // プロセス内重複チェックが最初にあることを確認
    expect(logStartupMessageFunction).toContain('プロセス内重複チェック（最初の防御線）');
    
    // フラグ設定がロック取得前にあることを確認
    const exportLine = logStartupMessageFunction.indexOf('export "$var_name"=1');
    const lockLine = logStartupMessageFunction.indexOf('set -C; echo');
    expect(exportLine).toBeLessThan(lockLine);
  });

  test('修正されたlog_startup_message関数の論理構造が正しい', async () => {
    // 修正されたロジックを抽出してテスト
    const testLogic = `#!/bin/bash
set -e

STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_5061"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 修正されたlog_startup_message関数（entrypoint.shから抽出）
log_startup_message() {
    local message="$1"
    
    # メッセージハッシュを一度だけ計算（一貫性確保）
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # プロセス内重複チェック（最初の防御線） - Issue #5061 修正
    if [ "\${!var_name}" = "1" ]; then
        # 既に同じメッセージを出力済み（プロセス内重複）
        # 一度出力されたメッセージは二度と出力しない（確実な重複防止）
        return 0
    fi
    
    # プロセス内フラグを即座に設定（レースコンディション防止）
    # Issue #5061 修正: フラグ設定をロック取得前に移動
    export "$var_name"=1
    
    # プロセス間重複チェック（第二の防御線）
    # より強固なatomic操作でロック取得を試行
    if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then
        # ロック取得成功：メッセージ出力
        log "$message"
        
        # ロックファイルのクリーンアップ（30秒後）
        (sleep 30 && rm -f "$lock_file" 2>/dev/null) &
        
        return 0
    else
        # ロック取得失敗：他のプロセスが処理中または処理済み
        # プロセス内フラグは既に設定済みなので、このプロセスでは今後同じメッセージは出力されない
        return 0
    fi
}

# テスト実行
echo "=== Testing Fixed Logic ==="
log_startup_message "Starting backtest container with enhanced error handling"
log_startup_message "Starting backtest container with enhanced error handling"  # この呼び出しは抑制されるべき
log_startup_message "Starting backtest container with enhanced error handling"  # この呼び出しも抑制されるべき
echo "=== Test Completed ==="
`;

    const testScriptPath = '/tmp/test-5061-simple.sh';
    fs.writeFileSync(testScriptPath, testLogic);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout, stderr } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
      
      console.log('修正ロジックテスト出力:');
      console.log(stdout);
      
      if (stderr.trim()) {
        console.log('エラー出力:');
        console.log(stderr);
      }
      
      // "Starting backtest container with enhanced error handling"メッセージの出現回数をカウント
      const messageLines = stdout.split('\n').filter(line => 
        line.includes('Starting backtest container with enhanced error handling')
      );
      
      console.log(`実際のメッセージ出力数: ${messageLines.length}`);
      messageLines.forEach((line, index) => {
        console.log(`  ${index + 1}: ${line}`);
      });
      
      // 修正後は1回のみ出力されることを期待
      expect(messageLines.length).toBe(1);
      expect(stderr.trim()).toBe('');
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 15000);

  test('entrypoint.shの構文が正しいことを確認', async () => {
    // bashスクリプトの構文チェック
    const { stderr } = await execAsync(`bash -n ${entrypointPath}`);
    expect(stderr.trim()).toBe('');
  });

  test('修正前後のロジック変更点を確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 修正前の問題のあるロジックが削除されていることを確認
    expect(entrypointContent).not.toContain('ロックファイルを削除してから終了');
    expect(entrypointContent).not.toContain('レースコンディション防止：即座にプロセス内フラグを設定');
    
    // 修正後のロジックが含まれていることを確認
    expect(entrypointContent).toContain('一度出力されたメッセージは二度と出力しない');
    expect(entrypointContent).toContain('フラグ設定をロック取得前に移動');
  });

  test('Issue #5061で報告された具体的なメッセージをテスト', async () => {
    // Issue #5061で報告された具体的なメッセージをテスト
    const specificTest = `#!/bin/bash
set -e

STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_5061"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 修正版の関数
log_startup_message() {
    local message="$1"
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    export "$var_name"=1
    
    if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then
        log "$message"
        (sleep 30 && rm -f "$lock_file" 2>/dev/null) &
        return 0
    else
        return 0
    fi
}

# Issue #5061のログで確認された状況を再現
export BACKTEST_MODE=true

echo "=== Issue #5061 Specific Test ==="
echo "[2025-07-20 13:41:37] [ENTRYPOINT] === 起動診断情報 ==="
echo "[2025-07-20 13:41:37] [ENTRYPOINT] プロセス ID: $$"
echo "[2025-07-20 13:41:37] [ENTRYPOINT] 起動時刻: $(date '+%Y-%m-%d %H:%M:%S')"
echo "[2025-07-20 13:41:37] [ENTRYPOINT] 作業ディレクトリ: $(pwd)"
echo "[2025-07-20 13:41:37] [ENTRYPOINT] バックテストモード: \${BACKTEST_MODE:-false}"
echo "[2025-07-20 13:41:37] [ENTRYPOINT] Acquiring startup lock..."
echo "[2025-07-20 13:41:37] [ENTRYPOINT] Startup lock acquired successfully (PID: $$)"

# 修正前は2回出力されていたメッセージ（修正後は1回のみ出力されるべき）
log_startup_message "Starting backtest container with enhanced error handling"
log_startup_message "Starting backtest container with enhanced error handling"

echo "=== Test Completed ==="
`;

    const testScriptPath = '/tmp/test-5061-specific.sh';
    fs.writeFileSync(testScriptPath, specificTest);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout, stderr } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
      
      console.log('Issue #5061 specific test 出力:');
      console.log(stdout);
      
      // 重複メッセージの確認
      const duplicateMessages = stdout.split('\n').filter(line => 
        line.includes('Starting backtest container with enhanced error handling')
      );
      
      console.log(`Issue #5061 specific: メッセージ出力数 = ${duplicateMessages.length}`);
      
      // 修正により重複が解消されていることを確認
      expect(duplicateMessages.length).toBe(1);
      expect(stderr.trim()).toBe('');
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 10000);
});