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

    test('entrypoint.sh should contain Issue #5372 improvements', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check for Issue #5372 improvements in the existing function
        expect(entrypointContent).toContain('# Issue #5372改善: より予測可能なフロー');
        expect(entrypointContent).toContain('# Issue #5372改善: 統一エラーハンドリング');
        expect(entrypointContent).toContain('# Issue #5372改善: 設定可能なファイルディスクリプタ');
        expect(entrypointContent).toContain('# Issue #5372改善: より予測可能なクリーンアップフロー');
        
        // Check for configuration externalization
        expect(entrypointContent).toContain('BACKTEST_FD_BASE=${BACKTEST_FD_BASE:-200}');
        expect(entrypointContent).toContain('BACKTEST_STARTUP_TIMESTAMP_FILE');
        
        // Check for step-by-step flow comments
        expect(entrypointContent).toContain('Step 1');
        expect(entrypointContent).toContain('Step 2');
        expect(entrypointContent).toContain('Step 3');
        expect(entrypointContent).toContain('Step 4');
        
        // Check that original Issue #5315 functionality is maintained
        expect(entrypointContent).toContain('# Issue #5315修正: backtest container専用起動メッセージ関数（強化版重複防止）');
    });

    test('improved log_backtest_startup_message should work with Issue #5372 enhancements', async () => {
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=5
export BACKTEST_STARTUP_FLOCK_TIMEOUT=5

# Clean up test files
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true

# Source the improved log_backtest_startup_message function
source <(sed -n '/^log_backtest_startup_message()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)
source <(sed -n '/^set_secure_permissions()/,/^}/p' entrypoint.sh)

# Test the improved function
log_backtest_startup_message "Starting backtest container with Issue #5372 improvements"

# Check that timestamp file was created
if [ -f "/tmp/backtest-startup-message.last" ]; then
    echo "IMPROVEMENT_TEST_PASSED: Timestamp file created"
else
    echo "IMPROVEMENT_TEST_FAILED: Timestamp file not created"
fi

# Clean up
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true
`;

        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5372-improvements.sh');
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
            
            // Should indicate improvement test passed
            expect(output).toContain('IMPROVEMENT_TEST_PASSED');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('improved cleanup should have Issue #5372 enhancements', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check that cleanup functions have Issue #5372 improvements
        expect(entrypointContent).toContain('# Issue #5372改善: より予測可能なクリーンアップフロー');
        expect(entrypointContent).toContain('# Issue #5372改善: 統一されたファイルパス使用');
        
        // Check that cleanup_backtest_lock function is improved 
        expect(entrypointContent).toContain('cleanup_backtest_lock()');
        expect(entrypointContent).toContain('# Issue #5372: 従来のcleanup_backtest_lock関数（後方互換性維持・簡素化）');
    });

    test('configuration externalization should be properly implemented', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check that configuration is externalized and unified
        expect(entrypointContent).toContain('BACKTEST_FD_BASE=${BACKTEST_FD_BASE:-200}');
        expect(entrypointContent).toContain('# Issue #5372修正: 設定の外部化と一元管理');
        expect(entrypointContent).toContain('# Issue #5372: 統一されたタイムスタンプファイル名');
        
        // Check that backward compatibility is maintained while allowing future externalization
        expect(entrypointContent).toContain('BACKTEST_STARTUP_TIMESTAMP_FILE="/tmp/backtest-startup-message.last"');
        expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_FILE="/tmp/backtest-startup-message.lock"');
        
        // Check that the function uses the current hardcoded approach for compatibility
        expect(entrypointContent).toContain('local timestamp_file="/tmp/backtest-startup-message.last"');
        expect(entrypointContent).toContain('local lock_file="/tmp/backtest-startup-message.lock"');
    });

});