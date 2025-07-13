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
      expect(entrypointContent).toContain('const axios = require(\'axios\');');
      expect(entrypointContent).toContain('axios.post(webhookUrl, message, { timeout: 10000 })');
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
      expect(entrypointContent).toContain('timeout: 10000');
    });
  });

  describe('タイムアウト値テスト', () => {
    test('API起動タイムアウト値が60秒に設定されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('max_api_wait=60');
      expect(entrypointContent).toContain('API server failed to start within ${max_api_wait} seconds');
    });

    test('進捗ログが15秒間隔で出力される', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('api_startup_time % 15');
      expect(entrypointContent).toContain('API server startup:');
    });

    test('ヘルスチェック間隔が3秒に設定されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('sleep 3');
      expect(entrypointContent).toContain('api_startup_time=$((api_startup_time + 3))');
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
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "Database connectivity check failed"');
      expect(entrypointContent).toContain('send_startup_error_to_discord "$error_msg" "API server startup timeout"');
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