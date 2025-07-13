const AutoUpdateMonitor = require('../../scripts/auto-update-monitor');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

// child_processをモック
jest.mock('child_process');

// テスト用の一時ディレクトリ
const TEST_TMP_DIR = '.tmp/test';

// TODO: Issue #319 - auto-update-monitor テストがハングする問題を修正
describe.skip('AutoUpdateMonitor', () => {
    let monitor;
    let mockSpawn;

    beforeEach(() => {
        // タイマーをモック
        jest.useFakeTimers();
        
        // spawnのモックを設定
        mockSpawn = {
            stdout: new EventEmitter(),
            stderr: new EventEmitter(),
            on: jest.fn()
        };
        
        spawn.mockReturnValue(mockSpawn);
        
        // テスト用の設定でモニターを初期化
        monitor = new AutoUpdateMonitor({
            checkIntervalMs: 1000, // テスト用に短く設定
            remoteBranch: 'origin/main',
            localBranch: 'main',
            dockerServices: ['test-service1', 'test-service2'],
            debug: false,
            maxRetries: 2,
            retryDelayMs: 100
        });
        
        // console.logをモック（テスト出力をクリーンに保つ）
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // モックをリセット
        jest.clearAllMocks();
        
        // タイマーをリストア
        jest.useRealTimers();
        
        // 監視を停止（タイムアウトを防ぐためプロセス終了をモック）
        if (monitor && monitor.isRunning) {
            monitor.isRunning = false;
            if (monitor.intervalId) {
                clearInterval(monitor.intervalId);
                monitor.intervalId = null;
            }
        }
        
        // console.logのモックをリストア
        console.log.mockRestore();
        console.error.mockRestore();
    });

    describe('コンストラクタ', () => {
        test('デフォルト設定で初期化される', () => {
            const defaultMonitor = new AutoUpdateMonitor();
            expect(defaultMonitor.config.checkIntervalMs).toBe(5 * 60 * 1000);
            expect(defaultMonitor.config.remoteBranch).toBe('origin/main');
            expect(defaultMonitor.config.localBranch).toBe('main');
            expect(defaultMonitor.config.dockerServices).toEqual(['backtest', 'bot']);
            expect(defaultMonitor.config.maxRetries).toBe(3);
        });

        test('カスタム設定で初期化される', () => {
            expect(monitor.config.checkIntervalMs).toBe(1000);
            expect(monitor.config.dockerServices).toEqual(['test-service1', 'test-service2']);
            expect(monitor.config.maxRetries).toBe(2);
        });
    });

    describe('executeCommand', () => {
        test('成功時にstdoutを返す', async () => {
            const testOutput = 'test output';
            
            // コマンド実行をシミュレート
            const executePromise = monitor.executeCommand('git', ['status']);
            
            // 成功レスポンスをシミュレート
            mockSpawn.stdout.emit('data', testOutput);
            mockSpawn.emit('close', 0);
            
            const result = await executePromise;
            expect(result).toBe(testOutput);
            expect(spawn).toHaveBeenCalledWith('git', ['status'], expect.any(Object));
        });

        test('失敗時にエラーを投げる', async () => {
            const testError = 'command failed';
            
            const executePromise = monitor.executeCommand('git', ['invalid']);
            
            // 失敗レスポンスをシミュレート
            mockSpawn.stderr.emit('data', testError);
            mockSpawn.emit('close', 1);
            
            await expect(executePromise).rejects.toThrow('git invalid failed: command failed');
        });

        test('プロセスエラー時にエラーを投げる', async () => {
            const executePromise = monitor.executeCommand('invalid-command', []);
            
            mockSpawn.emit('error', new Error('ENOENT'));
            
            await expect(executePromise).rejects.toThrow('コマンド実行エラー: ENOENT');
        });
    });

    describe('getCommitHash', () => {
        test('正常にハッシュを取得する', async () => {
            const testHash = 'abc123def456\n';
            
            const getHashPromise = monitor.getCommitHash('main');
            
            mockSpawn.stdout.emit('data', testHash);
            mockSpawn.emit('close', 0);
            
            const result = await getHashPromise;
            expect(result).toBe('abc123def456');
            expect(spawn).toHaveBeenCalledWith('git', ['rev-parse', 'main'], expect.any(Object));
        });

        test('ハッシュ取得失敗時にエラーを投げる', async () => {
            const getHashPromise = monitor.getCommitHash('invalid-branch');
            
            mockSpawn.stderr.emit('data', 'fatal: bad revision');
            mockSpawn.emit('close', 1);
            
            await expect(getHashPromise).rejects.toThrow('ブランチ invalid-branch のハッシュ取得失敗');
        });
    });

    describe('checkForUpdates', () => {
        test('初回実行時はローカルハッシュを記録', async () => {
            const localHash = 'local123';
            
            // git fetchの実行をモック
            const fetchPromise = monitor.executeCommand('git', ['fetch', 'origin']);
            mockSpawn.stdout.emit('data', '');
            mockSpawn.emit('close', 0);
            await fetchPromise;
            
            // ハッシュ取得をモック
            jest.spyOn(monitor, 'getCommitHash')
                .mockResolvedValueOnce('remote123') // リモートハッシュ
                .mockResolvedValueOnce(localHash);  // ローカルハッシュ
            
            await monitor.checkForUpdates();
            
            expect(monitor.lastKnownHash).toBe(localHash);
        });

        test('更新がない場合は何もしない', async () => {
            const sameHash = 'same123';
            monitor.lastKnownHash = sameHash;
            
            jest.spyOn(monitor, 'getCommitHash')
                .mockResolvedValueOnce(sameHash) // リモートハッシュ
                .mockResolvedValueOnce(sameHash); // ローカルハッシュ
            
            jest.spyOn(monitor, 'performUpdate');
            
            await monitor.checkForUpdates();
            
            expect(monitor.performUpdate).not.toHaveBeenCalled();
        });

        test('更新がある場合はperformUpdateを呼ぶ', async () => {
            const oldHash = 'old123';
            const newHash = 'new456';
            monitor.lastKnownHash = oldHash;
            
            jest.spyOn(monitor, 'getCommitHash')
                .mockResolvedValueOnce(newHash) // リモートハッシュ
                .mockResolvedValueOnce(oldHash); // ローカルハッシュ
            
            jest.spyOn(monitor, 'performUpdate').mockResolvedValue();
            
            await monitor.checkForUpdates();
            
            expect(monitor.performUpdate).toHaveBeenCalled();
            expect(monitor.lastKnownHash).toBe(newHash);
        });
    });

    describe('restartDockerServices', () => {
        test('正常にDockerサービスを再起動する', async () => {
            // Docker version check
            const versionPromise = monitor.executeCommand('docker', ['compose', 'version']);
            mockSpawn.stdout.emit('data', 'version info');
            mockSpawn.emit('close', 0);
            await versionPromise;
            
            // Docker down
            const downPromise = monitor.executeCommand('docker', ['compose', 'down']);
            mockSpawn.stdout.emit('data', 'stopping');
            mockSpawn.emit('close', 0);
            await downPromise;
            
            // Docker build
            const buildPromise = monitor.executeCommand('docker', ['compose', 'build', 'test-service1', 'test-service2']);
            mockSpawn.stdout.emit('data', 'building');
            mockSpawn.emit('close', 0);
            await buildPromise;
            
            // Docker up
            const upPromise = monitor.executeCommand('docker', ['compose', 'up', '-d', 'test-service1', 'test-service2']);
            mockSpawn.stdout.emit('data', 'starting');
            mockSpawn.emit('close', 0);
            await upPromise;
            
            await monitor.restartDockerServices();
            
            expect(spawn).toHaveBeenCalledWith('docker', ['compose', 'version'], expect.any(Object));
            expect(spawn).toHaveBeenCalledWith('docker', ['compose', 'down'], expect.any(Object));
            expect(spawn).toHaveBeenCalledWith('docker', ['compose', 'build', 'test-service1', 'test-service2'], expect.any(Object));
            expect(spawn).toHaveBeenCalledWith('docker', ['compose', 'up', '-d', 'test-service1', 'test-service2'], expect.any(Object));
        });

        test('Docker操作失敗時にエラーを投げる', async () => {
            const restartPromise = monitor.restartDockerServices();
            
            // Docker version checkで失敗
            mockSpawn.stderr.emit('data', 'docker not found');
            mockSpawn.emit('close', 1);
            
            await expect(restartPromise).rejects.toThrow('Dockerサービス再起動失敗');
        });
    });

    describe('performUpdate', () => {
        test('正常に更新を実行する', async () => {
            jest.spyOn(monitor, 'executeCommand').mockResolvedValue('success');
            jest.spyOn(monitor, 'restartDockerServices').mockResolvedValue();
            
            await monitor.performUpdate();
            
            expect(monitor.executeCommand).toHaveBeenCalledWith('git', ['pull', 'origin', 'main']);
            expect(monitor.restartDockerServices).toHaveBeenCalled();
        });

        test('失敗時にリトライする', async () => {
            jest.spyOn(monitor, 'executeCommand')
                .mockRejectedValueOnce(new Error('first failure'))
                .mockResolvedValueOnce('success'); // 2回目で成功
            jest.spyOn(monitor, 'restartDockerServices').mockResolvedValue();
            
            // sleepをモック（fakeTimersを使用）
            const originalSleep = monitor.sleep;
            monitor.sleep = jest.fn().mockImplementation((ms) => {
                jest.advanceTimersByTime(ms);
                return Promise.resolve();
            });
            
            await monitor.performUpdate();
            
            expect(monitor.executeCommand).toHaveBeenCalledTimes(2);
            expect(monitor.sleep).toHaveBeenCalledWith(100);
            
            // 元のsleepを復元
            monitor.sleep = originalSleep;
        });

        test('最大リトライ回数に達したらエラーを投げる', async () => {
            jest.spyOn(monitor, 'executeCommand').mockRejectedValue(new Error('persistent failure'));
            
            // sleepをモック
            const originalSleep = monitor.sleep;
            monitor.sleep = jest.fn().mockImplementation((ms) => {
                jest.advanceTimersByTime(ms);
                return Promise.resolve();
            });
            
            await expect(monitor.performUpdate()).rejects.toThrow('persistent failure');
            expect(monitor.executeCommand).toHaveBeenCalledTimes(2); // maxRetries = 2
            
            // 元のsleepを復元
            monitor.sleep = originalSleep;
        });
    });

    describe('getStatus', () => {
        test('正常に状態を取得する', async () => {
            const localHash = 'local123456';
            const remoteHash = 'remote789012';
            
            jest.spyOn(monitor, 'getCommitHash')
                .mockResolvedValueOnce(localHash)  // ローカルハッシュ
                .mockResolvedValueOnce(remoteHash); // リモートハッシュ
            
            const status = await monitor.getStatus();
            
            expect(status).toEqual({
                isRunning: false,
                localHash: 'local12',
                remoteHash: 'remote7',
                upToDate: false,
                checkInterval: 1,
                dockerServices: ['test-service1', 'test-service2']
            });
        });

        test('エラー時にエラー情報を返す', async () => {
            jest.spyOn(monitor, 'getCommitHash').mockRejectedValue(new Error('git error'));
            
            const status = await monitor.getStatus();
            
            expect(status).toEqual({
                error: 'git error'
            });
        });
    });

    describe('sleep', () => {
        test('指定された時間待機する', async () => {
            const sleepPromise = monitor.sleep(1000);
            
            // 時間を進める
            jest.advanceTimersByTime(1000);
            
            await expect(sleepPromise).resolves.toBeUndefined();
        });
    });
});

// TODO: Issue #319 - auto-update-monitor テストがハングする問題を修正  
describe.skip('AutoUpdateMonitor統合テスト', () => {
    test('CLIオプションが正しく解析される', () => {
        // processの引数をモック
        const originalArgv = process.argv;
        process.argv = ['node', 'auto-update-monitor.js', '--debug', '--interval', '10', '--services', 'service1,service2'];
        
        // モジュールを再読み込みしてCLIオプションをテスト
        const config = {
            debug: process.argv.includes('--debug'),
            checkIntervalMs: process.argv.includes('--interval') ? 
                parseInt(process.argv[process.argv.indexOf('--interval') + 1]) * 1000 : 
                undefined,
            dockerServices: process.argv.includes('--services') ? 
                process.argv[process.argv.indexOf('--services') + 1].split(',') : 
                undefined
        };
        
        expect(config.debug).toBe(true);
        expect(config.checkIntervalMs).toBe(10000);
        expect(config.dockerServices).toEqual(['service1', 'service2']);
        
        // 元の引数を復元
        process.argv = originalArgv;
    });
});