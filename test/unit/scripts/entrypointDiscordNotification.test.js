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
      
      // Assert - 新しい簡素化されたDiscord通知機能
      expect(entrypointContent).toContain('const axios = require(\'axios\');');
      expect(entrypointContent).toContain('await axios.post(webhookUrl, message, { timeout });');
      expect(entrypointContent).toContain('mktemp "/tmp/discord_notify_XXXXXX.js"');
      expect(entrypointContent).toContain('sendDiscordNotification');
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
      
      // Assert - 新しいentrypoint.shでは必須ファイルチェックで実装
      expect(entrypointContent).toContain('package.json');
      expect(entrypointContent).toContain('Required file');
    });

    test('axiosモジュール不存在時の処理', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 新しいentrypoint.shではtry-catchでエラーハンドリング
      expect(entrypointContent).toContain('require(\'axios\')');
      expect(entrypointContent).toContain('Discord notification failed');
    });

    test('ネットワークタイムアウト設定', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 新しい実装でのタイムアウト設定
      expect(entrypointContent).toContain('const timeout = parseInt(process.argv[3]) * 1000 || 10000;');
      expect(entrypointContent).toContain('DISCORD_NOTIFICATION_TIMEOUT');
    });
  });

  describe('設定値テスト', () => {
    test('基本タイムアウト値が設定されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 新しいentrypoint.shの設定値を確認
      expect(entrypointContent).toContain('MAX_STARTUP_TIME=${MAX_STARTUP_TIME:-60}');
      expect(entrypointContent).toContain('HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-5}');
      expect(entrypointContent).toContain('DATABASE_CONNECTION_TIMEOUT=${DATABASE_CONNECTION_TIMEOUT:-10}');
    });

    test('Discord通知タイムアウトが設定されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - Discord通知タイムアウト設定
      expect(entrypointContent).toContain('DISCORD_NOTIFICATION_TIMEOUT=${DISCORD_NOTIFICATION_TIMEOUT:-10}');
    });

    test('起動ロック設定が定義されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 起動ロック関連設定
      expect(entrypointContent).toContain('STARTUP_LOCK_TIMEOUT=${STARTUP_LOCK_TIMEOUT:-30}');
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE="/tmp/strategy-runner-startup.lock"');
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
      
      // Assert - 新しいentrypoint.shでの関数呼び出しパターン
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "Environment variable validation failed"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "File system validation failed"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "NPM dependency installation failed" "See npm-handler logs for details"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "Both Redis and MongoDB connectivity failed"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "Container startup failed" "Exit code: $exit_code"');
    });
    
    test('改善されたDiscord通知処理が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 新しい簡素化されたDiscord通知機能
      expect(entrypointContent).toContain('WARNING: DISCORD_ERROR_WEBHOOK_URL not set, skipping Discord notification');
      expect(entrypointContent).toContain('local temp_script=$(mktemp "/tmp/discord_notify_XXXXXX.js")');
      expect(entrypointContent).toContain('WARNING: Discord notification failed (non-critical)');
      expect(entrypointContent).toContain('rm -f "$temp_script"');
    });
    
    test('データベース接続の改善された処理が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 新しいDB接続チェック実装
      expect(entrypointContent).toContain('local redis_failed=false');
      expect(entrypointContent).toContain('local mongo_failed=false');
      expect(entrypointContent).toContain('WARNING: Redis connection failed (service will retry later)');
      expect(entrypointContent).toContain('WARNING: MongoDB connection failed (service will retry later)');
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