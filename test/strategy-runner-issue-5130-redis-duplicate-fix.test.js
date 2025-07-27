/**
 * テストファイル: Strategy-runner Issue #5130 Redis-based重複ログメッセージ修正
 * 
 * Issue #5130の修正内容をテスト：
 * - Redis-basedの重複防止機構（コンテナ間での重複防止）
 * - Dockerのrestart policy対応
 * - コンテナ識別情報を含むログメッセージ
 */

const fs = require('fs');
const path = require('path');

// エントリーポイントファイルのパス
const ENTRYPOINT_PATH = path.join(__dirname, '..', 'entrypoint.sh');

describe('Issue #5130: Strategy-runner Redis-based重複ログメッセージ修正', () => {
    describe('Redis-based重複防止機構', () => {
        test('Redis-basedコードが追加されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // Redis-based duplicate prevention の実装がコメント付きで追加されているかチェック（リファクタリング後）
            expect(entrypointContent).toContain('Issue #5172: Redis-based重複防止関数（単一責任化・KISS原則）');
            
            // Redis関連の処理が追加されているかチェック
            expect(entrypointContent).toContain('redis_key="startup_msg:$message_hash"');
            expect(entrypointContent).toContain('container_id=$(hostname)');
            expect(entrypointContent).toContain('const redis = require(\'redis\');');
        });

        test('Redis接続チェック処理が適切に実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // Redisの利用可能性チェックが実装されているかチェック
            expect(entrypointContent).toContain('command -v node >/dev/null 2>&1');
            expect(entrypointContent).toContain('[ -n "$REDIS_URL" ]');
            
            // Redis処理のエラーハンドリングが実装されているかチェック
            expect(entrypointContent).toContain('2>/dev/null || echo "error"');
            expect(entrypointContent).toContain('if [ "$redis_check_result" = "duplicate" ]; then');
        });

        test('RedisのTTL設定が適切に実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // 設定可能なTTLが設定されているかチェック（リファクタリング後）
            expect(entrypointContent).toContain('await client.setEx(key, $REDIS_DUPLICATE_PREVENTION_TTL, value);');
        });
    });

    describe('コンテナ識別機能', () => {
        test('ログメッセージにコンテナIDとPIDが含まれる', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // コンテナ識別情報を含むログメッセージが使用されているかチェック
            expect(entrypointContent).toContain('Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)');
        });

        test('コンテナIDの取得にhostnameが使用されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // container_idの設定でhostnameコマンドが使用されているかチェック
            expect(entrypointContent).toContain('container_id=$(hostname)');
        });
    });

    describe('ハッシュベースキー生成の確認', () => {
        test('Issue #5415: KISS原則簡素化によりシンプルなflock実装が適用されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // KISS原則によるシンプルなflock実装が適用されているかチェック
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            expect(entrypointContent).toContain('done_marker="$LOCK_BASE_DIR/main-startup-message.done"');
            
            // get_message_hash関数は他の機能で使用されているが、複雑な重複防止では使用されない
            expect(entrypointContent).toContain('get_message_hash()');
        });
    });

    describe('既存の機能への影響確認', () => {
        test('backtest modeでは従来の関数が呼ばれる', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // backtest mode での分岐が保持されているかチェック
            const logStartupMessageFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/);
            expect(logStartupMessageFunction).toBeTruthy();
            expect(logStartupMessageFunction[0]).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
            expect(logStartupMessageFunction[0]).toContain('log_backtest_startup_message "$message"');
        });

        test('プロセス内環境変数による重複防止機構が保持されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // 既存の第二防御線が保持されているかチェック（リファクタリング後）
            expect(entrypointContent).toContain('プロセス内重複防止（第二防御線）');
            expect(entrypointContent).toContain('if [ "${!var_name}" = "1" ]; then');
        });

        test('Issue #5415: KISS原則簡素化によりシンプルなflock実装が保持されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // KISS原則によるシンプルなflock実装が保持されているかチェック
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            expect(entrypointContent).toContain('touch "$done_marker"');
            
            // 旧実装の複雑な機能がメインフローで使用されていないことを確認
            // KISS原則により簡素化されたflock実装が優先使用されることを確認
            const logStartupMessageFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/);
            if (logStartupMessageFunction) {
              expect(logStartupMessageFunction[0]).not.toContain('fallback_to_file_based_prevention');
            }
        });
    });

    describe('修正の統合性確認', () => {
        test('Issue #5415: KISS原則簡素化によりシンプルなflock実装が第一防御線として機能している', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // KISS原則によるシンプルなflock実装が第一防御線として機能
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            expect(entrypointContent).toContain('[ -f "$done_marker" ] && exit 0');
            
            // 旧実装の複雑な戦略パターンがメインフローで使用されていないことを確認
            // KISS原則により簡素化されたflock実装が優先使用されることを確認
            const logStartupMessageFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/);
            if (logStartupMessageFunction) {
              expect(logStartupMessageFunction[0]).not.toContain('try_redis_duplicate_prevention');
              expect(logStartupMessageFunction[0]).not.toContain('DUPLICATE_PREVENTION_STRATEGY');
            }
        });

        test('Issue #5415: KISS原則簡素化によりflock処理の流れが適切に実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // KISS原則によるシンプルなflock実装の流れ
            expect(entrypointContent).toContain('case "$message" in');
            expect(entrypointContent).toContain('*"Starting strategy-runner container with enhanced error handling"*)');
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            expect(entrypointContent).toContain('log "$message"');
            expect(entrypointContent).toContain('touch "$done_marker"');
            
            // 旧実装の複雑なRedis関数がメインフローで使用されていないことを確認
            // KISS原則により簡素化されたflock実装が優先使用されることを確認
            const logStartupMessageFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/);
            if (logStartupMessageFunction) {
              expect(logStartupMessageFunction[0]).not.toContain('try_redis_duplicate_prevention');
              expect(logStartupMessageFunction[0]).not.toContain('redis_check_result');
            }
        });
    });

    describe('エラーハンドリングの確認', () => {
        test('Issue #5415: KISS原則簡素化によりシンプルで確実なflock実装が提供されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // KISS原則により複雑なRedisエラーハンドリングが不要になり、シンプルなflock実装
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            expect(entrypointContent).toContain('[ -f "$done_marker" ] && exit 0');
            
            // その他のメッセージは通常のログ処理
            expect(entrypointContent).toContain('# その他のメッセージは通常のログ処理');
            expect(entrypointContent).toContain('log "$message"');
            
            // 旧実装の複雑なフォールバック処理が削除されていることを確認
            expect(entrypointContent).not.toContain('try_redis_duplicate_prevention');
            expect(entrypointContent).not.toContain('fallback_to_file_based_prevention');
        });
    });

    describe('Issue #5130 特有の要件確認', () => {
        test('Issue #5415: KISS原則簡素化によりシンプルで確実な重複防止が実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // Issue #5415: KISS原則によるシンプルなflock実装
            expect(entrypointContent).toContain('Issue #5415: KISS原則に基づく簡素化');
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            
            // 旧実装の複雑なRedis処理が削除されていることを確認
            expect(entrypointContent).not.toContain('try_redis_duplicate_prevention');
        });

        test('コンテナ識別情報によるデバッグ性向上が実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // コンテナとプロセスの識別情報が含まれているかチェック
            expect(entrypointContent).toContain('container: $(hostname)');
            expect(entrypointContent).toContain('pid: $$');
        });
    });
});