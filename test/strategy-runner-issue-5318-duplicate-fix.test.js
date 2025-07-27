/**
 * Issue #5318修正テスト: strategy-runnerサービス重複メッセージ防止
 * 
 * 修正内容:
 * - グローバルフラグによる追加防御層を実装
 * - main関数内での起動メッセージ呼び出し時の重複防止を強化
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

describe('Issue #5318: strategy-runnerサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5318修正: グローバルフラグによる重複防止が実装されていることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5318のコメントが追加されていることを確認
    expect(entrypointContent).toMatch(/Issue #5318修正.*グローバルフラグ/);
    
    // グローバルフラグチェックが実装されていることを確認
    expect(entrypointContent).toContain('_GLOBAL_STARTUP_MESSAGE_SENT');
    expect(entrypointContent).toContain('Global flag prevented duplicate startup message');
    
    // 元の log_startup_message 呼び出しが適切に保護されていることを確認
    expect(entrypointContent).toMatch(/if.*_GLOBAL_STARTUP_MESSAGE_SENT.*!= "1"/);
  });

  test('Issue #5318修正: グローバルフラグによる重複防止が正しく動作することを確認', async () => {
    const testScript = `#!/bin/bash
# テスト用のlog関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# グローバルフラグをリセット
unset _GLOBAL_STARTUP_MESSAGE_SENT

# 修正されたロジック（entrypoint.shから抽出）
test_startup_logic() {
    # Issue #5318修正: 起動メッセージの確実な重複防止（グローバルフラグによる追加防御）
    if [ "$_GLOBAL_STARTUP_MESSAGE_SENT" != "1" ]; then
        export _GLOBAL_STARTUP_MESSAGE_SENT=1
        # 起動ロック取得後に安全にメッセージを出力
        log "Starting strategy-runner container with enhanced error handling (container: test-container, pid: $$)"
    else
        log "DEBUG: Global flag prevented duplicate startup message"
    fi
}

# 複数回呼び出してテスト
test_startup_logic
test_startup_logic
test_startup_logic
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5318-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
      
      // "Starting strategy-runner container" メッセージが1回のみ出力されることを確認
      const startupMessages = stdout.split('\n').filter(line => 
        line.includes('Starting strategy-runner container with enhanced error handling')
      );
      expect(startupMessages.length).toBe(1);
      
      // DEBUG メッセージが2回出力されることを確認（2回目と3回目の呼び出し）
      const debugMessages = stdout.split('\n').filter(line => 
        line.includes('DEBUG: Global flag prevented duplicate startup message')
      );
      expect(debugMessages.length).toBe(2);
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 5000);

  test('Issue #5318修正: 既存の重複防止機構との互換性確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 既存のlog_startup_message関数が維持されていることを確認
    expect(entrypointContent).toContain('log_startup_message()');
    
    // 既存の重複防止メカニズムが維持されていることを確認
    expect(entrypointContent).toMatch(/_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS/);
    expect(entrypointContent).toMatch(/MAIN_STARTUP_MESSAGE_LOGGED/);
    expect(entrypointContent).toMatch(/main-startup-message\.done/);
    expect(entrypointContent).toMatch(/main-startup-message\.lock/);
    
    // 新しいグローバルフラグが追加層として機能することを確認
    const logStartupMessageMatch = entrypointContent.match(
      /if.*_GLOBAL_STARTUP_MESSAGE_SENT.*[\s\S]*?log_startup_message.*[\s\S]*?fi/
    );
    expect(logStartupMessageMatch).toBeTruthy();
  });

  test('Issue #5318修正: entrypoint.sh構文検証', async () => {
    try {
      await execAsync(`bash -n ${entrypointPath}`, { timeout: 5000 });
    } catch (error) {
      throw new Error(`entrypoint.sh has syntax errors: ${error.message}`);
    }
  }, 10000);

  describe('Issue #5318修正: 統合テスト', () => {
    test('グローバルフラグと既存機構の協調動作確認', async () => {
      const testScript = `#!/bin/bash
# 最小限のlog_startup_message関数（重複防止付き）
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

log_startup_message() {
    local message="$1"
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # プロセス内変数による即座の重複防止
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                echo "DEBUG: Process flag prevented duplicate"
                return 0
            fi
            _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
            export MAIN_STARTUP_MESSAGE_LOGGED=1
            log "$message"
            ;;
    esac
}

# グローバルフラグをリセット
unset _GLOBAL_STARTUP_MESSAGE_SENT

# 修正されたメインロジック
main_startup_logic() {
    # Issue #5318修正: 起動メッセージの確実な重複防止（グローバルフラグによる追加防御）
    if [ "$_GLOBAL_STARTUP_MESSAGE_SENT" != "1" ]; then
        export _GLOBAL_STARTUP_MESSAGE_SENT=1
        # 起動ロック取得後に安全にメッセージを出力
        log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: $$)"
    else
        log "DEBUG: Global flag prevented duplicate startup message"
    fi
}

# 複数回呼び出してテスト（グローバルフラグが最外層で防御）
main_startup_logic
main_startup_logic
`;

      const testScriptPath = path.join(tmpDir, `test-issue-5318-integration-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
        
        // 起動メッセージが1回のみ出力されることを確認
        const startupMessages = stdout.split('\n').filter(line => 
          line.includes('Starting strategy-runner container with enhanced error handling')
        );
        expect(startupMessages.length).toBe(1);
        
        // グローバルフラグによる防御が2回目に働くことを確認
        const globalFlagMessages = stdout.split('\n').filter(line => 
          line.includes('DEBUG: Global flag prevented duplicate startup message')
        );
        expect(globalFlagMessages.length).toBe(1);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);
  });
});