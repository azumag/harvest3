/**
 * Issue #5362: strategy-runnerサービス重複起動メッセージ修正のテスト
 * 
 * KISS原則に基づくシンプルで確実な重複防止機構のテスト
 * - flockベースのファイルロック
 * - プロセス内変数による即座の重複防止
 * - フォールバック機構（mkdirベースロック）
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Issue #5362: strategy-runner重複起動メッセージ修正', () => {
    let tempDir;
    let entrypointPath;
    let lockBaseDir;

    beforeEach(() => {
        // 一時ディレクトリの作成
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-runner-issue-5362-'));
        lockBaseDir = path.join(tempDir, 'locks');
        fs.mkdirSync(lockBaseDir, { recursive: true });
        
        // entrypoint.shのパスを設定
        entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
        
        expect(fs.existsSync(entrypointPath)).toBe(true);
    });

    afterEach(() => {
        // 一時ディレクトリのクリーンアップ
        if (tempDir && fs.existsSync(tempDir)) {
            execSync(`rm -rf "${tempDir}"`, { stdio: 'ignore' });
        }
    });

    /**
     * テスト1: 単一プロセスでの正常な起動メッセージ出力
     */
    test('単一プロセスで正常に起動メッセージが出力される', () => {
        const testScript = `
            export LOCK_BASE_DIR="${lockBaseDir}"
            export BACKTEST_MODE="false"
            source "${entrypointPath}"
            
            # log_startup_message関数をテスト
            log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: 12345)"
        `;
        
        const result = execSync(`bash -c '${testScript}'`, { 
            encoding: 'utf8',
            env: { ...process.env, LOCK_BASE_DIR: lockBaseDir, BACKTEST_MODE: 'false' }
        });
        
        // 起動メッセージが出力されることを確認
        expect(result).toContain('Starting strategy-runner container with enhanced error handling');
        expect(result).toContain('DEBUG: Acquired flock, outputting startup message (Issue #5362 fix)');
    });

    /**
     * テスト2: 同一プロセス内での重複防止（プロセス内変数）
     */
    test('同一プロセス内で重複メッセージが防止される', () => {
        const testScript = `
            export LOCK_BASE_DIR="${lockBaseDir}"
            export BACKTEST_MODE="false"
            source "${entrypointPath}"
            
            # 1回目の呼び出し
            log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: 12345)"
            echo "=== SEPARATOR ==="
            
            # 2回目の呼び出し（同一プロセス内）
            log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: 12345)"
        `;
        
        const result = execSync(`bash -c '${testScript}'`, { 
            encoding: 'utf8',
            env: { ...process.env, LOCK_BASE_DIR: lockBaseDir, BACKTEST_MODE: 'false' }
        });
        
        const lines = result.split('\n');
        const startupMessages = lines.filter(line => 
            line.includes('Starting strategy-runner container with enhanced error handling') &&
            !line.includes('DEBUG:')
        );
        
        // 実際の起動メッセージは1回のみ出力されることを確認
        expect(startupMessages).toHaveLength(1);
        
        // 2回目は重複防止されることを確認
        expect(result).toContain('DEBUG: Process flag prevented duplicate startup message (Issue #5362 fix)');
    });

    /**
     * テスト3: flockが利用できない環境でのフォールバック機構
     */
    test('flockが利用できない場合はmkdirベースロックにフォールバック', () => {
        const testScript = `
            export LOCK_BASE_DIR="${lockBaseDir}"
            export BACKTEST_MODE="false"
            export PATH="/bin:/usr/bin"  # flockを除外
            source "${entrypointPath}"
            
            # flockコマンドを無効化
            function flock() { return 127; }
            function command() { 
                if [ "$1" = "-v" ] && [ "$2" = "flock" ]; then
                    return 1  # flockが見つからない
                fi
                /usr/bin/command "$@"
            }
            
            log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: 12345)"
        `;
        
        const result = execSync(`bash -c '${testScript}'`, { 
            encoding: 'utf8',
            env: { ...process.env, LOCK_BASE_DIR: lockBaseDir, BACKTEST_MODE: 'false' }
        });
        
        // mkdirベースロックが使用されることを確認
        expect(result).toContain('DEBUG: Acquired mkdir lock, outputting startup message (Issue #5362 fix)');
        expect(result).toContain('Starting strategy-runner container with enhanced error handling');
    });

    /**
     * テスト4: バックテストモードでの正常動作
     */
    test('バックテストモードで適切に処理される', () => {
        const testScript = `
            export LOCK_BASE_DIR="${lockBaseDir}"
            export BACKTEST_MODE="true"
            source "${entrypointPath}"
            
            # バックテスト用のメッセージ関数を定義
            function log_backtest_startup_message() {
                echo "BACKTEST: $1"
                export _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            }
            
            log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: 12345)"
        `;
        
        const result = execSync(`bash -c '${testScript}'`, { 
            encoding: 'utf8',
            env: { ...process.env, LOCK_BASE_DIR: lockBaseDir, BACKTEST_MODE: 'true' }
        });
        
        // バックテスト関数が呼ばれることを確認
        expect(result).toContain('BACKTEST: Starting strategy-runner container with enhanced error handling');
    });

    /**
     * テスト5: 並行実行時の重複防止（ファイルロック）
     */
    test('並行実行時にファイルロックにより重複が防止される', (done) => {
        const numProcesses = 3;
        const results = [];
        let completedProcesses = 0;

        for (let i = 0; i < numProcesses; i++) {
            const testScript = `
                export LOCK_BASE_DIR="${lockBaseDir}"
                export BACKTEST_MODE="false"
                source "${entrypointPath}"
                
                # プロセス内変数をリセット（異なるプロセスをシミュレート）
                unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
                
                log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container-${i}, pid: $$)"
            `;

            const child = spawn('bash', ['-c', testScript], {
                env: { ...process.env, LOCK_BASE_DIR: lockBaseDir, BACKTEST_MODE: 'false' },
                stdio: 'pipe'
            });

            let output = '';
            child.stdout.on('data', (data) => {
                output += data.toString();
            });

            child.stderr.on('data', (data) => {
                output += data.toString();
            });

            child.on('close', () => {
                results.push(output);
                completedProcesses++;

                if (completedProcesses === numProcesses) {
                    // 実際の起動メッセージの出力回数をカウント
                    const allOutput = results.join('\n');
                    const startupMessages = allOutput.split('\n').filter(line => 
                        line.includes('Starting strategy-runner container with enhanced error handling') &&
                        !line.includes('DEBUG:')
                    );

                    // 複数プロセスでも起動メッセージは1回のみ出力されることを確認
                    expect(startupMessages.length).toBeLessThanOrEqual(1);
                    
                    // いずれかのプロセスで正常に出力されることを確認
                    expect(startupMessages.length).toBeGreaterThan(0);
                    
                    done();
                }
            });
        }
    }, 10000); // 10秒タイムアウト

    /**
     * テスト6: その他のメッセージの正常処理
     */
    test('strategy-runner以外のメッセージは正常に処理される', () => {
        const testScript = `
            export LOCK_BASE_DIR="${lockBaseDir}"
            export BACKTEST_MODE="false"
            source "${entrypointPath}"
            
            # 一般的なメッセージをテスト
            log_startup_message "Some other startup message"
            log_startup_message "Another regular message"
        `;
        
        const result = execSync(`bash -c '${testScript}'`, { 
            encoding: 'utf8',
            env: { ...process.env, LOCK_BASE_DIR: lockBaseDir, BACKTEST_MODE: 'false' }
        });
        
        // その他のメッセージは通常通り出力されることを確認
        expect(result).toContain('Some other startup message');
        expect(result).toContain('Another regular message');
    });

    /**
     * テスト補助: ロックファイルの状態確認
     */
    afterEach(() => {
        // テスト後のロックファイルの状態をチェック
        const lockFiles = fs.readdirSync(lockBaseDir, { withFileTypes: true })
            .filter(dirent => dirent.name.includes('startup-message'))
            .map(dirent => dirent.name);
        
        // 一時的なロックファイルが残っていないことを確認
        lockFiles.forEach(lockFile => {
            if (lockFile.includes('.tmp')) {
                console.warn(`Warning: Temporary lock file found: ${lockFile}`);
            }
        });
    });
});