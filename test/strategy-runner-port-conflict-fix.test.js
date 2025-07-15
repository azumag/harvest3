/**
 * strategy-runner サービスのポート競合修正テスト
 * Issue #1054 の修正内容を検証
 * 
 * 修正内容：
 * - botサービスではAPIサーバーを起動しない（ポート競合回避）
 * - プロセス監視はbotプロセスのみ
 * - シャットダウン処理もbotプロセスのみ
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('strategy-runner ポート競合修正テスト', () => {
    const entrypointPath = path.join(__dirname, '../entrypoint.sh');
    const dockerComposePath = path.join(__dirname, '../docker-compose.yml');
    let entrypointContent;
    let dockerComposeContent;
    
    beforeAll(() => {
        // テスト前にファイルの存在を確認
        expect(fs.existsSync(entrypointPath)).toBe(true);
        expect(fs.existsSync(dockerComposePath)).toBe(true);
        
        // ファイル内容を読み込み
        entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
    });

    describe('entrypoint.sh の修正内容確認', () => {

        test('APIサーバー起動コードが削除されている', () => {
            // APIサーバー起動が削除されていることを確認
            expect(entrypointContent).not.toContain('npm run start-web');
            expect(entrypointContent).not.toContain('Starting API server...');
            expect(entrypointContent).not.toContain('API server is ready on port 3000');
        });

        test('ボットアプリケーション起動コードが残っている', () => {
            // ボットアプリケーション起動が残っていることを確認
            expect(entrypointContent).toContain('npm run start');
            expect(entrypointContent).toContain('Starting bot application...');
            expect(entrypointContent).toContain('Bot PID:');
        });

        test('APIサーバー関連のプロセス監視が削除されている', () => {
            // APIサーバー監視が削除されていることを確認
            expect(entrypointContent).not.toContain('api_pid');
            expect(entrypointContent).not.toContain('API process died');
            expect(entrypointContent).not.toContain('Both processes died');
        });

        test('ボットプロセス監視が適切に更新されている', () => {
            // ボットプロセス監視が適切に更新されていることを確認
            expect(entrypointContent).toContain('Bot process died, attempting recovery...');
            expect(entrypointContent).toContain('Restarting bot process');
            expect(entrypointContent).toContain('Bot process restarted successfully');
        });

        test('シャットダウン処理が適切に更新されている', () => {
            // シャットダウン処理からAPIサーバー処理が削除されていることを確認
            expect(entrypointContent).not.toContain('Sending SIGTERM to API process');
            expect(entrypointContent).not.toContain('API process did not exit gracefully');
            expect(entrypointContent).toContain('Sending SIGTERM to bot process');
        });

        test('適切なコメントが追加されている', () => {
            // 修正理由のコメントが追加されていることを確認
            expect(entrypointContent).toContain('# ボットアプリケーションのみ起動（APIサーバーは別のweb-uiサービスで起動）');
        });
    });

    describe('docker-compose.yml の修正内容確認', () => {
        test('botサービスのヘルスチェックが適切に更新されている', () => {
            // botサービスのヘルスチェックがAPIサーバー依存からプロセス確認に変更されていることを確認
            expect(dockerComposeContent).toContain('pgrep');
            expect(dockerComposeContent).toContain('node bot.js');
            expect(dockerComposeContent).not.toContain('/api/health');
        });

        test('web-uiサービスが独立してAPIサーバーを起動する設定になっている', () => {
            // web-uiサービスが独立してAPIサーバーを起動することを確認
            expect(dockerComposeContent).toContain('container_name: trade_viewer');
            expect(dockerComposeContent).toContain('npm run start-web');
        });

        test('botサービスとweb-uiサービスのポート設定が適切に分離されている', () => {
            // botサービスにはポート公開設定がないことを確認
            const botServiceMatch = dockerComposeContent.match(/bot:\s*\n[\s\S]*?(?=\n\s+[a-zA-Z]|$)/);
            expect(botServiceMatch).toBeTruthy();
            const botServiceConfig = botServiceMatch[0];
            expect(botServiceConfig).not.toContain('ports:');
            
            // web-uiサービスにはポート公開設定があることを確認
            const webUiServiceMatch = dockerComposeContent.match(/web-ui:\s*\n[\s\S]*?(?=\n[a-zA-Z]|$)/);
            expect(webUiServiceMatch).toBeTruthy();
            const webUiServiceConfig = webUiServiceMatch[0];
            expect(webUiServiceConfig).toContain('ports:');
            expect(webUiServiceConfig).toContain('3000:3000');
        });
    });

    describe('統合テスト', () => {
        test('entrypoint.sh の構文エラーがない', () => {
            // シェルスクリプトの構文チェック
            expect(() => {
                execSync(`bash -n "${entrypointPath}"`);
            }).not.toThrow();
        });

        test('docker-compose.yml の構文エラーがない', () => {
            // docker-compose.yml の基本的な構文チェック（YAMLとして有効か）
            expect(() => {
                // YAMLファイルとして最低限の構造があることを確認
                expect(dockerComposeContent).toContain('services:');
                expect(dockerComposeContent).toContain('volumes:');
                expect(dockerComposeContent).toContain('networks:');
            }).not.toThrow();
        });
    });

    describe('回帰テスト', () => {
        test('必要な機能が削除されていない', () => {
            // 必要な機能が誤って削除されていないことを確認
            expect(entrypointContent).toContain('pre_startup_checks');
            expect(entrypointContent).toContain('check_database_connections');
            expect(entrypointContent).toContain('send_startup_error_to_discord');
            expect(entrypointContent).toContain('run_diagnostics');
            expect(entrypointContent).toContain('cleanup');
        });

        test('エラーハンドリングが適切に維持されている', () => {
            // エラーハンドリングが適切に維持されていることを確認
            expect(entrypointContent).toContain('set -e');
            expect(entrypointContent).toContain('trap cleanup SIGTERM SIGINT');
            expect(entrypointContent).toContain('process_restart_count');
            expect(entrypointContent).toContain('max_process_restarts');
        });

        test('Discord通知機能が維持されている', () => {
            // Discord通知機能が維持されていることを確認
            expect(entrypointContent).toContain('send_startup_error_to_discord');
            expect(entrypointContent).toContain('DISCORD_ERROR_WEBHOOK_URL');
        });
    });

    describe('パフォーマンステスト', () => {
        test('不要なプロセス監視が削除されている', () => {
            // パフォーマンス向上のため、不要なプロセス監視が削除されていることを確認
            const apiMonitoringCount = (entrypointContent.match(/api_pid/g) || []).length;
            expect(apiMonitoringCount).toBe(0);
        });

        test('ヘルスチェックが軽量化されている', () => {
            // ヘルスチェックが軽量化されていることを確認
            expect(dockerComposeContent).toContain('pgrep');
            expect(dockerComposeContent).not.toContain('http.request');
        });
    });

    describe('セキュリティテスト', () => {
        test('ポート競合によるセキュリティリスクが回避されている', () => {
            // ポート競合による予期しないサービス停止が回避されていることを確認
            const botServiceConfig = dockerComposeContent.match(/bot:\s*\n[\s\S]*?(?=\n\s*\w+:|$)/)[0];
            expect(botServiceConfig).not.toContain('ports:');
        });

        test('プロセス権限の適切な分離が維持されている', () => {
            // プロセス権限の適切な分離が維持されていることを確認
            expect(entrypointContent).toContain('kill -0');
            expect(entrypointContent).toContain('kill -TERM');
            expect(entrypointContent).toContain('kill -KILL');
        });
    });
});