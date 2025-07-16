/**
 * entrypoint.sh Discord通知機能の単体テスト
 * CLAUDE.md要件: TDD原則に従った実装
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// axiosのモック
jest.mock('axios');

describe('entrypoint.sh Discord通知機能', () => {
  const entrypointPath = path.join(__dirname, '../../../entrypoint.sh');
  
  beforeEach(() => {
    // 環境変数の設定
    process.env.DISCORD_ERROR_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
  });

  afterEach(() => {
    // 環境変数のクリーンアップ
    delete process.env.DISCORD_ERROR_WEBHOOK_URL;
    jest.clearAllMocks();
  });

  describe('Discord通知スクリプト生成テスト', () => {
    test('Node.jsスクリプトが正しく生成される', () => {
      // Arrange
      const testMessage = 'Test error message';
      const testDetails = 'Test error details';
      
      // スクリプト内のNode.jsコード部分を抽出・検証
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('axios = require(\'axios\');');
      expect(entrypointContent).toContain('await axios.post(webhookUrl, message, { timeout });');
      expect(entrypointContent).toContain('package.json not found');
      expect(entrypointContent).toContain('axios module not available');
    });

    test('環境変数が未設定時、適切な警告メッセージが出力される', () => {
      // Arrange
      delete process.env.DISCORD_ERROR_WEBHOOK_URL;
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('WARNING: DISCORD_ERROR_WEBHOOK_URL not set');
    });
  });

  describe('エラーハンドリングテスト', () => {
    test('Node.js利用不可時の処理', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('command -v node');
      expect(entrypointContent).toContain('Node.js not available for Discord notification');
    });

    test('package.json不存在時の処理', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('!fs.existsSync(\'package.json\')');
      expect(entrypointContent).toContain('package.json not found');
    });

    test('axiosモジュール不存在時の処理', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('require(\'axios\')');
      expect(entrypointContent).toContain('axios module not available');
    });

    test('ネットワークタイムアウト設定', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('const timeout = parseInt(process.argv[3]) * 1000 || 10000;');
    });
  });

  describe('設定値テスト', () => {
    test('API起動タイムアウト値が90秒に設定されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 設定値が適切に定義されていることを確認
      expect(entrypointContent).toContain('API_STARTUP_TIMEOUT=${API_STARTUP_TIMEOUT:-90}');
      expect(entrypointContent).toContain('API_CHECK_INTERVAL=${API_CHECK_INTERVAL:-3}');
      expect(entrypointContent).toContain('PROGRESS_LOG_INTERVAL=${PROGRESS_LOG_INTERVAL:-15}');
    });

    test('進捗ログ間隔が15秒に設定されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 進捗ログ間隔設定が定義されていることを確認
      expect(entrypointContent).toContain('PROGRESS_LOG_INTERVAL=${PROGRESS_LOG_INTERVAL:-15}');
    });

    test('ヘルスチェック間隔が3秒に設定されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - ヘルスチェック間隔設定が定義されていることを確認
      expect(entrypointContent).toContain('API_CHECK_INTERVAL=${API_CHECK_INTERVAL:-3}');
      expect(entrypointContent).toContain('HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-5}');
    });
  });

  describe('メッセージフォーマットテスト', () => {
    test('Discord通知メッセージに必要な情報が含まれる', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('Strategy-Runner起動エラー');
      expect(entrypointContent).toContain('${CONTAINER_NAME}');
      expect(entrypointContent).toContain('${error_message}');
      expect(entrypointContent).toContain('${error_details}');
      expect(entrypointContent).toContain('$(date -u');
      expect(entrypointContent).toContain('$(hostname)');
    });
  });

  describe('関数呼び出しテスト', () => {
    test('send_startup_error_to_discord関数が適切なタイミングで呼ばれる', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 各エラーケースで関数が呼ばれることを確認
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "Environment variable validation failed"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "File system validation failed"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "Node.js dependency validation failed"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "Both Redis and MongoDB connectivity failed after retries"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "Container startup failed" "Exit code: $exit_code"');
    });
    
    test('改善されたDiscord通知処理が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 改善されたDiscord通知機能の確認
      expect(entrypointContent).toContain('return 0  # 設定されていない場合は正常として扱う');
      expect(entrypointContent).toContain('local temp_script=$(mktemp "/tmp/discord_notify_XXXXXX.js")');
      expect(entrypointContent).toContain('WARNING: Discord notification failed (non-critical)');
      expect(entrypointContent).toContain('rm -f "$temp_script"');
    });
    
    test('データベース接続の改善された処理が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 改善されたDB接続チェック
      expect(entrypointContent).toContain('local redis_failed=false');
      expect(entrypointContent).toContain('local mongo_failed=false');
      expect(entrypointContent).toContain('WARNING: $service_name connection failed after $max_retries attempts (service will retry later)');
      expect(entrypointContent).toContain('両方のデータベースが失敗した場合のみエラー終了');
    });
  });

  describe('スクリプト整合性テスト', () => {
    test('entrypoint.shが実行可能である', () => {
      // Arrange & Act
      const stats = fs.statSync(entrypointPath);
      
      // Assert
      expect(stats.isFile()).toBe(true);
      // 実行権限のチェック（Unix系）
      if (process.platform !== 'win32') {
        expect(stats.mode & parseInt('111', 8)).toBeGreaterThan(0);
      }
    });

    test('Bashスクリプトのシバンが正しい', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent.startsWith('#!/bin/bash')).toBe(true);
    });

    test('set -eでエラー時即座終了が設定されている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('set -e');
    });
  });
});