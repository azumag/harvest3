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

/**
 * DRY原則に従い、ファイル読み込みの共通処理をヘルパー関数化
 * @param {string} filePath - 読み込むファイルのパス
 * @returns {string} ファイルの内容
 */
function readConfigFile(filePath) {
  expect(fs.existsSync(filePath)).toBe(true);
  return fs.readFileSync(filePath, 'utf8');
}

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
    test('docker-compose.ymlのbacktestサービスに環境変数設定が適切に構成されている', () => {
      const dockerComposeContent = readConfigFile(dockerComposePath);
      
      // backtestサービスセクションを抽出（改良版正則表現で正確にマッチング）
      const backtestServiceMatch = dockerComposeContent.match(/backtest:[\s\S]*?(?=\n[a-zA-Z]|\n  [a-zA-Z-]+:|$)/);
      expect(backtestServiceMatch).toBeTruthy();
      
      const backtestServiceConfig = backtestServiceMatch[0];
      
      // セキュリティ強化: 必要最小限の環境変数のみが設定されていることを確認
      expect(backtestServiceConfig).toContain('DISCORD_ERROR_WEBHOOK_URL=${DISCORD_ERROR_WEBHOOK_URL}');
      expect(backtestServiceConfig).toContain('DISCORD_BACKTEST_WEBHOOK_URL=${DISCORD_BACKTEST_WEBHOOK_URL}');
      expect(backtestServiceConfig).toContain('DISCORD_WARNING_WEBHOOK_URL=${DISCORD_WARNING_WEBHOOK_URL}');
      
      // env_fileが削除され、明示的な環境変数設定に変更されていることを確認
      expect(backtestServiceConfig).not.toContain('env_file:');
      // 実際のbacktestサービス設定にはenv_file構成が含まれていないことを確認
      expect(backtestServiceConfig).not.toMatch(/^\s*env_file:\s*$/m);
      expect(backtestServiceConfig).not.toMatch(/^\s*-\s+\.env\s*$/m);
      
      // 既存の環境変数設定が維持されていることを確認
      expect(backtestServiceConfig).toContain('BACKTEST_MODE=true');
      expect(backtestServiceConfig).toContain('REDIS_URL=redis://redis:6379');
    });

    test('webhookUtils.jsでバックテストモード時の適切なメッセージ処理が実装されている', () => {
      const webhookUtilsContent = readConfigFile(webhookUtilsPath);
      
      // バックテストモード用の特別なメッセージが定義されていることを確認
      expect(webhookUtilsContent).toContain('process.env.BACKTEST_MODE === \'true\'');
      expect(webhookUtilsContent).toContain('バックテストモードのため通知をスキップ');
      
      // 適切なログレベル設定（バックテストモード時はwarn、通常時はerror）
      expect(webhookUtilsContent).toContain('logger[isBacktestMode ? \'warn\' : \'error\']');
    });

    test('修正後もentrypoint.shの基本機能が維持されている', () => {
      const entrypointContent = readConfigFile(entrypointPath);
      
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
      const entrypointContent = readConfigFile(entrypointPath);
      
      // Issue #5040で問題となった重複防止機構の確認（Issue #5159: flock方式に更新）
      expect(entrypointContent).toContain('log_backtest_startup_message()');
      expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
      expect(entrypointContent).toContain('exec 200>"$lock_file"');
      expect(entrypointContent).toContain('flock -x');
      
      // NPMエラー検出機構（Issue #5159追加）
      expect(entrypointContent).toContain('NPMエラー状態をチェック（Issue #5159）');
      expect(entrypointContent).toContain('npm_error_marker');
      
      // 60秒タイムアウト設定（Issue #5175対応）
      expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT:-60');
    });

    test('ログメッセージの出力が適切に制御されている', () => {
      const entrypointContent = readConfigFile(entrypointPath);
      
      // 問題となったメッセージの呼び出し箇所を確認
      expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
      
      // 重複抑制メッセージの実装確認（flock方式）
      expect(entrypointContent).toContain('Backtest startup message suppressed');
      expect(entrypointContent).toContain('last shown');
      expect(entrypointContent).toContain('lock acquisition timeout');
    });

    test('クリーンアップ機能が正しく実装されている', async () => {
      const entrypointContent = readConfigFile(entrypointPath);
      
      // flock方式のタイムスタンプファイル管理
      expect(entrypointContent).toContain('timestamp_file');
      expect(entrypointContent).toContain('chmod 600 "$temp_timestamp"');
      
      // flockによるファイルディスクリプタ管理
      expect(entrypointContent).toContain('exec 200>&-');
    });
  });

  describe('統合テスト：修正の総合効果確認', () => {
    // YAGNI原則に従い、CI環境で常にスキップされるテストを削除
    // docker-compose構文は別の方法で検証可能

    test('entrypoint.sh構文検証', async () => {
      // entrypoint.shが有効なbashスクリプトであることを確認
      await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 5000 }))
        .resolves.not.toThrow();
    }, 7000);

    test('Issue #5040修正により既存機能に悪影響がないことを確認', () => {
      const entrypointContent = readConfigFile(entrypointPath);
      
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
      // 1. Discord Webhook URL設定問題の解決（セキュリティ強化版）
      const dockerComposeContent = readConfigFile(dockerComposePath);
      const backtestServiceMatch = dockerComposeContent.match(/backtest:[\s\S]*?(?=\n[a-zA-Z]|\n  [a-zA-Z-]+:|$)/);
      const backtestServiceConfig = backtestServiceMatch[0];
      
      // 必要最小限の環境変数のみが設定されていることを確認（セキュリティ改善）
      expect(backtestServiceConfig).toContain('DISCORD_ERROR_WEBHOOK_URL=${DISCORD_ERROR_WEBHOOK_URL}');
      expect(backtestServiceConfig).not.toContain('env_file:');
      
      // 2. 重複メッセージ防止機構の確認（Issue #5159: flock方式に更新）
      const entrypointContent = readConfigFile(entrypointPath);
      expect(entrypointContent).toContain('log_backtest_startup_message()');
      expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
      
      // 3. エラーハンドリングの改善確認
      expect(entrypointContent).toContain('enhanced error handling');
      expect(entrypointContent).toContain('startup lock');
    });

    test('修正によりログ出力が改善されることを確認', () => {
      const webhookUtilsContent = readConfigFile(webhookUtilsPath);
      
      // バックテストモード時の適切なメッセージ表示
      expect(webhookUtilsContent).toContain('バックテストモードのため通知をスキップ');
      
      // 環境変数チェック機能
      expect(webhookUtilsContent).toContain('checkWebhookUrl');
      expect(webhookUtilsContent).toContain('logWebhookNotSet');
    });
  });

  describe('将来の再発防止策確認', () => {
    test('類似問題の再発を防ぐための設計が実装されている', () => {
      const entrypointContent = readConfigFile(entrypointPath);
      
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

    test('セキュリティ強化と設定管理が適切に実装されている', () => {
      const dockerComposeContent = readConfigFile(dockerComposePath);
      
      // backtestサービスでセキュリティ強化された環境変数設定を確認
      const backtestServiceMatch = dockerComposeContent.match(/backtest:[\s\S]*?(?=\n[a-zA-Z]|\n  [a-zA-Z-]+:|$)/);
      const backtestServiceConfig = backtestServiceMatch[0];
      
      // 必要最小限の環境変数のみが明示的に設定されていることを確認
      expect(backtestServiceConfig).toContain('DISCORD_ERROR_WEBHOOK_URL=${DISCORD_ERROR_WEBHOOK_URL}');
      expect(backtestServiceConfig).toContain('BACKTEST_MODE=true');
      
      // セキュリティリスクのあるenv_fileは使用されていないことを確認
      expect(backtestServiceConfig).not.toContain('env_file:');
    });
  });
});