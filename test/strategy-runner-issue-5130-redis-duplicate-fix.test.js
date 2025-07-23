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
        test('Redis keyの形式が適切に実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // Redis keyの形式が適切に実装されているかチェック
            expect(entrypointContent).toContain('redis_key="startup_msg:$message_hash"');
            
            // ハッシュ値の生成にget_message_hash関数が使用されているかチェック
            expect(entrypointContent).toContain('message_hash=$(get_message_hash "$message")');
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

        test('ファイルベース重複防止機構が保持されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // 既存のファイルベース機構が保持されているかチェック（リファクタリング後）
            expect(entrypointContent).toContain('fallback_to_file_based_prevention');
            expect(entrypointContent).toContain('success_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.done"');
        });
    });

    describe('修正の統合性確認', () => {
        test('Redis-based防止が第一防御線として位置している', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // リファクタリング後は戦略パターンで実装
            expect(entrypointContent).toContain('try_redis_duplicate_prevention');
            expect(entrypointContent).toContain('fallback_to_file_based_prevention');
            
            // 戦略選択の実装を確認
            expect(entrypointContent).toContain('case "$DUPLICATE_PREVENTION_STRATEGY" in');
            expect(entrypointContent).toContain('"redis_first"');
        });

        test('Redis処理の流れが適切に実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // リファクタリング後はtry_redis_duplicate_prevention関数内で処理
            const redisFunction = entrypointContent.match(/try_redis_duplicate_prevention\(\) \{[\s\S]*?\n\}/);
            expect(redisFunction).toBeTruthy();
            
            const functionBody = redisFunction[0];
            
            // Redis処理の各ステップが存在することを確認
            expect(functionBody).toContain('redis_key="startup_msg:$message_hash"');
            expect(functionBody).toContain('container_id=$(hostname)');
            expect(functionBody).toContain('redis_check_result=$(node -e');
        });
    });

    describe('エラーハンドリングの確認', () => {
        test('Redis接続失敗時のフォールバック処理が実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // リファクタリング後はtry_redis_duplicate_prevention関数でエラーハンドリング
            const redisFunction = entrypointContent.match(/try_redis_duplicate_prevention\(\) \{[\s\S]*?\n\}/);
            expect(redisFunction).toBeTruthy();
            
            const functionBody = redisFunction[0];
            
            // Redis エラーハンドリングとフォールバックの実装を確認
            expect(functionBody).toContain('return 1  # Redis不可またはエラー、フォールバックが必要');
            
            // メイン関数でフォールバック処理を確認
            expect(entrypointContent).toContain('fallback_to_file_based_prevention');
        });
    });

    describe('Issue #5130 特有の要件確認', () => {
        test('Docker restart policyによる重複実行への対応が実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // Issue #5130の機能が実装されていることをチェック（リファクタリング後は#5172に統合）
            // expect(entrypointContent).toContain('Issue #5130');  // リファクタリング後は統合されたため削除
            // リファクタリング後は Redis 重複防止機能は Issue #5172 の関数に統合
            expect(entrypointContent).toContain('try_redis_duplicate_prevention');
        });

        test('コンテナ識別情報によるデバッグ性向上が実装されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // コンテナとプロセスの識別情報が含まれているかチェック
            expect(entrypointContent).toContain('container: $(hostname)');
            expect(entrypointContent).toContain('pid: $$');
        });
    });
});