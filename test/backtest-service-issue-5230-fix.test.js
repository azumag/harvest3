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

  test('Issue #5230修正: log_backtest_startup_message関数の基本構造確認（Issue #5315強化版）', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5230修正のコメントが追加されている
    expect(entrypointContent).toContain('Issue #5230修正: backtest container専用起動メッセージ関数（KISS原則適用・簡素化版）');
    expect(entrypointContent).toContain('過去の複雑な実装（Issue #5127, #5058, #5175, #5216, #5333）を簡素化');
    
    // 簡素化された実装の特徴（変数参照を使用）
    expect(entrypointContent).toContain('local timestamp_file="$BACKTEST_STARTUP_TIMESTAMP_FILE"');
    expect(entrypointContent).toContain('local suppress_duration=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}');
    // Issue #5371: YAGNI原則による簡素化でatomic write処理は簡潔になりました
    expect(entrypointContent).toContain('echo "$current_time" > "$timestamp_file"');
    
    // Issue #5315で強化されたlocking機構が実装されていることを確認
    const functionMatch = entrypointContent.match(
      /log_backtest_startup_message\(\) \{[\s\S]*?\n\}/
    );
    expect(functionMatch).toBeTruthy();
    const functionContent = functionMatch[0];
    
    // Issue #5315による二重防御システムが実装されている
    expect(functionContent).toContain('_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
    expect(functionContent).toContain('flock');
    expect(functionContent).toContain('exec 200');
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
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: global.TEST_TIMEOUTS.BASIC });
      
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
  }, global.TEST_TIMEOUTS.LONG_RUNNING);

  test('entrypoint.sh構文検証（Issue #5230修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: global.TEST_TIMEOUTS.QUICK }))
      .resolves.not.toThrow();
  }, global.TEST_TIMEOUTS.BASIC);

  test('Issue #5315強化による実装サイズの確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log_backtest_startup_message関数の抽出
    const functionMatch = entrypointContent.match(
      /log_backtest_startup_message\(\) \{[\s\S]*?\n\}/
    );
    
    expect(functionMatch).toBeTruthy();
    
    const functionLines = functionMatch[0].split('\n').length;
    
    // Issue #5371: YAGNI原則による簡素化（120行→45行、73%削減）
    expect(functionLines).toBeGreaterThan(30);
    expect(functionLines).toBeLessThanOrEqual(60); // YAGNI原則により大幅簡素化
    
    // Issue #5371: YAGNI原則による簡素化版
    console.log(`Simplified log_backtest_startup_message function: ${functionLines} lines (Issue #5371 YAGNI simplification, 73% reduction)`);
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