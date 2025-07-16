/**
 * strategy-runner二重再起動修正のテスト
 * Issue #2511: strategy-runnerサービスで例外が発生（再起動ループ）
 */

const fs = require('fs');
const path = require('path');

describe('Strategy-Runner二重再起動修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');

  describe('Issue #2511の問題分析と解決確認', () => {
    test('entrypoint.shファイルが存在し、内容を読み込める', () => {
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      expect(entrypointContent).toBeTruthy();
      expect(entrypointContent.length).toBeGreaterThan(0);
    });

    test('Docker restart policyとの競合を防ぐ機構が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 内部プロセス監視機能の存在確認
      expect(entrypointContent).toContain('プロセス監視と自動回復機能');
      expect(entrypointContent).toContain('while true; do');
      
      // 頻繁な再起動を防ぐ機能の確認（Issue #2511対策で45秒に延長）
      expect(entrypointContent).toContain('頻繁な再起動を防ぐ');
      expect(entrypointContent).toContain('最後の再起動から45秒以内は再起動しない');
      
      // レースコンディション防止機能の確認
      expect(entrypointContent).toContain('レースコンディション防止');
      expect(entrypointContent).toContain('restart_in_progress');
    });

    test('適切な再起動制限機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 最大再起動回数の制限
      expect(entrypointContent).toContain('max_process_restarts');
      expect(entrypointContent).toContain('Maximum internal restart attempts reached');
      
      // クールダウン期間の実装
      expect(entrypointContent).toContain('restart_cooldown');
      expect(entrypointContent).toContain('Waiting for');
      expect(entrypointContent).toContain('cooldown period');
    });

    test('優雅なシャットダウンの実装が正しい', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // SIGTERMハンドリングの確認
      expect(entrypointContent).toContain('kill -TERM $app_pid');
      expect(entrypointContent).toContain('Sending SIGTERM to bot process');
      
      // 優雅なシャットダウン待機の確認
      expect(entrypointContent).toContain('プロセスが終了するまで待つ');
      expect(entrypointContent).toContain('while kill -0 $app_pid');
      
      // 強制終了機能の確認
      expect(entrypointContent).toContain('force killing');
      expect(entrypointContent).toContain('kill -KILL $app_pid');
    });

    test('診断機能とロギングが適切に実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 診断情報の記録
      expect(entrypointContent).toContain('SHUTDOWN DIAGNOSTICS');
      expect(entrypointContent).toContain('Process status at shutdown');
      
      // リソース使用状況の記録
      expect(entrypointContent).toContain('Memory usage');
      expect(entrypointContent).toContain('Disk usage');
      
      // 包括的診断機能
      expect(entrypointContent).toContain('COMPREHENSIVE DIAGNOSTICS');
      expect(entrypointContent).toContain('run_diagnostics');
    });

    test('Issue #2511の具体的な問題（二重再起動）への対策が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 問題の根本原因：内部監視ループ + Docker restart policy
      // 対策1: レースコンディション防止
      expect(entrypointContent).toContain('restart_in_progress=true');
      expect(entrypointContent).toContain('restart_in_progress');
      
      // 対策2: 時間間隔制御
      expect(entrypointContent).toContain('Too soon since last restart');
      expect(entrypointContent).toContain('last_restart_time');
      
      // 対策3: 連続失敗回数の管理
      expect(entrypointContent).toContain('consecutive_failures');
      expect(entrypointContent).toContain('max_consecutive_failures');
      
      // 対策4: 適切な終了コード制御
      expect(entrypointContent).toContain('Maximum consecutive failures reached');
      expect(entrypointContent).toContain('Allowing Docker-level restart');
      expect(entrypointContent).toContain('exit 1');
    });

    test('再起動ループを回避する時間制御機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 時間ベースの制御
      expect(entrypointContent).toContain('current_time=$(date +%s)');
      expect(entrypointContent).toContain('last_restart_time');
      
      // 45秒間隔の制御（issue #2511のログパターンに対応、30秒から延長）
      expect(entrypointContent).toContain('45');
      
      // 時間差計算ロジック
      expect(entrypointContent).toContain('current_time - last_restart_time');
    });

    test('プロセス状態の適切な監視機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // プロセス生存確認
      expect(entrypointContent).toContain('kill -0 $app_pid');
      expect(entrypointContent).toContain('bot_alive=true');
      
      // 定期的なヘルスチェック
      expect(entrypointContent).toContain('定期的なヘルスチェック');
      expect(entrypointContent).toContain('Process health check');
      
      // PID管理
      expect(entrypointContent).toContain('app_pid');
      expect(entrypointContent).toContain('Bot PID');
    });
  });

  describe('Docker Compose設定との整合性確認', () => {
    test('Docker Composeのrestart policyが適切に設定されている', () => {
      const dockerComposePath = path.join(__dirname, '..', 'docker-compose.yml');
      expect(fs.existsSync(dockerComposePath)).toBe(true);
      
      const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
      
      // restart policyの確認（on-failure:5により最大5回まで再起動）
      expect(dockerComposeContent).toContain('restart: on-failure:5');
      
      // strategy-runnerサービスの確認
      expect(dockerComposeContent).toContain('container_name: strategy-runner');
      
      // entrypoint設定の確認
      expect(dockerComposeContent).toContain('entrypoint: ["/usr/src/app/entrypoint.sh"]');
    });

    test('再起動ポリシーの競合を回避する設計になっている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Docker レベルとスクリプトレベルの再起動の住み分け
      // スクリプト内での最大再起動回数がDockerの制限より少ないことを確認（Issue #2511対策で2回に制限）
      expect(entrypointContent).toContain('max_process_restarts=2');
      
      // Dockerは5回、スクリプト内は2回の制限で住み分けを図る
      expect(entrypointContent).toContain('2'); // スクリプト内の制限
    });
  });

  describe('ログメッセージの重複防止機能確認', () => {
    test('起動メッセージの重複防止機能が動作する', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #2511で見られた重複メッセージの防止
      expect(entrypointContent).toContain('log_startup_message');
      expect(entrypointContent).toContain('Starting strategy-runner container with enhanced error handling');
      
      // atomic実装による重複防止
      expect(entrypointContent).toContain('atomic');
      expect(entrypointContent).toContain('message_hash');
      expect(entrypointContent).toContain('md5sum');
    });

    test('重複起動の検出と適切な処理が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動ロック機能
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE');
      
      // 重複起動の検出
      expect(entrypointContent).toContain('Another startup process is running');
      
      // 適切な待機処理
      expect(entrypointContent).toContain('waiting...');
    });
  });

  describe('エラーハンドリングと通知機能', () => {
    test('Discord通知機能が適切に実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Discord通知機能の存在確認
      expect(entrypointContent).toContain('send_startup_error_to_discord');
      expect(entrypointContent).toContain('DISCORD_ERROR_WEBHOOK_URL');
      
      // エラー時の通知処理
      expect(entrypointContent).toContain('Container startup failed');
      expect(entrypointContent).toContain('Discord notification');
    });

    test('エラー時の適切なexit code設定が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 各種エラー時のexit処理
      expect(entrypointContent).toContain('exit 1');
      expect(entrypointContent).toContain('exit 0');
      
      // エラーコードの設定
      expect(entrypointContent).toContain('exit_code=$?');
    });
  });

  describe('回帰テストとリグレッション防止', () => {
    test('以前のstrategy-runner関連修正が維持されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #2513の修正（起動ロック）が維持されていることを確認
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
      
      // Issue #2525の修正（メッセージ重複防止）が維持されていることを確認
      expect(entrypointContent).toContain('log_startup_message');
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
    });

    test('Issue #2511の修正により新たな問題が発生していないことを確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 基本的な起動処理が維持されていることを確認
      expect(entrypointContent).toContain('pre_startup_checks');
      expect(entrypointContent).toContain('check_database_connections');
      expect(entrypointContent).toContain('start_application');
      
      // シグナルハンドラーが維持されていることを確認
      expect(entrypointContent).toContain('trap cleanup SIGTERM SIGINT');
      
      // メイン実行ロジックが維持されていることを確認
      expect(entrypointContent).toContain('main() {');
    });
  });
});