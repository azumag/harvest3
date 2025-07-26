/**
 * Test for Issue #5372: KISS原則 - 二重防御システムのデバッグ性改善
 * https://github.com/azumag/harvest3/issues/5372
 * 
 * Issue Description:
 * - 二重防御システム（プロセスフラグ + flock）のデバッグ性改善
 * - より線形で予測可能なフローへのリファクタリング
 * - 責任別の小さな関数への分割
 * - エラーハンドリングの統一
 * - 設定の外部化
 * 
 * Refactoring Implementation:
 * - Added responsibility-separated helper functions
 * - Unified error handling with log_backtest_error()
 * - Externalized configuration with environment variables
 * - Dynamic file descriptor allocation
 * - Unified resource cleanup functions
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Issue #5372: KISS Principle - Dual Defense System Debuggability Improvement', () => {
    const testTimeout = 30000; // 30 seconds timeout
    
    // Helper function to clean up test files
    const cleanupTestFiles = () => {
        const testFiles = [
            '/tmp/backtest-startup-message.lock',
            '/tmp/backtest-startup-message.last',
            '/tmp/test-backtest-startup-timestamp.state',
            '/tmp/backtest-start-time.marker',
            '/tmp/main-startup-message.done',
            '/tmp/main-startup-message.lock'
        ];
        
        testFiles.forEach(file => {
            try {
                if (fs.existsSync(file)) {
                    if (fs.statSync(file).isDirectory()) {
                        fs.rmSync(file, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(file);
                    }
                }
            } catch (error) {
                // Ignore cleanup errors
            }
        });
    };

    beforeEach(() => {
        cleanupTestFiles();
    });

    afterEach(() => {
        cleanupTestFiles();
    });

    test('entrypoint.sh should contain Issue #5372 refactored helper functions', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check for Issue #5372 refactored helper functions
        expect(entrypointContent).toContain('# Issue #5372: KISS原則 - 二重防御システムのデバッグ性改善');
        expect(entrypointContent).toContain('log_backtest_error()');
        expect(entrypointContent).toContain('check_process_flag()');
        expect(entrypointContent).toContain('get_available_fd()');
        expect(entrypointContent).toContain('acquire_file_lock()');
        expect(entrypointContent).toContain('check_timestamp_duplicate()');
        expect(entrypointContent).toContain('execute_message_output()');
        expect(entrypointContent).toContain('release_backtest_resources()');
        
        // Check for unified configuration
        expect(entrypointContent).toContain('BACKTEST_FD_BASE=${BACKTEST_FD_BASE:-200}');
        expect(entrypointContent).toContain('BACKTEST_STARTUP_TIMESTAMP_FILE');
        
        // Check for linear flow comments
        expect(entrypointContent).toContain('Step 1 - プロセスフラグチェック');
        expect(entrypointContent).toContain('Step 2 - ファイルベース同期化');
        expect(entrypointContent).toContain('Step 3 - 保護された操作の実行');
        expect(entrypointContent).toContain('Step 4 - クリーンアップ');
    });

    test('check_process_flag function should work correctly', async () => {
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=5
export BACKTEST_STARTUP_FLOCK_TIMEOUT=5

# Source the refactored helper functions
source <(sed -n '/^check_process_flag()/,/^}/p' entrypoint.sh)

# Test 1: Flag not set - should return 1
echo "TEST1_START"
if check_process_flag; then
    echo "TEST1_RESULT:PASS_UNEXPECTED"
else
    echo "TEST1_RESULT:PASS_EXPECTED"
fi

# Test 2: Set flag and test again - should return 0
export _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
echo "TEST2_START"
if check_process_flag; then
    echo "TEST2_RESULT:PASS_EXPECTED"
else
    echo "TEST2_RESULT:PASS_UNEXPECTED"
fi
`;

        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5372-process-flag.sh');
        const tmpDir = path.dirname(testScriptPath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const output = execSync(`cd ${path.dirname(testScriptPath)}/../ && bash ${testScriptPath}`, {
                encoding: 'utf8',
                timeout: 10000,
                cwd: path.join(__dirname, '..')
            });
            
            // Check test results
            expect(output).toContain('TEST1_RESULT:PASS_EXPECTED');
            expect(output).toContain('TEST2_RESULT:PASS_EXPECTED');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('log_backtest_error function should provide unified error handling', async () => {
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true

# Source the refactored helper functions
source <(sed -n '/^log_backtest_error()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)

# Test unified error logging
log_backtest_error "Test error message" "TEST_CONTEXT"
log_backtest_error "Test error without context"
`;

        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5372-error-handling.sh');
        const tmpDir = path.dirname(testScriptPath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const output = execSync(`cd ${path.dirname(testScriptPath)}/../ && bash ${testScriptPath}`, {
                encoding: 'utf8',
                timeout: 10000,
                cwd: path.join(__dirname, '..')
            });
            
            // Check for unified error format
            expect(output).toContain('[BACKTEST_ERROR:TEST_CONTEXT] Test error message');
            expect(output).toContain('[BACKTEST_ERROR:GENERAL] Test error without context');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('refactored log_backtest_startup_message should use new linear flow', async () => {
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=5
export BACKTEST_STARTUP_FLOCK_TIMEOUT=5
export BACKTEST_FD_BASE=250  # Use different FD to avoid conflicts

# Clean up test files
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true

# Source the enhanced log_backtest_startup_message function and helpers
source <(sed -n '/^log_backtest_startup_message()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log_backtest_error()/,/^}/p' entrypoint.sh)
source <(sed -n '/^check_process_flag()/,/^}/p' entrypoint.sh)
source <(sed -n '/^get_available_fd()/,/^}/p' entrypoint.sh)
source <(sed -n '/^acquire_file_lock()/,/^}/p' entrypoint.sh)
source <(sed -n '/^check_timestamp_duplicate()/,/^}/p' entrypoint.sh)
source <(sed -n '/^execute_message_output()/,/^}/p' entrypoint.sh)
source <(sed -n '/^release_backtest_resources()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)
source <(sed -n '/^set_secure_permissions()/,/^}/p' entrypoint.sh)

# Test the refactored function
log_backtest_startup_message "Starting backtest container with Issue #5372 improvements"

# Check that timestamp file was created
if [ -f "/tmp/backtest-startup-message.last" ]; then
    echo "REFACTOR_TEST_PASSED: Timestamp file created"
else
    echo "REFACTOR_TEST_FAILED: Timestamp file not created"
fi

# Clean up
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true
`;

        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5372-refactor.sh');
        const tmpDir = path.dirname(testScriptPath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const output = execSync(`cd ${path.dirname(testScriptPath)}/../ && bash ${testScriptPath}`, {
                encoding: 'utf8',
                timeout: 10000,
                cwd: path.join(__dirname, '..')
            });
            
            // Should contain the startup message
            expect(output).toContain('Starting backtest container with Issue #5372 improvements');
            
            // Should indicate refactor test passed
            expect(output).toContain('REFACTOR_TEST_PASSED');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('unified cleanup should handle both old and new resource cleanup patterns', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check that cleanup functions use the new unified approach
        expect(entrypointContent).toContain('release_backtest_resources');
        expect(entrypointContent).toContain('# Issue #5372: 統一されたリソースクリーンアップ関数を使用');
        expect(entrypointContent).toContain('# Issue #5372: 統一されたファイルパスを使用したクリーンアップ');
        
        // Check that old cleanup_backtest_lock function now uses new unified function
        expect(entrypointContent).toContain('# Issue #5372: 新しい統一クリーンアップ関数を使用');
    });

    test('configuration externalization should be properly implemented', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check that configuration is externalized and unified
        expect(entrypointContent).toContain('BACKTEST_FD_BASE=${BACKTEST_FD_BASE:-200}');
        expect(entrypointContent).toContain('# Issue #5372修正: 設定の外部化と一元管理');
        expect(entrypointContent).toContain('# Issue #5372: 統一されたタイムスタンプファイル名');
        
        // Check that the main function uses externalized configuration
        expect(entrypointContent).toContain('local timestamp_file="$BACKTEST_STARTUP_TIMESTAMP_FILE"');
        expect(entrypointContent).toContain('local lock_file="$BACKTEST_STARTUP_LOCK_FILE"');
        expect(entrypointContent).toContain('local suppress_duration="$BACKTEST_STARTUP_LOCK_TIMEOUT"');
    });

});