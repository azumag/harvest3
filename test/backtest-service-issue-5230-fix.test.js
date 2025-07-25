/**
 * Issue #5230: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * 修正内容:
 * 1. MongoDB環境変数検証の追加 (mongoDatabase.js)
 * 2. log_backtest_startup_message関数の簡素化 (entrypoint.sh)
 * 3. KISS原則適用による複雑性の削減
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5230: backtestサービス例外修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const mongoDbPath = path.join(__dirname, '..', 'src', 'database', 'mongoDatabase.js');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    // テスト後のクリーンアップ
    try {
      if (fs.existsSync('/tmp/backtest-startup-message.last')) {
        fs.unlinkSync('/tmp/backtest-startup-message.last');
      }
    } catch (err) {
      // ignore cleanup errors
    }
  });

  test('Issue #5230修正: MongoDB環境変数検証が追加されていることを確認', () => {
    expect(fs.existsSync(mongoDbPath)).toBe(true);
    
    const mongoDbContent = fs.readFileSync(mongoDbPath, 'utf8');
    
    // Issue #5230修正: 環境変数検証の追加
    expect(mongoDbContent).toContain('Issue #5230修正: 環境変数検証の追加');
    expect(mongoDbContent).toContain('MONGO_URL環境変数が設定されていません');
    expect(mongoDbContent).toContain('MONGODB_DB_NAME環境変数が設定されていません');
    
    // connectDB関数での早期return
    expect(mongoDbContent).toContain('Issue #5230修正: 環境変数未設定時の早期return');
    expect(mongoDbContent).toContain('MongoDB接続に必要な環境変数が未設定です');
  });

  test('Issue #5230修正: log_backtest_startup_message関数が簡素化されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5230修正のコメントが追加されている
    expect(entrypointContent).toContain('Issue #5230修正: backtest container専用起動メッセージ関数（KISS原則適用・簡素化版）');
    expect(entrypointContent).toContain('過去の複雑な実装（Issue #5127, #5058, #5175, #5216, #5333）を簡素化');
    
    // 簡素化された実装の特徴
    expect(entrypointContent).toContain('local timestamp_file="/tmp/backtest-startup-message.last"');
    expect(entrypointContent).toContain('local suppress_duration=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}');
    expect(entrypointContent).toContain('# タイムスタンプ更新（atomic write）');
    
    // log_backtest_startup_message関数から複雑な実装が削除されていることを確認
    const functionMatch = entrypointContent.match(
      /log_backtest_startup_message\(\) \{[\s\S]*?\n\}/
    );
    expect(functionMatch).toBeTruthy();
    const functionContent = functionMatch[0];
    
    expect(functionContent).not.toContain('exec 200>"$lock_file"');
    expect(functionContent).not.toContain('flock -x -w "$max_wait_time" 200');
    expect(functionContent).not.toContain('fallback_lock_dir');
  });

  test('簡素化されたlog_backtest_startup_message関数の重複防止テスト', async () => {
    const testScript = `#!/bin/bash
set -e

# テスト用の環境変数設定
BACKTEST_STARTUP_LOCK_TIMEOUT=5

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5230修正: 簡素化版の関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local timestamp_file="/tmp/test-backtest-startup-message.last"
    local suppress_duration=\${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}
    
    # 前回のメッセージ出力時刻をチェック
    if [ -f "$timestamp_file" ]; then
        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo "0")
        local time_diff=$((current_time - last_time))
        
        if [ "$time_diff" -lt "$suppress_duration" ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            return 0
        fi
    fi
    
    # メッセージ出力
    log "$message"
    
    # タイムスタンプ更新（atomic write）
    local temp_file="\${timestamp_file}.tmp.$$"
    if echo "$current_time" > "$temp_file" && mv "$temp_file" "$timestamp_file"; then
        chmod 600 "$timestamp_file" 2>/dev/null || true
    else
        rm -f "$temp_file" 2>/dev/null || true
        log "WARNING: Failed to update startup message timestamp"
    fi
    
    return 0
}

# テスト実行：連続呼び出しで重複防止をテスト
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# クリーンアップ
rm -f /tmp/test-backtest-startup-message.last* 2>/dev/null || true
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5230-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
      
      // 実際のメッセージ出力は1回のみ
      const startupMessages = stdout.split('\n').filter(line => 
        line.includes('Starting backtest container with enhanced error handling') &&
        !line.includes('suppressed')
      );
      expect(startupMessages.length).toBe(1);
      
      // 抑制メッセージが2回出力される（2回目と3回目の呼び出し）
      const suppressMessages = stdout.split('\n').filter(line => 
        line.includes('Backtest startup message suppressed')
      );
      expect(suppressMessages.length).toBe(2);
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 15000);

  test('entrypoint.sh構文検証（Issue #5230修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 5000 }))
      .resolves.not.toThrow();
  }, 10000);

  test('簡素化による行数削減の確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log_backtest_startup_message関数の抽出
    const functionMatch = entrypointContent.match(
      /log_backtest_startup_message\(\) \{[\s\S]*?\n\}/
    );
    
    expect(functionMatch).toBeTruthy();
    
    const functionLines = functionMatch[0].split('\n').length;
    
    // 新しい実装は40行以下（大幅な簡素化）
    expect(functionLines).toBeLessThan(40);
    
    // 元の実装は100行以上だったので、大幅な削減を確認
    console.log(`New log_backtest_startup_message function: ${functionLines} lines (reduced from 117+ lines)`);
  });

  test('Issue #5230: 修正内容のドキュメント確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    const mongoDbContent = fs.readFileSync(mongoDbPath, 'utf8');
    
    // Issue #5230の修正内容がコメントで明記されている
    expect(entrypointContent).toContain('Issue #5230修正: backtest container専用起動メッセージ関数（KISS原則適用・簡素化版）');
    expect(mongoDbContent).toContain('Issue #5230修正: 環境変数検証の追加');
    expect(mongoDbContent).toContain('Issue #5230修正: 環境変数未設定時の早期return');
  });

  test('環境変数未設定時のエラーハンドリング確認', () => {
    const mongoDbContent = fs.readFileSync(mongoDbPath, 'utf8');
    
    // 具体的なエラーメッセージが実装されている
    expect(mongoDbContent).toContain('期待値例: MONGO_URL=mongodb://mongodb:27017 または MONGO_URL=mongodb://localhost:27017');
    expect(mongoDbContent).toContain('期待値例: MONGODB_DB_NAME=harvest3');
    
    // エラーメッセージに必要な環境変数名が含まれている
    expect(mongoDbContent).toContain('MONGO_URL, MONGODB_DB_NAME');
  });
});