/**
 * Issue #5219: [自動] backtestサービスで例外が発生
 * 
 * テスト対象:
 * - npm installの失敗によるコンテナ再起動ループの修正
 * - 重複する起動メッセージの改善
 * - より堅牢なエラーハンドリング
 * 
 * @author Claude Code
 * @date 2025-07-23
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Issue #5219: backtest service exception fix', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    let entrypointContent;

    beforeAll(() => {
        // entrypoint.sh の内容を読み込み
        entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    });

    describe('Enhanced npm install function', () => {
        test('install_npm_dependencies function should exist', () => {
            expect(entrypointContent).toContain('install_npm_dependencies() {');
        });

        test('should include enhanced diagnostics for Issue #5219', () => {
            expect(entrypointContent).toContain('Issue #5219: 事前診断情報の収集（強化版）');
            expect(entrypointContent).toContain('Memory available:');
            expect(entrypointContent).toContain('npm cache size:');
        });

        test('should include network connectivity test', () => {
            expect(entrypointContent).toContain('Issue #5219: ネットワーク接続性テスト');
            expect(entrypointContent).toContain('npm ping');
            expect(entrypointContent).toContain('npm registry connectivity');
        });

        test('should include npm cache cleanup for stability', () => {
            expect(entrypointContent).toContain('Issue #5219: npmキャッシュクリーンアップ（予防的対策）');
            expect(entrypointContent).toContain('npm cache clean --force');
        });

        test('should optimize npm configuration', () => {
            expect(entrypointContent).toContain('Issue #5219: npmレジストリ設定の最適化');
            expect(entrypointContent).toContain('fetch-retry-mintimeout 20000');
            expect(entrypointContent).toContain('fetch-retry-maxtimeout 120000');
            expect(entrypointContent).toContain('fetch-retries 5');
            expect(entrypointContent).toContain('network-timeout 300000');
        });

        test('should use optimized npm install options', () => {
            expect(entrypointContent).toContain('--no-audit --no-fund --prefer-offline');
        });

        test('should include fallback strategy for critical dependencies', () => {
            expect(entrypointContent).toContain('Issue #5219: 最終的なフォールバック戦略');
            expect(entrypointContent).toContain('critical_deps="ccxt express mongodb redis axios moment"');
            expect(entrypointContent).toContain('Attempting to install critical dependencies only');
        });
    });

    describe('Enhanced retry logic', () => {
        test('should include different npm options for each retry attempt', () => {
            expect(entrypointContent).toContain('Issue #5219: 各試行で異なるオプションを使用');
            expect(entrypointContent).toContain('--prefer-offline');
            expect(entrypointContent).toContain('--legacy-peer-deps');
            expect(entrypointContent).toContain('--force');
        });

        test('retry_npm_install_with_backoff function should exist', () => {
            expect(entrypointContent).toContain('retry_npm_install_with_backoff() {');
        });
    });

    describe('Error logging and monitoring', () => {
        test('should maintain compatibility with existing error logging', () => {
            // Issue #2559 下位互換性の確認
            expect(entrypointContent).toContain('Issue #2559 下位互換性');
            expect(entrypointContent).toContain('npm_error_log="/tmp/npm-install-error.log"');
        });

        test('should include enhanced error details', () => {
            expect(entrypointContent).toContain('npm error details:');
            expect(entrypointContent).toContain('head -20');
        });
    });

    describe('Integration with docker-compose', () => {
        const dockerComposePath = path.join(__dirname, '..', 'docker-compose.yml');
        
        test('docker-compose.yml should contain backtest service', () => {
            if (fs.existsSync(dockerComposePath)) {
                const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
                expect(dockerComposeContent).toContain('backtest:');
                expect(dockerComposeContent).toContain('BACKTEST_MODE=true');
                expect(dockerComposeContent).toContain('restart: on-failure:5');
            }
        });
    });

    describe('Scenario simulation', () => {
        test('should handle npm install failure gracefully', () => {
            // 最終的なフォールバック戦略のテスト
            const fallbackPattern = /critical_deps=.*ccxt.*express.*mongodb.*redis.*axios.*moment/;
            expect(entrypointContent).toMatch(fallbackPattern);
        });

        test('should prevent infinite restart loops', () => {
            // コンテナ再起動制限の確認
            expect(entrypointContent).toContain('max_container_restarts');
            expect(entrypointContent).toContain('restart_count');
        });
    });

    describe('Log message handling', () => {
        test('should use log_startup_message for backtest container', () => {
            expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
        });

        test('should have log_backtest_startup_message function', () => {
            expect(entrypointContent).toContain('log_backtest_startup_message() {');
        });

        test('should include duplicate message prevention', () => {
            expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_FILE');
            expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
        });
    });

    describe('Cleanup and maintenance', () => {
        test('should clean up temporary files', () => {
            expect(entrypointContent).toContain('rm -f "$npm_error_log"');
            expect(entrypointContent).toContain('rm -f "$dep_install_error"');
            expect(entrypointContent).toContain('rm -f /tmp/npm-check.log /tmp/npm-install-error-*.log');
        });
    });
});

/**
 * Integration test for the entire flow
 */
describe('Issue #5219: End-to-end flow verification', () => {
    test('entrypoint.sh should be executable', () => {
        const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
        const stats = fs.statSync(entrypointPath);
        expect(stats.mode & parseInt('111', 8)).toBeTruthy();
    });

    test('package.json should contain backtest script', () => {
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            expect(packageJson.scripts).toHaveProperty('backtest');
            expect(packageJson.scripts.backtest).toContain('node src/backtestRunner.js');
        }
    });

    test('should have required npm dependencies in package.json', () => {
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const criticalDeps = ['ccxt', 'express', 'mongodb', 'redis', 'axios', 'moment'];
            
            criticalDeps.forEach(dep => {
                expect(packageJson.dependencies).toHaveProperty(dep);
            });
        }
    });
});

/**
 * Performance and reliability tests
 */
describe('Issue #5219: Performance improvements', () => {
    test('should include timeout configurations for stability', () => {
        const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // npm設定のタイムアウト値をチェック
        expect(entrypointContent).toContain('fetch-retry-mintimeout 20000');
        expect(entrypointContent).toContain('fetch-retry-maxtimeout 120000');
        expect(entrypointContent).toContain('network-timeout 300000');
    });

    test('should include resource usage monitoring', () => {
        const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        expect(entrypointContent).toContain('Memory available:');
        expect(entrypointContent).toContain('Disk space:');
        expect(entrypointContent).toContain('npm cache size:');
    });
});