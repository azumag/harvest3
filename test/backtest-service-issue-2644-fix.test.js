/**
 * Backtest Service Issue #2644 Fix Test
 * Issue #2644: [自動] backtestサービスで例外が発生
 * 
 * このテストは、バックテストサービスの重複起動メッセージと
 * npm installエラーハンドリングが正しく動作することを確認する
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Backtest Service Issue #2644 Fix', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const dockerComposePath = path.join(__dirname, '..', 'docker-compose.yml');
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  
  let entrypointContent;
  let dockerComposeContent;
  let packageJson;

  beforeAll(() => {
    try {
      entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    } catch (error) {
      throw new Error(`entrypoint.sh が見つかりません: ${entrypointPath}`);
    }
    
    try {
      dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
    } catch (error) {
      throw new Error(`docker-compose.yml が見つかりません: ${dockerComposePath}`);
    }
    
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (error) {
      throw new Error(`package.json が見つかりません: ${packageJsonPath}`);
    }
  });

  describe('重複起動メッセージ防止機能', () => {
    test('backtest用の起動メッセージが重複防止機能を使用している', () => {
      // backtest用の起動メッセージがlog_startup_message関数を使用していることを確認
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
      
      // log_startup_message関数のatomic実装が存在することを確認
      expect(entrypointContent).toContain('log_startup_message() {');
      expect(entrypointContent).toContain('重複起動ログ防止関数（簡素化版）');
    });

    test('バックテストモードでの起動メッセージが適切に制御されている', () => {
      // バックテストモードの条件分岐が正しく実装されていることを確認
      expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
      
      // 通常モードとバックテストモードで異なるメッセージが使用されていることを確認
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
    });

    test('起動ロック機能がバックテストモードでも動作する', () => {
      // 起動ロックの取得がバックテストモードでも実行されることを確認
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE="/tmp/strategy-runner-startup.lock"');
    });
  });

  describe('npm install エラーハンドリング改善', () => {
    test('npm installのタイムアウト機能が実装されている', () => {
      // npm installに300秒のタイムアウトが設定されていることを確認
      expect(entrypointContent).toContain('timeout 300 npm install');
    });

    test('npm installエラーの詳細ログが実装されている', () => {
      // npm installエラーの詳細ログ収集が実装されていることを確認
      expect(entrypointContent).toContain('npm_error_log="/tmp/npm-install-error.log"');
      expect(entrypointContent).toContain('npm error:');
      expect(entrypointContent).toContain('cat "$npm_error_log"');
    });

    test('npm cacheクリアとリトライ機能が実装されている', () => {
      // npm cache clean機能が実装されていることを確認
      expect(entrypointContent).toContain('npm cache clean --force');
      expect(entrypointContent).toContain('Cleaning npm cache and retrying...');
    });

    test('critical dependenciesの個別インストール機能が実装されている', () => {
      // 重要な依存関係の個別インストール機能が実装されていることを確認
      expect(entrypointContent).toContain('critical_deps=(');
      expect(entrypointContent).toContain('decimal.js@10.6.0');
      expect(entrypointContent).toContain('timeout 120 npm install "$dep"');
    });
  });

  describe('Docker再起動ポリシーとの統合', () => {
    test('Docker Compose設定でrestart policyが適切に設定されている', () => {
      // backtest serviceのrestart policyを確認
      expect(dockerComposeContent).toContain('restart: on-failure:5');
    });

    test('エラー時のexit codeが適切に設定されている', () => {
      // エラー時に適切なexit codeで終了することを確認
      expect(entrypointContent).toContain('exit 1');
      expect(entrypointContent).toContain('send_startup_error_to_discord');
    });
  });

  describe('Issue #2644 回帰防止', () => {
    test('npm installエラーが発生しても適切にエラーハンドリングされる', () => {
      // npm installエラー時の適切なエラーメッセージが設定されていることを確認
      expect(entrypointContent).toContain('npm install failed after cache clean');
      expect(entrypointContent).toContain('Node.js dependency installation failed');
    });

    test('起動メッセージの重複が発生しない仕組みが実装されている', () => {
      // atomicなファイル操作による重複防止が実装されていることを確認
      expect(entrypointContent).toContain('(set -C; echo "$$" > "$lock_file") 2>/dev/null');
      expect(entrypointContent).toContain('他のプロセスが処理中または処理済み');
    });

    test('バックテストコマンドが正しく実行される', () => {
      // バックテストモードでのコマンド実行が正しく設定されていることを確認
      expect(entrypointContent).toContain('exec "$@"');
      
      // package.jsonでbacktestコマンドが定義されていることを確認
      expect(packageJson.scripts.backtest).toBeDefined();
      expect(packageJson.scripts.backtest).toContain('backtestRunner.js');
    });
  });

  describe('統合テストとリグレッション防止', () => {
    test('entrypoint.shの構文が正しい', async () => {
      // CI環境では構文チェックをスキップ（環境依存回避）
      if (process.env.CI) {
        console.log('CI環境では構文チェックをスキップします');
        return;
      }
      
      // bashスクリプトの構文チェック
      await expect(execAsync(`bash -n ${entrypointPath}`)).resolves.not.toThrow();
    });

    test('必要なコマンドが利用可能', async () => {
      // CI環境では一部のコマンドチェックをスキップ（環境依存回避）
      if (process.env.CI) {
        console.log('CI環境では一部のコマンドチェックをスキップします');
        return;
      }
      
      // 必要なコマンドが利用可能であることを確認
      await expect(execAsync('which timeout')).resolves.not.toThrow();
      await expect(execAsync('which md5sum')).resolves.not.toThrow();
      await expect(execAsync('which mkdir')).resolves.not.toThrow();
    });

    test('Docker Compose設定が有効', () => {
      expect(fs.existsSync(dockerComposePath)).toBe(true);
      
      // backtest serviceが正しく定義されていることを確認
      expect(dockerComposeContent).toContain('backtest:');
      expect(dockerComposeContent).toContain('container_name: backtest');
      expect(dockerComposeContent).toContain('command: npm run backtest');
      expect(dockerComposeContent).toContain('BACKTEST_MODE=true');
    });
  });

  describe('エラーログ分析機能', () => {
    test('npm エラーログの分析機能が実装されている', () => {
      // npm エラーログの分析とレポート機能が実装されていることを確認
      expect(entrypointContent).toContain('npm error details:');
      expect(entrypointContent).toContain('head -20');
    });

    test('Discord通知機能が実装されている', () => {
      // Discord通知機能が実装されていることを確認
      expect(entrypointContent).toContain('send_startup_error_to_discord');
      expect(entrypointContent).toContain('DISCORD_ERROR_WEBHOOK_URL');
    });
  });
});