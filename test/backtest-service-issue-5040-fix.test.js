/**
 * Issue #5040: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた以下の問題の修正確認：
 * 1. Discord Webhook URL未設定警告問題
 * 2. 重複起動メッセージ問題
 * 
 * この修正により：
 * - docker-compose.ymlのbacktestサービスに.env読み込み設定を追加
 * - 既存のatomicロック機構の動作確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5040: backtestサービス例外発生修正', () => {
  const dockerComposePath = path.join(__dirname, '..', 'docker-compose.yml');
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const webhookUtilsPath = path.join(__dirname, '..', 'src', 'common', 'webhookUtils.js');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  describe('Discord Webhook URL設定問題修正確認', () => {
    test('docker-compose.ymlのbacktestサービスに.env読み込み設定が追加されている', () => {
      expect(fs.existsSync(dockerComposePath)).toBe(true);
      
      const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
      
      // backtestサービスセクションを抽出
      const backtestServiceMatch = dockerComposeContent.match(/backtest:[\s\S]*?(?=\n  \w+:|$)/);
      expect(backtestServiceMatch).toBeTruthy();
      
      const backtestServiceConfig = backtestServiceMatch[0];
      
      // env_file設定が追加されていることを確認
      expect(backtestServiceConfig).toContain('env_file:');
      expect(backtestServiceConfig).toContain('- .env');
      
      // 既存の環境変数設定が維持されていることを確認
      expect(backtestServiceConfig).toContain('BACKTEST_MODE=true');
      expect(backtestServiceConfig).toContain('REDIS_URL=redis://redis:6379');
    });

    test('webhookUtils.jsでバックテストモード時の適切なメッセージ処理が実装されている', () => {
      expect(fs.existsSync(webhookUtilsPath)).toBe(true);
      
      const webhookUtilsContent = fs.readFileSync(webhookUtilsPath, 'utf8');
      
      // バックテストモード用の特別なメッセージが定義されていることを確認
      expect(webhookUtilsContent).toContain('process.env.BACKTEST_MODE === \'true\'');
      expect(webhookUtilsContent).toContain('バックテストモードのため通知をスキップ');
      
      // 適切なログレベル設定（バックテストモード時はwarn、通常時はerror）
      expect(webhookUtilsContent).toContain('logger[isBacktestMode ? \'warn\' : \'error\']');
    });

    test('修正後もentrypoint.shの基本機能が維持されている', () => {
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Discord通知関数が正しく定義されていることを確認
      expect(entrypointContent).toContain('send_startup_error_to_discord()');
      expect(entrypointContent).toContain('DISCORD_ERROR_WEBHOOK_URL');
      expect(entrypointContent).toContain('WARNING: DISCORD_ERROR_WEBHOOK_URL not set');
      
      // バックテストモード判定が正しく動作することを確認
      expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]');
    });
  });

  describe('重複起動メッセージ問題の確認', () => {
    test('既存のatomicロック機構が正しく実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5040で問題となった重複防止機構の確認
      expect(entrypointContent).toContain('log_backtest_startup_message()');
      expect(entrypointContent).toContain('atomicなロック取得を試行（mkdirはatomic操作）');
      expect(entrypointContent).toContain('mkdir "$lock_dir"');
      
      // コンテナ再起動検出機構（Issue #5175拡張）
      expect(entrypointContent).toContain('BACKTEST_CONTAINER_RESTART_DETECTION_FILE');
      expect(entrypointContent).toContain('container_boot_time');
      expect(entrypointContent).toContain('instance_id');
      
      // 60秒タイムアウト設定（Issue #5175対応）
      expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT:-60');
    });

    test('ログメッセージの出力が適切に制御されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 問題となったメッセージの呼び出し箇所を確認
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
      
      // 重複抑制メッセージの実装確認
      expect(entrypointContent).toContain('Backtest startup message suppressed');
      expect(entrypointContent).toContain('last shown');
      expect(entrypointContent).toContain('another process is logging');
    });

    test('クリーンアップ機能が正しく実装されている', async () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // backtest専用クリーンアップ関数の存在確認
      expect(entrypointContent).toContain('cleanup_backtest_locks()');
      expect(entrypointContent).toContain('Removed backtest startup lock directory');
      expect(entrypointContent).toContain('Removed backtest container restart detection file');
      
      // セキュアなクリーンアップ処理
      expect(entrypointContent).toContain('rm -rf "$lock_dir" 2>/dev/null || true');
      expect(entrypointContent).toContain('chmod 600');
    });
  });

  describe('統合テスト：修正の総合効果確認', () => {
    test('docker-compose.yml構文検証', async () => {
      // docker-compose.ymlが有効な構文であることを確認
      // Note: CI環境ではdocker-composeが利用できないためスキップ
      if (process.env.GITHUB_ACTIONS || process.env.CI) {
        console.log('Skipping docker-compose validation in CI environment');
        return;
      }
      
      try {
        await execAsync(`docker-compose -f ${dockerComposePath} config`, { timeout: 10000 });
      } catch (error) {
        if (error.message.includes('docker-compose: not found')) {
          console.log('docker-compose not available, skipping validation');
          return;
        }
        throw error;
      }
    }, 12000);

    test('entrypoint.sh構文検証', async () => {
      // entrypoint.shが有効なbashスクリプトであることを確認
      await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 5000 }))
        .resolves.not.toThrow();
    }, 7000);

    test('Issue #5040修正により既存機能に悪影響がないことを確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重要な既存機能が維持されていることを確認
      const essentialFunctions = [
        'acquire_startup_lock()',
        'release_startup_lock()',
        'log_startup_message()',
        'log_backtest_startup_message()',
        'main()',
        'send_startup_error_to_discord()',
        'pre_startup_checks()',
        'check_database_connections()'
      ];
      
      essentialFunctions.forEach(func => {
        expect(entrypointContent).toContain(func);
      });
      
      // 通常のstrategy-runnerコンテナ起動処理が維持されている
      expect(entrypointContent).toContain('Starting strategy-runner container with enhanced error handling');
    });
  });

  describe('問題解決の検証', () => {
    test('Issue #5040で報告された具体的な問題が解決されている', () => {
      // 1. Discord Webhook URL設定問題の解決
      const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
      const backtestServiceMatch = dockerComposeContent.match(/backtest:[\s\S]*?(?=\n  \w+:|$)/);
      const backtestServiceConfig = backtestServiceMatch[0];
      
      expect(backtestServiceConfig).toContain('env_file:');
      expect(backtestServiceConfig).toContain('- .env');
      
      // 2. 重複メッセージ防止機構の確認
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      expect(entrypointContent).toContain('log_backtest_startup_message()');
      expect(entrypointContent).toContain('atomicなロック取得を試行');
      
      // 3. エラーハンドリングの改善確認
      expect(entrypointContent).toContain('enhanced error handling');
      expect(entrypointContent).toContain('startup lock');
    });

    test('修正によりログ出力が改善されることを確認', () => {
      const webhookUtilsContent = fs.readFileSync(webhookUtilsPath, 'utf8');
      
      // バックテストモード時の適切なメッセージ表示
      expect(webhookUtilsContent).toContain('バックテストモードのため通知をスキップ');
      
      // 環境変数チェック機能
      expect(webhookUtilsContent).toContain('checkWebhookUrl');
      expect(webhookUtilsContent).toContain('logWebhookNotSet');
    });
  });

  describe('将来の再発防止策確認', () => {
    test('類似問題の再発を防ぐための設計が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 過去のissue修正が統合されていることを確認
      expect(entrypointContent).toContain('Issue #5127, #5058 & #5175');
      expect(entrypointContent).toContain('改良版');
      
      // 堅牢なエラーハンドリング
      expect(entrypointContent).toContain('set -e');
      expect(entrypointContent).toContain('trap cleanup SIGTERM SIGINT');
      
      // 診断情報の充実
      expect(entrypointContent).toContain('起動診断情報');
      expect(entrypointContent).toContain('プロセス ID');
      expect(entrypointContent).toContain('バックテストモード');
    });

    test('設定の一元管理によりメンテナンス性が向上している', () => {
      const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
      
      // .envファイルによる設定の一元管理
      const envFileReferences = dockerComposeContent.match(/env_file:/g) || [];
      expect(envFileReferences.length).toBeGreaterThanOrEqual(2); // bot, backtest両方で使用
      
      // 一貫した設定パターン
      expect(dockerComposeContent).toContain('- .env');
    });
  });
});