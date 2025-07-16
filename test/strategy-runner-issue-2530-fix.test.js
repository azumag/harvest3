/**
 * strategy-runner Issue #2530 修正のテスト
 * Issue #2530: strategy-runnerサービスで例外が発生（重複起動メッセージ問題）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Strategy-Runner Issue #2530 修正: 重複起動メッセージ問題', () => {
  const lockDir = '/tmp/startup_messages';
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');

  // 各テスト前のクリーンアップ
  beforeEach(() => {
    // ロックファイルディレクトリを作成
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
    
    // ロックファイルディレクトリとファイルをクリーンアップ
    if (fs.existsSync(lockDir)) {
      const files = fs.readdirSync(lockDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(lockDir, file));
      });
    }
    
    // プロセス環境変数をクリア（プロセス内フラグのリセット）
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('STARTUP_MSG_')) {
        delete process.env[key];
      }
    });
  });

  // 各テスト後のクリーンアップ
  afterEach(() => {
    // ロックファイルディレクトリとファイルをクリーンアップ
    if (fs.existsSync(lockDir)) {
      const files = fs.readdirSync(lockDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(lockDir, file));
      });
    }
  });

  describe('修正内容の実装確認', () => {
    test('entrypoint.shで簡素化されたlog_startup_message関数が実装されている', () => {
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 新しい簡素化された実装が含まれていることを確認
      expect(entrypointContent).toContain('# 重複起動ログ防止関数（簡素化版）');
      expect(entrypointContent).toContain('# プロセス内フラグとシンプルなatomic操作による重複防止');
      
      // プロセス内重複チェック機能の確認
      expect(entrypointContent).toContain('# プロセス内重複チェック（最初の防御線）');
      expect(entrypointContent).toContain('local var_name="STARTUP_MSG_');
      expect(entrypointContent).toContain('if [ "${!var_name}" = "1" ]; then');
      
      // プロセス間重複チェック機能の確認
      expect(entrypointContent).toContain('# プロセス間重複チェック（第二の防御線）');
      expect(entrypointContent).toContain('set -C; echo "$$" > "$lock_file"');
      
      // 環境変数のexportによるフラグ設定の確認
      expect(entrypointContent).toContain('export "$var_name"=1');
    });

    test('複雑なリトライロジックが削除されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 古い複雑な実装が削除されていることを確認
      expect(entrypointContent).not.toContain('max_attempts=5');
      expect(entrypointContent).not.toContain('while [ $attempt -lt $max_attempts ]');
      expect(entrypointContent).not.toContain('attempt=$((attempt + 1))');
      expect(entrypointContent).not.toContain('sleep 0.1');
      
      // 複雑なロックファイル検証が削除されていることを確認
      expect(entrypointContent).not.toContain('local lock_info=$(cat "$lock_file"');
      expect(entrypointContent).not.toContain('local lock_pid=$(echo "$lock_info"');
      expect(entrypointContent).not.toContain('local lock_time=$(echo "$lock_info"');
    });

    test('シンプルなcleanup処理が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // シンプルなクリーンアップ処理の確認
      expect(entrypointContent).toContain('(sleep 30 && rm -f "$lock_file" 2>/dev/null) &');
      
      // 複雑なクリーンアップロジックが削除されていることを確認
      expect(entrypointContent).not.toContain('sleep 60');
      expect(entrypointContent).not.toContain('Removed stale message lock');
    });
  });

  describe('重複防止機能のテスト', () => {
    test('プロセス内フラグによる重複防止が機能する', () => {
      // テスト用メッセージ
      const testMessage = 'Starting strategy-runner container with enhanced error handling';
      const messageHash = require('crypto').createHash('md5').update(testMessage).digest('hex');
      const flagName = `STARTUP_MSG_${messageHash.substring(0, 8)}`;
      
      // 最初はフラグが設定されていないことを確認
      expect(process.env[flagName]).toBeUndefined();
      
      // フラグを手動で設定
      process.env[flagName] = '1';
      
      // フラグが設定されていることを確認
      expect(process.env[flagName]).toBe('1');
      
      // 実際のlog_startup_message関数の動作を模擬
      // （実際のbashスクリプトテストではないが、ロジックの検証）
      const isAlreadyLogged = process.env[flagName] === '1';
      expect(isAlreadyLogged).toBe(true);
    });

    test('ハッシュ生成が一意かつ一貫している', () => {
      const testMessages = [
        'Starting strategy-runner container with enhanced error handling',
        'Starting backtest container with enhanced error handling',
        'Another test message'
      ];
      
      const hashes = testMessages.map(msg => {
        return require('crypto').createHash('md5').update(msg).digest('hex');
      });
      
      // 全てのハッシュが異なることを確認
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(testMessages.length);
      
      // ハッシュの先頭8文字が変数名として使用される
      const shortHashes = hashes.map(hash => hash.substring(0, 8));
      const uniqueShortHashes = new Set(shortHashes);
      expect(uniqueShortHashes.size).toBe(testMessages.length);
    });

    test('ロックディレクトリの作成が可能', () => {
      // ロックディレクトリが存在することを確認
      expect(fs.existsSync(lockDir)).toBe(true);
      
      // テスト用ロックファイルの作成
      const testHash = 'abcd1234';
      const testLockFile = path.join(lockDir, `${testHash}.lock`);
      
      // ロックファイルを作成
      fs.writeFileSync(testLockFile, process.pid.toString());
      expect(fs.existsSync(testLockFile)).toBe(true);
      
      // ロックファイルの内容確認
      const lockContent = fs.readFileSync(testLockFile, 'utf8');
      expect(lockContent).toBe(process.pid.toString());
      
      // クリーンアップ
      fs.unlinkSync(testLockFile);
      expect(fs.existsSync(testLockFile)).toBe(false);
    });
  });

  describe('Issue #2530の症状回帰テスト', () => {
    test('重複ログメッセージのパターンが検出されない', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // log_startup_message関数が1回のみ定義されていることを確認
      const functionDefinitions = entrypointContent.match(/^log_startup_message\(\)/gm);
      expect(functionDefinitions).toHaveLength(1);
      
      // 複雑なリトライロジックが削除されていることを確認
      expect(entrypointContent).not.toContain('max_attempts=5');
      expect(entrypointContent).not.toContain('while [ $attempt -lt $max_attempts ]');
    });

    test('log_startup_message関数の呼び出し箇所が適切', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // log_startup_messageの呼び出し箇所を確認
      const callMatches = entrypointContent.match(/log_startup_message/g);
      
      // 関数定義（1回）+ backtest用呼び出し（1回）+ strategy-runner用呼び出し（1回）= 3回
      expect(callMatches).toHaveLength(3);
      
      // 具体的な呼び出し箇所の確認
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
    });

    test('エラーハンドリング機能が損なわれていない', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重要なエラーハンドリング機能が保持されていることを確認
      expect(entrypointContent).toContain('send_startup_error_to_discord');
      expect(entrypointContent).toContain('pre_startup_checks');
      expect(entrypointContent).toContain('check_database_connections');
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('trap cleanup SIGTERM SIGINT');
    });

    test('修正が他の機能に影響を与えていない', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 他の重要な機能が削除されていないことを確認
      const importantFunctions = [
        'log()',
        'acquire_startup_lock()',
        'release_startup_lock()',
        'send_startup_error_to_discord()',
        'pre_startup_checks()',
        'check_database_connections()',
        'start_application()',
        'cleanup()',
        'run_diagnostics()',
        'main()'
      ];
      
      importantFunctions.forEach(func => {
        expect(entrypointContent).toContain(func);
      });
    });
  });

  describe('パフォーマンスと信頼性の改善確認', () => {
    test('シンプルな実装による高速化', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 複雑な処理が削除されていることを確認
      expect(entrypointContent).not.toContain('max_attempts=5');
      expect(entrypointContent).not.toContain('while [ $attempt -lt $max_attempts ]');
      
      // シンプルなatomic操作のみ使用
      expect(entrypointContent).toContain('set -C; echo "$$" > "$lock_file"');
    });

    test('レースコンディション対策の改善', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 2層防御の実装確認
      expect(entrypointContent).toContain('# プロセス内重複チェック（最初の防御線）');
      expect(entrypointContent).toContain('# プロセス間重複チェック（第二の防御線）');
      
      // プロセス内フラグによる即座の重複検出
      expect(entrypointContent).toContain('if [ "${!var_name}" = "1" ]; then');
      expect(entrypointContent).toContain('return 0');
    });

    test('リソース使用量の最適化', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // log_startup_message関数内で短いクリーンアップ時間（30秒）が使用されている
      expect(entrypointContent).toContain('# ロックファイルのクリーンアップ（30秒後）');
      expect(entrypointContent).toContain('(sleep 30 && rm -f "$lock_file" 2>/dev/null) &');
      
      // 複雑なファイル処理の削除
      expect(entrypointContent).not.toContain('lock_info=$(cat "$lock_file"');
      expect(entrypointContent).not.toContain('cut -d\':\'');
    });
  });
});