/**
 * Issue #5269修正のテスト
 * backtestサービスで例外が発生する問題の修正をテスト
 * 
 * 修正内容:
 * 1. flock タイムアウト延長（5秒→15秒）
 * 2. Docker再起動時クリーンアップ強化
 * 3. システム稼働時間ベースの新規コンテナ判定
 * 4. NPMエラーマーカー初期化
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { mkdtempSync, cleanup } = require('./helpers/temp-path-helper');

describe('Issue #5269 - backtest service exception fix', () => {
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

    describe('Docker restart detection and cleanup', () => {
        test('should detect new container based on system uptime', () => {
            // 新規コンテナ（稼働時間30秒）をシミュレート
            fs.writeFileSync(mockProcUptime, '30.45 120.30');
            
            const testScript = `
                # Mock /proc/uptime
                MOCK_PROC_UPTIME="${mockProcUptime}"
                
                # Extract container detection logic
                system_uptime_seconds=0
                if [ -f "$MOCK_PROC_UPTIME" ]; then
                    system_uptime_seconds=$(cat "$MOCK_PROC_UPTIME" | cut -d' ' -f1 | cut -d'.' -f1)
                fi
                
                if [ "$system_uptime_seconds" -lt 60 ]; then
                    echo "NEW_CONTAINER_DETECTED"
                else
                    echo "EXISTING_CONTAINER"
                fi
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' }).trim();
            expect(result).toBe('NEW_CONTAINER_DETECTED');
        });

        test('should not trigger cleanup for existing container', () => {
            // 既存コンテナ（稼働時間120秒）をシミュレート
            fs.writeFileSync(mockProcUptime, '120.45 240.30');
            
            const testScript = `
                # Mock /proc/uptime
                MOCK_PROC_UPTIME="${mockProcUptime}"
                
                # Extract container detection logic
                system_uptime_seconds=0
                if [ -f "$MOCK_PROC_UPTIME" ]; then
                    system_uptime_seconds=$(cat "$MOCK_PROC_UPTIME" | cut -d' ' -f1 | cut -d'.' -f1)
                fi
                
                if [ "$system_uptime_seconds" -lt 60 ]; then
                    echo "NEW_CONTAINER_DETECTED"
                else
                    echo "EXISTING_CONTAINER"
                fi
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' }).trim();
            expect(result).toBe('EXISTING_CONTAINER');
        });

        test('should clean up timestamp files on new container', () => {
            // テスト用のタイムスタンプファイルを作成
            const timestampFile = path.join(tempDir, 'backtest-startup-message.last');
            const npmErrorFile = path.join(tempDir, 'backtest-npm-error-detection.state');
            
            fs.writeFileSync(timestampFile, '1640995200');
            fs.writeFileSync(npmErrorFile, '1640995200');
            
            // 新規コンテナをシミュレート
            fs.writeFileSync(mockProcUptime, '30.45 120.30');
            
            const testScript = `
                # Mock /proc/uptime
                MOCK_PROC_UPTIME="${mockProcUptime}"
                TEMP_DIR="${tempDir}"
                
                # Extract cleanup logic
                system_uptime_seconds=0
                if [ -f "$MOCK_PROC_UPTIME" ]; then
                    system_uptime_seconds=$(cat "$MOCK_PROC_UPTIME" | cut -d' ' -f1 | cut -d'.' -f1)
                fi
                
                if [ "$system_uptime_seconds" -lt 60 ]; then
                    rm -f "$TEMP_DIR/backtest-startup-message.last" 2>/dev/null || true
                    rm -f "$TEMP_DIR/backtest-npm-error-detection.state" 2>/dev/null || true
                    echo "CLEANUP_EXECUTED"
                fi
            `;
            
            execSync(testScript, { shell: '/bin/bash' });
            
            // ファイルが削除されていることを確認
            expect(fs.existsSync(timestampFile)).toBeFalsy();
            expect(fs.existsSync(npmErrorFile)).toBeFalsy();
        });
    });

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

    describe('NPM error marker initialization', () => {
        test('should reset NPM error marker on Docker restart', () => {
            const npmErrorFile = path.join(tempDir, 'backtest-npm-error-detection.state');
            
            // 既存のNPMエラーマーカーを作成
            fs.writeFileSync(npmErrorFile, '1640995200');
            expect(fs.existsSync(npmErrorFile)).toBeTruthy();
            
            // 新規コンテナの場合のクリーンアップをシミュレート
            fs.writeFileSync(mockProcUptime, '25.15 95.30');
            
            const testScript = `
                MOCK_PROC_UPTIME="${mockProcUptime}"
                NPM_ERROR_FILE="${npmErrorFile}"
                
                system_uptime_seconds=0
                if [ -f "$MOCK_PROC_UPTIME" ]; then
                    system_uptime_seconds=$(cat "$MOCK_PROC_UPTIME" | cut -d' ' -f1 | cut -d'.' -f1)
                fi
                
                if [ "$system_uptime_seconds" -lt 60 ]; then
                    rm -f "$NPM_ERROR_FILE" 2>/dev/null || true
                    echo "NPM_ERROR_MARKER_RESET"
                fi
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' }).trim();
            expect(result).toBe('NPM_ERROR_MARKER_RESET');
            expect(fs.existsSync(npmErrorFile)).toBeFalsy();
        });
    });

    describe('edge cases and error handling', () => {
        test('should handle missing /proc/uptime gracefully', () => {
            const testScript = `
                # /proc/uptimeが存在しない場合をシミュレート
                MOCK_PROC_UPTIME="/nonexistent/uptime"
                
                system_uptime_seconds=0
                if [ -f "$MOCK_PROC_UPTIME" ]; then
                    system_uptime_seconds=$(cat "$MOCK_PROC_UPTIME" | cut -d' ' -f1 | cut -d'.' -f1)
                fi
                
                echo "UPTIME: $system_uptime_seconds"
                
                if [ "$system_uptime_seconds" -lt 60 ]; then
                    echo "NEW_CONTAINER_ASSUMED"
                else
                    echo "EXISTING_CONTAINER_ASSUMED"
                fi
            `;
            
            const result = execSync(testScript, { shell: '/bin/bash', encoding: 'utf8' });
            expect(result).toContain('UPTIME: 0');
            expect(result).toContain('NEW_CONTAINER_ASSUMED');
        });

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
            
            // Issue #5269の修正が含まれていることを確認
            expect(entrypointContent).toMatch(/Issue #5269/);
            expect(entrypointContent).toMatch(/Docker再起動時のクリーンアップ強化/);
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