/**
 * Test for Issue #5403: [自動] backtestサービスで例外が発生
 * 
 * Issue Description:
 * - Backtest service showing duplicate startup messages
 * - log_duplicate_stats function not found error causing duplicate prevention to fail
 * 
 * Root Cause:
 * - log_duplicate_stats function calls without existence checking
 * - When function is not found, entire duplicate prevention logic fails
 * 
 * Fix Implementation:
 * - Added command -v check before log_duplicate_stats calls
 * - Ensured duplicate prevention continues even when log_duplicate_stats is unavailable
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Issue #5403: Backtest Service Duplicate Message Fix - Enhanced Error Handling', () => {
    const testTimeout = 15000;
    
    // Helper function to clean up test files
    const cleanupTestFiles = () => {
        const testFiles = [
            '/tmp/backtest-startup-message.lock',
            '/tmp/backtest-startup-message.last',
            '/tmp/test-backtest-startup-timestamp.state'
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

    test('entrypoint.sh should contain Issue #5403 fix for log_duplicate_stats error handling', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check for Issue #5403 fix comments
        expect(entrypointContent).toContain('# Issue #5403修正: log_duplicate_stats関数の存在チェック');
        
        // Check that all log_duplicate_stats calls now have existence checks
        const duplicateStatsPattern = /log_duplicate_stats\s*#\s*Issue #5338/g;
        const matches = entrypointContent.match(duplicateStatsPattern);
        expect(matches).toBeTruthy();
        expect(matches.length).toBeGreaterThan(0);
        
        // Check that existence checks are present
        const existenceChecks = entrypointContent.match(/if command -v log_duplicate_stats >/g);
        expect(existenceChecks).toBeTruthy();
        expect(existenceChecks.length).toBe(matches.length);
    });

    test('log_backtest_startup_message should work even when log_duplicate_stats is unavailable', async () => {
        // Create a test script that simulates log_duplicate_stats not being available
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=5
export BACKTEST_STARTUP_FLOCK_TIMEOUT=5

# Issue #5372: Set configuration variables
export BACKTEST_STARTUP_LOCK_FILE="/tmp/backtest-startup-message.lock"
export BACKTEST_STARTUP_TIMESTAMP_FILE="/tmp/backtest-startup-message.last"
export BACKTEST_FD_BASE=200
export CONTAINER_RESTART_DETECTION_THRESHOLD=300

# Clean up test files
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true

# Remove log_duplicate_stats function to simulate not available
unset -f log_duplicate_stats 2>/dev/null || true

# Source the enhanced log_backtest_startup_message function
source <(sed -n '/^log_backtest_startup_message()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)
source <(sed -n '/^update_timestamp_atomically()/,/^}/p' entrypoint.sh)
source <(sed -n '/^set_secure_permissions()/,/^}/p' entrypoint.sh)

# Test rapid consecutive calls (should only output once due to process flag)
# This should not fail even without log_duplicate_stats
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling" 
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# Clean up
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true
`;

        // Write test script to .tmp directory
        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5403-error-handling.sh');
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
            
            // Count occurrences of startup message
            const messageCount = (output.match(/Starting backtest container with enhanced error handling/g) || []).length;
            
            // Should only appear once due to process flag prevention
            expect(messageCount).toBe(1);
            
            // Should not contain any "command not found" errors for log_duplicate_stats
            expect(output).not.toContain('log_duplicate_stats: command not found');
            
            // Should not contain any bash errors
            expect(output).not.toContain('bash: ');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('duplicate prevention should work gracefully with missing log_duplicate_stats', async () => {
        // Test that duplicate prevention continues to work even when log_duplicate_stats fails
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=1  # Short timeout for faster testing
export BACKTEST_STARTUP_FLOCK_TIMEOUT=5

# Issue #5372: Set configuration variables
export BACKTEST_STARTUP_LOCK_FILE="/tmp/backtest-startup-message.lock"
export BACKTEST_STARTUP_TIMESTAMP_FILE="/tmp/backtest-startup-message.last"
export BACKTEST_FD_BASE=200
export CONTAINER_RESTART_DETECTION_THRESHOLD=300

# Clean up test files
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true

# Source the functions
source <(sed -n '/^log_backtest_startup_message()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)
source <(sed -n '/^update_timestamp_atomically()/,/^}/p' entrypoint.sh)
source <(sed -n '/^set_secure_permissions()/,/^}/p' entrypoint.sh)

# First call - should output message
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# Immediate second call - should be prevented by process flag
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# Wait briefly and try again - should be prevented by timestamp check
sleep 1
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# Verify success
echo "TEST_PASSED: Duplicate prevention working"

# Clean up
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true
`;

        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5403-duplicate-prevention.sh');
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
            
            // Count occurrences of startup message
            const messageCount = (output.match(/Starting backtest container with enhanced error handling/g) || []).length;
            
            // Should only appear once due to duplicate prevention
            expect(messageCount).toBe(1);
            
            // Should indicate test passed
            expect(output).toContain('TEST_PASSED: Duplicate prevention working');
            
            // Should not contain any errors
            expect(output).not.toContain('command not found');
            expect(output).not.toContain('bash: ');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('Issue #5403 fix should be backwards compatible', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check that all existing Issue #5315 functionality is preserved
        expect(entrypointContent).toContain('_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
        expect(entrypointContent).toContain('flock -w $BACKTEST_STARTUP_FLOCK_TIMEOUT 200');
        
        // Check that Issue #5403 fix doesn't break existing error handling
        expect(entrypointContent).toContain('Issue #5315修正: プロセス内フラグによる即座の重複防止');
        expect(entrypointContent).toContain('Issue #5315修正: flockによる確実なファイルロック');
        
        // Verify all log_duplicate_stats calls are now safe
        // Check that log_duplicate_stats is only called after command -v check
        const logDuplicateStatsLines = entrypointContent.split('\n').filter(line => 
            line.includes('log_duplicate_stats') && line.includes('Issue #5338')
        );
        
        logDuplicateStatsLines.forEach(line => {
            expect(line.trim()).toMatch(/^\s*log_duplicate_stats\s*#\s*Issue #5338/);
        });
        
        // Check that existence checks are present for each call
        const existenceCheckCount = (entrypointContent.match(/if command -v log_duplicate_stats/g) || []).length;
        expect(existenceCheckCount).toBe(logDuplicateStatsLines.length);
    });

});