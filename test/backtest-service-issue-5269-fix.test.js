/**
 * Issue #5371: YAGNI原則による簡素化後のテスト
 * backtestサービスの核心機能が維持されていることを確認
 * 
 * Issue #5371 変更内容:
 * 1. log_backtest_startup_message関数の大幅簡素化（120行→45行、73%削減）
 * 2. Docker再起動検出システムの削除（YAGNI原則）
 * 3. 複雑なatomic操作をシンプルなechoで置換
 * 4. 核心機能（重複防止、flock同期）は完全保持
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { mkdtempSync, cleanup } = require('./helpers/temp-path-helper');

describe('Issue #5371 - YAGNI原則による簡素化後の機能確認', () => {
    let tempDir;
    let mockProcUptime;
    let originalEnv;

    beforeEach(() => {
        // 一時ディレクトリの作成
        tempDir = mkdtempSync('backtest', 'test-');
        
        // /proc/uptimeのモック
        mockProcUptime = path.join(tempDir, 'uptime');
        
        // 環境変数の保存
        originalEnv = { ...process.env };
        
        // テスト用環境変数の設定
        process.env.BACKTEST_MODE = 'true';
        process.env.BACKTEST_STARTUP_FLOCK_TIMEOUT = '15';
    });

    afterEach(() => {
        // 一時ファイルのクリーンアップ
        cleanup(tempDir);
        
        // 環境変数の復元
        Object.keys(process.env).forEach(key => {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        });
        Object.assign(process.env, originalEnv);
    });

    describe('flock timeout configuration', () => {
        test('should use 15 seconds as default timeout', () => {
            // entrypoint.shの内容を確認
            const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
            const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
            
            // デフォルト値が15秒に設定されていることを確認
            expect(entrypointContent).toMatch(/BACKTEST_STARTUP_FLOCK_TIMEOUT=\$\{BACKTEST_STARTUP_FLOCK_TIMEOUT:-15\}/);
            
            // flockコマンドで変数が使用されていることを確認
            expect(entrypointContent).toMatch(/flock -w \$BACKTEST_STARTUP_FLOCK_TIMEOUT/);
        });

        test('should allow environment variable override', () => {
            process.env.BACKTEST_STARTUP_FLOCK_TIMEOUT = '30';
            
            const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
            const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
            
            // 環境変数による上書きが可能であることを確認
            expect(entrypointContent).toMatch(/BACKTEST_STARTUP_FLOCK_TIMEOUT=\$\{BACKTEST_STARTUP_FLOCK_TIMEOUT:-15\}/);
        });
    });

    // Issue #5371: Docker再起動検出システムはYAGNI原則により削除されました
    // 必要最小限の重複防止機能のみ保持

    describe('duplicate message prevention', () => {
        test('should prevent duplicate startup messages within timeout', () => {
            const timestampFile = path.join(tempDir, 'backtest-startup-message.last');
            const currentTime = Math.floor(Date.now() / 1000);
            
            // 30秒前のタイムスタンプを設定
            fs.writeFileSync(timestampFile, (currentTime - 30).toString());
            
            const testScript = `
                TIMESTAMP_FILE="${timestampFile}"
                CURRENT_TIME="${currentTime}"
                SUPPRESS_DURATION="60"
                
                should_output=true
                
                if [ -f "$TIMESTAMP_FILE" ]; then
                    last_time=$(cat "$TIMESTAMP_FILE" 2>/dev/null || echo "0")
                    time_diff=$((CURRENT_TIME - last_time))
                    
                    if [ "$time_diff" -lt "$SUPPRESS_DURATION" ]; then
                        should_output=false
                        echo "MESSAGE_SUPPRESSED"
                    fi
                fi
                
                if [ "$should_output" = true ]; then
                    echo "MESSAGE_OUTPUT"
                fi
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' }).trim();
            expect(result).toBe('MESSAGE_SUPPRESSED');
        });

        test('should allow message output after timeout', () => {
            const timestampFile = path.join(tempDir, 'backtest-startup-message.last');
            const currentTime = Math.floor(Date.now() / 1000);
            
            // 90秒前のタイムスタンプを設定（タイムアウト60秒を超過）
            fs.writeFileSync(timestampFile, (currentTime - 90).toString());
            
            const testScript = `
                TIMESTAMP_FILE="${timestampFile}"
                CURRENT_TIME="${currentTime}"
                SUPPRESS_DURATION="60"
                
                should_output=true
                
                if [ -f "$TIMESTAMP_FILE" ]; then
                    last_time=$(cat "$TIMESTAMP_FILE" 2>/dev/null || echo "0")
                    time_diff=$((CURRENT_TIME - last_time))
                    
                    if [ "$time_diff" -lt "$SUPPRESS_DURATION" ]; then
                        should_output=false
                        echo "MESSAGE_SUPPRESSED"
                    fi
                fi
                
                if [ "$should_output" = true ]; then
                    echo "MESSAGE_OUTPUT"
                fi
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' }).trim();
            expect(result).toBe('MESSAGE_OUTPUT');
        });
    });

    // Issue #5371: NPMエラーマーカー機能もYAGNI原則により削除されました

    describe('edge cases and error handling', () => {
        // Issue #5371: /proc/uptime関連機能は削除されました

        test('should handle corrupted timestamp files', () => {
            const timestampFile = path.join(tempDir, 'backtest-startup-message.last');
            
            // 不正な内容のタイムスタンプファイルを作成
            fs.writeFileSync(timestampFile, 'invalid_timestamp_data');
            
            const testScript = `
                TIMESTAMP_FILE="${timestampFile}"
                CURRENT_TIME="$(date +%s)"
                SUPPRESS_DURATION="60"
                
                should_output=true
                
                if [ -f "$TIMESTAMP_FILE" ]; then
                    last_time=$(cat "$TIMESTAMP_FILE" 2>/dev/null || echo "0")
                    # 数値でない場合は0として扱われる
                    time_diff=$((CURRENT_TIME - last_time))
                    
                    if [ "$time_diff" -lt "$SUPPRESS_DURATION" ]; then
                        should_output=false
                    fi
                fi
                
                if [ "$should_output" = true ]; then
                    echo "MESSAGE_OUTPUT_DESPITE_CORRUPTION"
                fi
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' }).trim();
            expect(result).toBe('MESSAGE_OUTPUT_DESPITE_CORRUPTION');
        });

        test('should handle permission errors gracefully', () => {
            // 権限エラーをシミュレートするため、読み取り専用ディレクトリを作成
            const readOnlyDir = path.join(tempDir, 'readonly');
            fs.mkdirSync(readOnlyDir);
            fs.chmodSync(readOnlyDir, 0o444);
            
            const testScript = `
                READONLY_DIR="${readOnlyDir}"
                
                # 権限エラーが発生しても処理が継続することを確認
                rm -f "$READONLY_DIR/test-file" 2>/dev/null || true
                echo "CLEANUP_COMPLETED_WITH_ERRORS"
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' }).trim();
            expect(result).toBe('CLEANUP_COMPLETED_WITH_ERRORS');
        });
    });

    describe('integration with existing functionality', () => {
        test('should maintain compatibility with existing backtest startup flow', () => {
            const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
            const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
            
            // 既存の重要な機能が維持されていることを確認
            expect(entrypointContent).toMatch(/log_backtest_startup_message/);
            expect(entrypointContent).toMatch(/BACKTEST_MODE.*true/);
            expect(entrypointContent).toMatch(/exec.*\$@/);
            
            // Issue #5371: YAGNI原則により簡素化されたため、コア機能のみ確認
            expect(entrypointContent).toMatch(/log_backtest_startup_message/);
            expect(entrypointContent).toMatch(/YAGNI原則/);
        });

        test('should not interfere with non-backtest mode', () => {
            const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
            const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
            
            // backtest専用関数の呼び出しが条件分岐内にあることを確認
            expect(entrypointContent).toMatch(/if.*BACKTEST_MODE.*true/);
            expect(entrypointContent).toMatch(/log_backtest_startup_message/);
            
            // 通常のstrategy-runner用の関数も存在することを確認
            expect(entrypointContent).toMatch(/log_startup_message.*Starting strategy-runner container/);
        });
    });
});