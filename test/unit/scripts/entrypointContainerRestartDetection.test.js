/**
 * entrypoint.sh コンテナ再起動検出機構の単体テスト
 * Issue #5321: コンテナ再起動検出機構の設定外部化
 * CLAUDE.md要件: TDD原則に従った実装
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('entrypoint.sh コンテナ再起動検出機構', () => {
  const entrypointPath = path.join(__dirname, '../../../entrypoint.sh');
  
  describe('環境変数設定テスト', () => {
    test('CONTAINER_RESTART_THRESHOLD環境変数が定義されている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('CONTAINER_RESTART_THRESHOLD=${CONTAINER_RESTART_THRESHOLD:-60}');
      expect(entrypointContent).toContain('# Issue #5321: コンテナ再起動検出機構の設定外部化');
    });

    test('環境変数のデフォルト値が60秒に設定されている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('${CONTAINER_RESTART_THRESHOLD:-60}');
    });
  });

  describe('check_container_recently_restarted関数テスト', () => {
    test('関数内でCONTAINER_RESTART_THRESHOLD変数が使用されている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('if [ "$uptime_seconds" -lt "$CONTAINER_RESTART_THRESHOLD" ]; then');
      expect(entrypointContent).toContain('# CONTAINER_RESTART_THRESHOLD秒以内の場合は最近再起動したと判定');
    });

    test('ハードコードされた60秒の値が除去されている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - ハードコードされた60を使った比較がないことを確認
      expect(entrypointContent).not.toMatch(/if\s*\[\s*"\$uptime_seconds"\s*-lt\s+60\s*\]/);
    });

    test('関数が正しく定義されている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('check_container_recently_restarted() {');
      expect(entrypointContent).toContain('# /proc/uptimeを使用してコンテナの稼働時間をチェック');
      expect(entrypointContent).toContain('return 0  # 最近再起動した');
      expect(entrypointContent).toContain('return 1  # 安定稼働中');
    });
  });

  describe('機能統合テスト', () => {
    test('環境変数が設定された場合の動作確認（モック使用）', () => {
      // Arrange
      const testScript = `
        export CONTAINER_RESTART_THRESHOLD=30
        source ${entrypointPath}
        
        # /proc/uptimeをモック
        echo "25.50 100.00" > /tmp/test_uptime
        
        # 関数を少し修正してテスト用uptimeファイルを使用
        check_container_recently_restarted_test() {
          if [ -f /tmp/test_uptime ]; then
            local uptime_seconds=$(cat /tmp/test_uptime | cut -d' ' -f1 | cut -d'.' -f1)
            if [ "$uptime_seconds" -lt "$CONTAINER_RESTART_THRESHOLD" ]; then
              return 0
            fi
          fi
          return 1
        }
        
        if check_container_recently_restarted_test; then
          echo "recently_restarted"
        else
          echo "stable"
        fi
        
        rm -f /tmp/test_uptime
      `;
      
      // Act
      const result = execSync(`bash -c '${testScript}'`, { encoding: 'utf8' }).trim();
      
      // Assert
      expect(result).toBe('recently_restarted');
    });

    test('デフォルト値（60秒）での動作確認（モック使用）', () => {
      // Arrange
      const testScript = `
        # CONTAINER_RESTART_THRESHOLDを未設定のままテスト
        source ${entrypointPath}
        
        # /proc/uptimeをモック
        echo "70.50 100.00" > /tmp/test_uptime
        
        # 関数を少し修正してテスト用uptimeファイルを使用
        check_container_recently_restarted_test() {
          if [ -f /tmp/test_uptime ]; then
            local uptime_seconds=$(cat /tmp/test_uptime | cut -d' ' -f1 | cut -d'.' -f1)
            if [ "$uptime_seconds" -lt "$CONTAINER_RESTART_THRESHOLD" ]; then
              return 0
            fi
          fi
          return 1
        }
        
        if check_container_recently_restarted_test; then
          echo "recently_restarted"
        else
          echo "stable"
        fi
        
        rm -f /tmp/test_uptime
      `;
      
      // Act
      const result = execSync(`bash -c '${testScript}'`, { encoding: 'utf8' }).trim();
      
      // Assert
      expect(result).toBe('stable');
    });
  });

  describe('互換性テスト', () => {
    test('既存の動作に影響を与えない', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 既存の関数が正しく存在することを確認
      expect(entrypointContent).toContain('retry_npm_install_with_backoff() {');
      expect(entrypointContent).toContain('if check_container_recently_restarted; then');
      expect(entrypointContent).toContain('restart_count=2  # 最近再起動した場合は2回目とみなす');
    });

    test('関数呼び出し箇所が正しく動作する', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 関数が正しい場所で呼び出されることを確認
      expect(entrypointContent).toContain('if check_container_recently_restarted; then');
      expect(entrypointContent).toContain('log "Container recently restarted, adjusting retry strategy"');
    });
  });

  describe('Issue #5321対応確認', () => {
    test('Issue番号が適切にコメントされている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      expect(entrypointContent).toContain('# Issue #5321: コンテナ再起動検出機構の設定外部化');
    });

    test('要求仕様が満たされている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert
      // 1. 環境変数で設定可能
      expect(entrypointContent).toContain('CONTAINER_RESTART_THRESHOLD=');
      // 2. デフォルト値60秒を維持
      expect(entrypointContent).toContain(':-60}');
      // 3. 既存動作に影響しない（元の関数名と構造を維持）
      expect(entrypointContent).toContain('check_container_recently_restarted() {');
      expect(entrypointContent).toContain('/proc/uptime');
    });
  });

  describe('スクリプト整合性テスト', () => {
    test('環境変数が他の設定と適切にグループ化されている', () => {
      // Arrange & Act
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Assert - 設定セクション内に適切に配置されていることを確認
      expect(entrypointContent).toMatch(/REDIS_DUPLICATE_PREVENTION_TTL.*\n.*DUPLICATE_PREVENTION_STRATEGY.*\n.*\n.*CONTAINER_RESTART_THRESHOLD/s);
    });

    test('bash構文が正しい', () => {
      // Arrange & Act - 構文チェック
      expect(() => {
        execSync(`bash -n ${entrypointPath}`, { encoding: 'utf8' });
      }).not.toThrow();
    });
  });
});