/**
 * Test for Issue #5315: [自動] backtestサービスで例外が発生
 * https://github.com/azumag/harvest3/issues/5315
 * 
 * Issue Description:
 * - Backtest service showing duplicate startup messages at exact same timestamp
 * - Message "Starting backtest container with enhanced error handling" appears twice
 * - Race condition in log_backtest_startup_message function
 * 
 * Root Cause:
 * - Previous implementation relied only on file-based timestamp checking
 * - Race condition occurred when multiple processes executed simultaneously
 * - Atomic file operations were not sufficient to prevent duplicates
 * 
 * Fix Implementation:
 * - Added process-internal flag (_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS) for immediate duplicate prevention
 * - Implemented flock-based file locking for inter-process synchronization
 * - Created dual-defense system: process flag + file lock
 * - Added fallback mechanism for environments without flock
 * - Enhanced cleanup functions to handle new resources
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Issue #5315: Backtest Service Duplicate Message Fix', () => {
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

    test('entrypoint.sh should contain Issue #5315 fix for duplicate prevention', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check for Issue #5315 fix comments
        expect(entrypointContent).toContain('# Issue #5315修正: backtest container専用起動メッセージ関数（強化版重複防止）');
        expect(entrypointContent).toContain('# Issue #5315修正: プロセス内フラグによる即座の重複防止（第一防御線）');
        expect(entrypointContent).toContain('# Issue #5315修正: flockによる確実なファイルロック（第二防御線）');
        
        // Check for process-internal flag implementation
        expect(entrypointContent).toContain('_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
        
        // Check for flock implementation
        expect(entrypointContent).toContain('flock -w 5 200');
        expect(entrypointContent).toContain('exec 200>"$lock_file"');
        
        // Check for enhanced cleanup
        expect(entrypointContent).toContain('unset _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
        expect(entrypointContent).toContain('exec 200>&- 2>/dev/null || true');
    });

    test('log_backtest_startup_message should prevent duplicates using process flag', async () => {
        // Create a test script that simulates rapid consecutive calls
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=5

# Clean up test files
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true

# Source the enhanced log_backtest_startup_message function
source <(sed -n '/^log_backtest_startup_message()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)

# Test rapid consecutive calls (should only output once due to process flag)
log_startup_message "Starting backtest container with enhanced error handling"
log_startup_message "Starting backtest container with enhanced error handling" 
log_startup_message "Starting backtest container with enhanced error handling"

# Clean up
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true
`;

        // Write test script to .tmp directory
        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5315-process-flag.sh');
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
            
            // Should not contain duplicate suppression message for process flag
            expect(output).not.toContain('Backtest startup message suppressed');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('log_backtest_startup_message should use flock for inter-process synchronization', async () => {
        // Test that flock is used when available
        const testScript = `
#!/bin/bash

# Check if flock is available (most Linux systems have it)
if ! command -v flock >/dev/null 2>&1; then
    echo "SKIP: flock not available in test environment"
    exit 0
fi

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=5

# Clean up test files
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true

# Source the enhanced functions
source <(sed -n '/^log_backtest_startup_message()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)

# Test single call to verify flock usage
log_startup_message "Starting backtest container with enhanced error handling"

# Check that lock file was created and used
if [ -f "/tmp/backtest-startup-message.last" ]; then
    echo "FLOCK_TEST_PASSED: Timestamp file created"
else
    echo "FLOCK_TEST_FAILED: Timestamp file not created"
fi

# Clean up
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true
`;

        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5315-flock.sh');
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
            
            if (output.includes('SKIP: flock not available')) {
                console.log('Skipping flock test - flock not available in test environment');
                return;
            }
            
            // Should contain the startup message
            expect(output).toContain('Starting backtest container with enhanced error handling');
            
            // Should indicate flock test passed
            expect(output).toContain('FLOCK_TEST_PASSED');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('log_backtest_startup_message should fallback gracefully when flock unavailable', async () => {
        // Test fallback behavior when flock is not available
        const testScript = `
#!/bin/bash

# Set environment variables for test
export BACKTEST_MODE=true
export BACKTEST_STARTUP_LOCK_TIMEOUT=5

# Clean up test files
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true

# Mock flock unavailability by overriding command
command() {
    if [ "$1" = "flock" ]; then
        return 1  # Simulate flock not available
    fi
    /usr/bin/env command "$@"
}

# Source the enhanced functions
source <(sed -n '/^log_backtest_startup_message()/,/^}/p' entrypoint.sh)
source <(sed -n '/^log()/,/^}/p' entrypoint.sh)

# Test fallback behavior
log_startup_message "Starting backtest container with enhanced error handling"

# Clean up
rm -f /tmp/backtest-startup-message.lock 2>/dev/null || true
rm -f /tmp/backtest-startup-message.last 2>/dev/null || true
`;

        const testScriptPath = path.join(__dirname, '../.tmp/test-issue-5315-fallback.sh');
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
            
            // Should contain fallback warning
            expect(output).toContain('WARNING: flock not available, using fallback duplicate prevention');
            
            // Should still contain the startup message
            expect(output).toContain('Starting backtest container with enhanced error handling');
            
        } finally {
            // Clean up test script
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('cleanup_backtest_locks should clean up Issue #5315 resources', () => {
        const entrypointPath = path.join(__dirname, '../entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Check that cleanup function includes Issue #5315 resources
        expect(entrypointContent).toContain('# Issue #5315修正: プロセス内フラグのリセット');
        expect(entrypointContent).toContain('unset _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
        expect(entrypointContent).toContain('# Issue #5315修正: flockのファイルディスクリプタクリーンアップ');
        expect(entrypointContent).toContain('exec 200>&- 2>/dev/null || true');
        expect(entrypointContent).toContain('# Issue #5315修正: 新しいロックファイルのクリーンアップ');
        expect(entrypointContent).toContain('/tmp/backtest-startup-message.lock');
        expect(entrypointContent).toContain('/tmp/backtest-startup-message.last');
    });

    test('docker-compose.yml should have backtest service configured correctly', () => {
        const dockerComposePath = path.join(__dirname, '../docker-compose.yml');
        expect(fs.existsSync(dockerComposePath)).toBe(true);
        
        const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
        
        // Check backtest service configuration
        expect(dockerComposeContent).toContain('backtest:');
        expect(dockerComposeContent).toContain('BACKTEST_MODE=true');
        expect(dockerComposeContent).toContain('npm run backtest');
        expect(dockerComposeContent).toContain('entrypoint: ["/usr/src/app/entrypoint.sh"]');
    });

});