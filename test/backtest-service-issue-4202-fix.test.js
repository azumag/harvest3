const fs = require('fs');
const path = require('path');

describe('Backtest Service Issue #4202 Fix', () => {
  let entrypointContent;

  beforeAll(() => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
  });

  describe('Infinite restart loop prevention', () => {
    test('should include dependency status check before npm install', () => {
      expect(entrypointContent).toContain('Checking existing dependency status...');
      expect(entrypointContent).toContain('npm ls 2>"$npm_check_log"');
      expect(entrypointContent).toContain('Dependencies already satisfied, skipping npm install');
    });

    test('should include container restart counter', () => {
      expect(entrypointContent).toContain('restart_counter_file="/tmp/.npm_restart_counter"');
      expect(entrypointContent).toContain('Container restart count:');
      expect(entrypointContent).toContain('max_container_restarts=3');
    });

    test('should include exponential backoff retry logic', () => {
      expect(entrypointContent).toContain('max_npm_attempts=3');
      expect(entrypointContent).toContain('timeout_seconds=$((180 + npm_install_attempts * 60))');
      expect(entrypointContent).toContain('retry_delay=$((npm_install_attempts * 10))');
    });

    test('should include infinite loop prevention mechanism', () => {
      expect(entrypointContent).toContain('Maximum container restart count exceeded');
      expect(entrypointContent).toContain('Maximum restart attempts reached. Continuing with partial dependencies');
      expect(entrypointContent).toContain('prevents infinite restart loop');
    });

    test('should reset counter on successful npm install', () => {
      expect(entrypointContent).toContain('rm -f "$restart_counter_file"');
      expect(entrypointContent).toContain('npm install completed successfully');
    });
  });

  describe('Enhanced error handling', () => {
    test('should include attempt-specific error logging', () => {
      expect(entrypointContent).toContain('npm-install-error-${npm_install_attempts}.log');
      expect(entrypointContent).toContain('npm install attempt $npm_install_attempts failed');
    });

    test('should include timeout progression', () => {
      expect(entrypointContent).toContain('timeout: ${timeout_seconds}s');
      expect(entrypointContent).toContain('attempt $npm_install_attempts/$max_npm_attempts');
    });

    test('should include proper cleanup of temporary files', () => {
      expect(entrypointContent).toContain('rm -f /tmp/npm-check.log /tmp/npm-install-error-*.log');
    });

    test('should maintain Discord error notifications', () => {
      expect(entrypointContent).toContain('send_startup_error_to_discord');
      expect(entrypointContent).toContain('Infinite restart loop prevention activated');
    });
  });

  describe('Backwards compatibility', () => {
    test('should maintain existing Issue #2559 fix functionality', () => {
      expect(entrypointContent).toContain('Pre-install diagnostics:');
      expect(entrypointContent).toContain('Working directory: $(pwd)');
      expect(entrypointContent).toContain('Node.js version:');
      expect(entrypointContent).toContain('npm version:');
    });

    test('should maintain critical dependency checking', () => {
      expect(entrypointContent).toContain('Checking critical dependencies...');
      expect(entrypointContent).toContain('decimal.js@10.6.0');
      expect(entrypointContent).toContain('ccxt');
      expect(entrypointContent).toContain('mongodb');
      expect(entrypointContent).toContain('redis');
    });

    test('should maintain startup lock mechanism', () => {
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
    });

    test('should maintain backtest mode detection', () => {
      expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
    });
  });

  describe('Issue #4202 specific fixes', () => {
    test('should include issue reference in comments', () => {
      expect(entrypointContent).toContain('Issue #4202 修正: 無限再起動ループ防止');
      expect(entrypointContent).toContain('Issue #4202 修正: 既存の依存関係の状態を事前確認');
      expect(entrypointContent).toContain('Issue #4202 修正: 指数バックオフによるリトライとコンテナ再起動防止');
    });

    test('should include the specific error message pattern prevention', () => {
      expect(entrypointContent).toContain('Attempting npm install');
      // The message should still exist but be controlled by the new logic
      expect(entrypointContent).toContain('attempt $npm_install_attempts/$max_npm_attempts');
    });

    test('should include container restart tracking', () => {
      expect(entrypointContent).toContain('container restart $restart_count/$max_container_restarts');
    });

    test('should include graceful degradation', () => {
      expect(entrypointContent).toContain('Attempting minimal dependency install');
      expect(entrypointContent).toContain('This may cause runtime errors, but prevents infinite restart loop');
    });
  });
});