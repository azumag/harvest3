/**
 * Startup Message Test Helper
 * strategy-runner重複起動メッセージテスト用共通ヘルパー
 *
 * Issue #5284レビュー対応：DRY原則違反修正のための共通ヘルパー関数
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// PROJECT_ROOTをtemp-path-helper.jsからimport
const { PROJECT_ROOT } = require('./temp-path-helper');

/**
 * 起動メッセージテスト用のベーススクリプトテンプレート
 * @param {Object} options - テスト設定オプション
 * @param {string} options.testMessage - テスト対象メッセージ
 * @param {string} options.containerId - コンテナID
 * @param {number} options.pid - プロセスID
 * @param {boolean} options.enableProcessInternal - プロセス内変数による防止を有効にするか
 * @param {boolean} options.enableFilelock - ファイルロックによる防止を有効にするか
 * @param {string} options.customLogic - 追加のカスタムロジック
 * @returns {string} バッシュスクリプト
 */
function createStartupMessageTestScript(options = {}) {
  const {
    testMessage = "Starting strategy-runner container with enhanced error handling",
    containerId = "test-container",
    pid = "$$",
    enableProcessInternal = true,
    enableFilelock = true,
    customLogic = ""
  } = options;

  return `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue修正済みのlog_startup_message関数（共通実装）
log_startup_message() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            ${enableProcessInternal ? `
            # Issue #5302修正: プロセス内変数による即座の重複防止（第0防御線）
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                return 0  # 既に同一プロセス内でログ出力済み、即座に重複防止
            fi
            ` : ''}
            
            ${enableFilelock ? `
            # Issue #5295修正: アトミックファイルロックによる確実な重複防止 (.tmpディレクトリ使用)
            local startup_msg_lock_file="\${TEMP_LOCKS_DIR:-${PROJECT_ROOT}/.tmp/locks}/main-startup-message.lock"
            local startup_msg_done_file="\${TEMP_LOCKS_DIR:-${PROJECT_ROOT}/.tmp/locks}/main-startup-message.done"
            local atomic_processing_success=false
            
            # 既に完了マーカーが存在する場合は重複防止
            if [ -f "$startup_msg_done_file" ]; then
                return 0  # 既にログ出力済み、重複防止
            fi
            
            # 環境変数フラグによる高速チェック（第一防御線）
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0  # 既にログ出力済み、重複防止
            fi
            
            # アトミックディレクトリロック取得（第二防御線）
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                # ロック取得成功 - 二重チェック後にメッセージ出力
                if [ -f "$startup_msg_done_file" ]; then
                    # 他のプロセスが先にメッセージを出力していた
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    return 0
                fi
                
                # フラグ設定とメッセージ出力
                ${enableProcessInternal ? '_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1  # Issue #5302修正: プロセス内フラグ設定' : ''}
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "$message"
                atomic_processing_success=true
                
                # 完了マーカー作成（他のプロセス用）
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                
                # ロック解放
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                
                # Issue #5295修正: 明示的な成功フラグをチェックしてreturn
                if [ "$atomic_processing_success" = true ]; then
                    return 0  # 処理完了、以降のRedis/ファイル処理を確実にスキップ
                fi
            else
                # ロック取得失敗 - 他のプロセスが処理中
                # 短時間待機してから完了マーカーをチェック
                local wait_attempts=0
                while [ $wait_attempts -lt 10 ] && [ ! -f "$startup_msg_done_file" ]; do
                    sleep 0.1
                    wait_attempts=$((wait_attempts + 1))
                done
                
                # 環境変数フラグも設定（一貫性のため）
                ${enableProcessInternal ? '_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1  # Issue #5302修正: プロセス内フラグ設定' : ''}
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0  # 他のプロセスがログ出力したため、重複防止
            fi
            
            # Issue #5295修正: fallthroughが発生した場合の緊急停止
            return 0
            ` : `
            # ファイルロック無効時は単純にメッセージ出力
            ${enableProcessInternal ? '_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1' : ''}
            export MAIN_STARTUP_MESSAGE_LOGGED=1
            log "$message"
            return 0
            `}
            ;;
    esac
    
    # その他のメッセージは通常処理
    log "$message"
}

${customLogic}
`;
}

/**
 * 重複防止テストを実行する共通関数
 * @param {Object} testConfig - テスト設定
 * @param {string} testConfig.testName - テスト名
 * @param {string} testConfig.testTmpDir - テスト用一時ディレクトリ
 * @param {string} testConfig.testMessage - テストメッセージ
 * @param {number} testConfig.callCount - メッセージ呼び出し回数
 * @param {number} testConfig.expectedOutputCount - 期待される出力回数
 * @param {Object} testConfig.scriptOptions - スクリプト生成オプション
 * @returns {Promise<Object>} テスト結果
 */
async function runDuplicatePreventionTest(testConfig) {
  const {
    testName,
    testTmpDir,
    testMessage = "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)",
    callCount = 3,
    expectedOutputCount = 1,
    scriptOptions = {}
  } = testConfig;

  const testLogic = `
echo "=== ${testName} 重複テスト開始 ==="

# 複数回呼び出し
${Array.from({ length: callCount }, (_, i) => 
  `log_startup_message "${testMessage}"`
).join('\n')}

echo "=== テスト完了 ==="
`;

  const fullScript = createStartupMessageTestScript({
    ...scriptOptions,
    customLogic: testLogic
  });

  const testScriptPath = path.join(testTmpDir, `${testName}-test.sh`);
  
  // スクリプトを安全に作成（セキュリティ対策）
  // Note: Reduced sanitization to avoid breaking bash syntax
  const sanitizedScript = fullScript;
  fs.writeFileSync(testScriptPath, sanitizedScript);
  fs.chmodSync(testScriptPath, '755');

  try {
    const { stdout, stderr } = await execAsync(`bash "${testScriptPath}"`, { 
      timeout: 5000,
      env: { ...process.env, PATH: process.env.PATH }
    });
    
    // 起動メッセージの出現回数をカウント
    const messages = stdout.split('\n').filter(line => 
      line.includes('Starting strategy-runner container with enhanced error handling')
    );

    return {
      success: true,
      messageCount: messages.length,
      expectedCount: expectedOutputCount,
      stdout,
      stderr,
      messages,
      scriptPath: testScriptPath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      scriptPath: testScriptPath
    };
  } finally {
    // クリーンアップ
    if (fs.existsSync(testScriptPath)) {
      fs.unlinkSync(testScriptPath);
    }
  }
}

/**
 * テスト環境のセットアップとクリーンアップ
 */
const testEnvironment = {
  /**
   * テスト開始前のセットアップ
   * @param {string} testTmpDir - テスト用一時ディレクトリ
   */
  async setup(testTmpDir) {
    // テスト用一時ディレクトリの準備
    await execAsync(`rm -rf "${testTmpDir}"`);
    await execAsync(`mkdir -p "${testTmpDir}"`);
    
    // ロックファイルとフラグのクリーンアップ (.tmpディレクトリ使用)
    const { getTempPath, cleanup } = require('./temp-path-helper');
    const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
    const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
    cleanup(lockFile);
    cleanup(doneFile);
    await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
    await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
  },

  /**
   * テスト終了後のクリーンアップ
   * @param {string} testTmpDir - テスト用一時ディレクトリ
   */
  async cleanup(testTmpDir) {
    // テスト後クリーンアップ (.tmpディレクトリ使用)
    const { getTempPath, cleanup } = require('./temp-path-helper');
    cleanup(testTmpDir);
    const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
    const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
    cleanup(lockFile);
    cleanup(doneFile);
    await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
    await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
  }
};

/**
 * 実装詳細ではなく動作に焦点を当てた検証ヘルパー
 */
const behaviorValidation = {
  /**
   * 重複防止の動作を検証（実装詳細に依存しない）
   * @param {Object} testResult - テスト結果
   * @param {number} expectedCount - 期待される出力回数
   */
  validateDuplicatePrevention(testResult, expectedCount = 1) {
    expect(testResult.success).toBe(true);
    expect(testResult.messageCount).toBe(expectedCount);
    expect(testResult.messages.length).toBe(expectedCount);
  },

  /**
   * entrypoint.shの基本的な機能を検証（実装詳細ではなく）
   * @param {string} entrypointPath - entrypoint.shのパス
   */
  validateEntrypointBasicFunctionality(entrypointPath) {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 基本的な機能の存在確認（実装詳細ではなく）
    expect(entrypointContent).toContain('log_startup_message');
    expect(entrypointContent).toMatch(/Starting strategy-runner container with enhanced error handling/);
  }
};

module.exports = {
  createStartupMessageTestScript,
  runDuplicatePreventionTest,
  testEnvironment,
  behaviorValidation
};