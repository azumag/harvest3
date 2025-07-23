const fs = require('fs');
const path = require('path');

describe('Backtest Service Issue #2559 Fix', () => {
  let entrypointContent;

  beforeAll(() => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
  });

  describe('Enhanced npm install error handling', () => {
    test('should include pre-install diagnostics', () => {
      expect(entrypointContent).toContain('Pre-install diagnostics:');
      expect(entrypointContent).toContain('Working directory: $(pwd)');
      expect(entrypointContent).toContain('Node.js version:');
      expect(entrypointContent).toContain('npm version:');
      expect(entrypointContent).toContain('Disk space:');
      expect(entrypointContent).toContain('package.json exists:');
      expect(entrypointContent).toContain('node_modules exists:');
    });

    test('should include timeout for npm install operations', () => {
      expect(entrypointContent).toContain('timeout 300 npm install');
    });

    test('should capture and log npm install errors', () => {
      expect(entrypointContent).toContain('npm_error_log="/tmp/npm-install-error.log"');
      expect(entrypointContent).toContain('npm error:');
    });

    test('should include enhanced critical dependency checking', () => {
      expect(entrypointContent).toContain('Checking dependency:');
      expect(entrypointContent).toContain('require error:');
      expect(entrypointContent).toContain('install error:');
      expect(entrypointContent).toContain('verification error:');
    });

    test('should include timeout for individual dependency installs', () => {
      expect(entrypointContent).toContain('timeout 120 npm install "$dep"');
    });

    test('should include enhanced npm ls validation', () => {
      expect(entrypointContent).toContain('Performing final dependency validation');
      expect(entrypointContent).toContain('npm_ls_error="/tmp/npm-ls-error.log"');
      expect(entrypointContent).toContain('npm ls error:');
    });

    test('should include success message for dependency installation', () => {
      expect(entrypointContent).toContain('All dependencies successfully installed and validated');
    });
  });

  describe('Error handling improvement verification', () => {
    test('should maintain existing critical dependencies list', () => {
      expect(entrypointContent).toContain('decimal.js@10.6.0');
      expect(entrypointContent).toContain('ccxt');
      expect(entrypointContent).toContain('mongodb');
      expect(entrypointContent).toContain('redis');
    });

    test('should include proper cleanup of temporary files', () => {
      expect(entrypointContent).toContain('rm -f "$npm_error_log"');
      expect(entrypointContent).toContain('rm -f "$dep_install_error"');
      expect(entrypointContent).toContain('rm -f "$dep_check_error"');
      expect(entrypointContent).toContain('rm -f "$npm_ls_error"');
    });

    test('should maintain Discord error notifications', () => {
      expect(entrypointContent).toContain('send_startup_error_to_discord');
    });
  });

  describe('Regression prevention', () => {
    test('should maintain existing startup message logic', () => {
      expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    });

    test('should maintain existing startup lock mechanism', () => {
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
    });

    test('should maintain existing backtest mode detection', () => {
      expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
    });
  });
});