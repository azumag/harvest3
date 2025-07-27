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
    describe('Issue #5415: KISS原則簡素化後の重複防止機構', () => {
        test('Issue #5415: KISS原則簡素化によりRedis-basedコードが削除されシンプルなflock実装になっている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // KISS原則により複雑なRedis処理が削除されていることを確認
            expect(entrypointContent).not.toContain('Issue #5172: Redis-based重複防止関数（単一責任化・KISS原則）');
            expect(entrypointContent).not.toContain('redis_key="startup_msg:$message_hash"');
            expect(entrypointContent).not.toContain('const redis = require(\'redis\');');
            
            // シンプルなflock実装が使用されていることを確認
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            expect(entrypointContent).toContain('container: $(hostname)'); // コンテナ識別は残っている（ログメッセージで）
        });

        test('Issue #5415: KISS原則簡素化により複雑なRedis接続チェックが不要になっている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // 旧実装の複雑なRedis接続チェックが削除されていることを確認
            expect(entrypointContent).not.toContain('if [ "$redis_check_result" = "duplicate" ]; then');
            expect(entrypointContent).not.toContain('2>/dev/null || echo "error"');
            
            // シンプルなflock実装に簡素化されている
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
            expect(entrypointContent).toContain('Issue #5415: KISS原則に基づく簡素化');
        });

        test('Issue #5415: KISS原則簡素化によりTTL設定が不要になっている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // 旧実装の複雑なTTL設定が削除されていることを確認
            expect(entrypointContent).not.toContain('await client.setEx(key, $REDIS_DUPLICATE_PREVENTION_TTL, value);');
            
            // シンプルなflock実装でTTLが不要になったことを確認
            expect(entrypointContent).toContain('touch "$done_marker"');
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
            
            // hostnameがコンテナ識別に使用されていることをチェック（KISS原則簡素化後）
            expect(entrypointContent).toContain('container: $(hostname)');
            expect(entrypointContent).toContain('ホスト: $(hostname)');
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

        test('Issue #5415: KISS原則簡素化により複雑なプロセス内重複防止が削除されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // 旧実装の複雑なプロセス内重複防止（第二防御線）が削除されていることを確認
            expect(entrypointContent).not.toContain('プロセス内重複防止（第二防御線）');
            expect(entrypointContent).not.toContain('if [ "${!var_name}" = "1" ]; then');
            
            // シンプルなflock実装のみが使用されていることを確認
            expect(entrypointContent).toContain('flock -n 200 || exit 0');
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