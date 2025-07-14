const DockerLogMonitor = require('../../scripts/log-monitor');
const { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } = require('fs');
const path = require('path');

// テスト用の一時ディレクトリ
const TEST_TMP_DIR = '.tmp/test';
const TEST_ISSUE_HISTORY_FILE = path.join(TEST_TMP_DIR, 'test-issue-history.json');

describe('DockerLogMonitor', () => {
    let monitor;

    beforeEach(() => {
        // テスト用ディレクトリ作成
        if (!existsSync(TEST_TMP_DIR)) {
            mkdirSync(TEST_TMP_DIR, { recursive: true });
        }
        
        // テスト用の設定でモニターを初期化
        monitor = new DockerLogMonitor({
            services: ['test-service'],
            errorPatterns: [/Error:/i, /Exception:/i, /ERROR/i],
            issueThrottleMs: 1000, // テスト用に短く設定
            issueHistoryFile: TEST_ISSUE_HISTORY_FILE,
            debug: false,
            reconnectEnabled: true,
            reconnectIntervalMs: 100, // テスト用に短く設定
            maxReconnectAttempts: 2
        });
    });

    afterEach(() => {
        // テストファイルをクリーンアップ
        if (existsSync(TEST_ISSUE_HISTORY_FILE)) {
            unlinkSync(TEST_ISSUE_HISTORY_FILE);
        }
    });

    describe('コンストラクタ', () => {
        test('デフォルト設定で初期化される', () => {
            const defaultMonitor = new DockerLogMonitor();
            expect(defaultMonitor.config.services).toEqual(['bot', 'hft', 'backtest', 'web-ui']);
            expect(defaultMonitor.config.issueThrottleMs).toBe(5 * 60 * 1000);
        });

        test('カスタム設定で初期化される', () => {
            expect(monitor.config.services).toEqual(['test-service']);
            expect(monitor.config.issueThrottleMs).toBe(1000);
            expect(monitor.config.reconnectEnabled).toBe(true);
            expect(monitor.config.reconnectIntervalMs).toBe(100);
            expect(monitor.config.maxReconnectAttempts).toBe(2);
        });
    });

    describe('Issue履歴管理', () => {
        test('Issue履歴を正しく読み込める', () => {
            const testHistory = {
                issues: [
                    { timestamp: Date.now(), service: 'test', errorHash: 'hash1' }
                ],
                lastCleanup: Date.now()
            };
            
            writeFileSync(TEST_ISSUE_HISTORY_FILE, JSON.stringify(testHistory));
            
            const loadedHistory = monitor.loadIssueHistory();
            expect(loadedHistory.issues).toHaveLength(1);
            expect(loadedHistory.issues[0].service).toBe('test');
        });

        test('存在しないファイルの場合デフォルト履歴を返す', () => {
            const history = monitor.loadIssueHistory();
            expect(history.issues).toEqual([]);
            expect(history.lastCleanup).toBeDefined();
        });

        test('Issue履歴を正しく保存できる', () => {
            monitor.issueHistory.issues.push({
                timestamp: Date.now(),
                service: 'test-service',
                errorHash: 'test-hash',
                issueUrl: 'https://github.com/test/test/issues/1'
            });
            
            monitor.saveIssueHistory();
            
            expect(existsSync(TEST_ISSUE_HISTORY_FILE)).toBe(true);
            const saved = JSON.parse(readFileSync(TEST_ISSUE_HISTORY_FILE, 'utf8'));
            expect(saved.issues).toHaveLength(1);
        });
    });

    describe('エラーハッシュ生成', () => {
        test('同じエラーに対して同じハッシュを生成する', () => {
            const error1 = 'Error: Connection failed at line 42';
            const error2 = 'Error: Connection failed at line 42';
            
            const hash1 = monitor.generateErrorHash('service1', error1);
            const hash2 = monitor.generateErrorHash('service1', error2);
            
            expect(hash1).toBe(hash2);
        });

        test('動的な部分を正規化する', () => {
            const error1 = 'Error: Failed at 2024-01-01T12:00:00 line 42';
            const error2 = 'Error: Failed at 2024-01-02T15:30:00 line 99';
            
            const hash1 = monitor.generateErrorHash('service1', error1);
            const hash2 = monitor.generateErrorHash('service1', error2);
            
            // 時刻と行番号が異なっても同じエラーとして認識
            expect(hash1).toBe(hash2);
        });

        test('異なるサービスは異なるハッシュを生成する', () => {
            const error = 'Error: Same error message';
            
            const hash1 = monitor.generateErrorHash('service1', error);
            const hash2 = monitor.generateErrorHash('service2', error);
            
            expect(hash1).not.toBe(hash2);
        });

        test('UUIDやハッシュ値を正規化する', () => {
            const error1 = 'Error: Request failed with id 550e8400-e29b-41d4-a716-446655440000';
            const error2 = 'Error: Request failed with id 6ba7b810-9dad-11d1-80b4-00c04fd430c8';
            
            const hash1 = monitor.generateErrorHash('service1', error1);
            const hash2 = monitor.generateErrorHash('service1', error2);
            
            expect(hash1).toBe(hash2);
        });

        test('URLとポート番号を正規化する', () => {
            const error1 = 'Connection failed to http://localhost:3000/api/data';
            const error2 = 'Connection failed to https://api.example.com:8080/v1/users';
            
            const hash1 = monitor.generateErrorHash('service1', error1);
            const hash2 = monitor.generateErrorHash('service1', error2);
            
            expect(hash1).toBe(hash2);
        });

        test('メモリアドレスを正規化する', () => {
            const error1 = 'Segmentation fault at 0x7ffee8b5c000';
            const error2 = 'Segmentation fault at 0x7ffee8b5d123';
            
            const hash1 = monitor.generateErrorHash('service1', error1);
            const hash2 = monitor.generateErrorHash('service1', error2);
            
            expect(hash1).toBe(hash2);
        });
    });

    describe('エラータイプ抽出', () => {
        test('TypeErrorを正しく識別する', () => {
            const error = 'TypeError: Cannot read property of undefined';
            const errorType = monitor.extractErrorType(error);
            expect(errorType).toBe('TypeError');
        });

        test('接続エラーを正しく識別する', () => {
            const error = 'Connection failed to database';
            const errorType = monitor.extractErrorType(error);
            expect(errorType).toBe('ConnectionError');
        });

        test('プロセス終了エラーを正しく識別する', () => {
            const error = 'Process exited with code 1';
            const errorType = monitor.extractErrorType(error);
            expect(errorType).toBe('ProcessExit');
        });

        test('ERROR形式のエラーを正しく識別する', () => {
            const error1 = 'ERROR Database connection failed';
            const errorType1 = monitor.extractErrorType(error1);
            expect(errorType1).toBe('Error');

            const error2 = '[ERROR] Service initialization failed';
            const errorType2 = monitor.extractErrorType(error2);
            expect(errorType2).toBe('Error');
        });

        test('不明なエラーはUnknownとして識別する', () => {
            const error = 'Some unknown message';
            const errorType = monitor.extractErrorType(error);
            expect(errorType).toBe('Unknown');
        });
    });

    describe('Issue作成判定', () => {
        test('初回エラーでIssue作成可能', () => {
            const shouldCreate = monitor.shouldCreateIssue('new-error-hash', 'test-service', 'Error: New error');
            expect(shouldCreate).toBe(true);
        });

        test('スロットリング期間内の同じエラーではIssue作成しない', () => {
            const errorHash = 'throttle-test-hash';
            
            // 履歴に追加
            monitor.issueHistory.issues.push({
                timestamp: Date.now() - 500, // 500ms前
                errorHash: errorHash,
                service: 'test-service',
                errorType: 'Error'
            });
            
            const shouldCreate = monitor.shouldCreateIssue(errorHash, 'test-service', 'Error: Throttled error');
            expect(shouldCreate).toBe(false);
        });

        test('スロットリング期間経過後は再度Issue作成可能', () => {
            const errorHash = 'throttle-expired-hash';
            
            // 履歴に追加（スロットリング期間より古い）
            monitor.issueHistory.issues.push({
                timestamp: Date.now() - 2000, // 2秒前（スロットリング1秒より長い）
                errorHash: errorHash,
                service: 'test-service',
                errorType: 'Error'
            });
            
            const shouldCreate = monitor.shouldCreateIssue(errorHash, 'test-service', 'Error: Expired error');
            expect(shouldCreate).toBe(true);
        });


        test('類似エラータイプは長い期間でスロットリングされる', () => {
            const errorMessage1 = 'TypeError: Cannot read property';
            const errorMessage2 = 'TypeError: Cannot access property';
            
            // 最初のエラーを履歴に追加
            monitor.issueHistory.issues.push({
                timestamp: Date.now() - 1500, // 1.5秒前
                errorHash: 'different-hash',
                service: 'test-service',
                errorType: 'TypeError'
            });
            
            // 類似エラータイプは2倍の期間でスロットリング（2秒）
            const shouldCreate = monitor.shouldCreateIssue('new-hash', 'test-service', errorMessage2);
            expect(shouldCreate).toBe(false);
        });

        test('異なるサービスの類似エラーは別々に処理される', () => {
            const errorMessage = 'TypeError: Cannot read property';
            
            // service1での履歴を追加
            monitor.issueHistory.issues.push({
                timestamp: Date.now() - 1500,
                errorHash: 'service1-hash',
                service: 'service1',
                errorType: 'TypeError'
            });
            
            // service2では類似エラータイプでもIssue作成可能
            const shouldCreate = monitor.shouldCreateIssue('service2-hash', 'service2', errorMessage);
            expect(shouldCreate).toBe(true);
        });
    });

    describe('ログバッファ管理', () => {
        test('ログバッファを正しく更新する', () => {
            monitor.updateLogBuffer('test-service', 'Log line 1');
            monitor.updateLogBuffer('test-service', 'Log line 2');
            
            const buffer = monitor.logBuffer.get('test-service');
            expect(buffer).toEqual(['Log line 1', 'Log line 2']);
        });

        test('バッファサイズ制限が機能する', () => {
            // 制限を超える行数を追加
            for (let i = 0; i < 15; i++) {
                monitor.updateLogBuffer('test-service', `Log line ${i}`);
            }
            
            const buffer = monitor.logBuffer.get('test-service');
            expect(buffer.length).toBe(10); // 制限は10行
            expect(buffer[0]).toBe('Log line 5'); // 古い行が削除されている
        });

        test('ログコンテキストを正しく取得する', () => {
            monitor.updateLogBuffer('test-service', 'Line 1');
            monitor.updateLogBuffer('test-service', 'Line 2');
            monitor.updateLogBuffer('test-service', 'Line 3');
            
            const context = monitor.getLogContext('test-service', 'Current line');
            expect(context).toBe('Line 1\nLine 2\nLine 3\nCurrent line');
        });
    });

    describe('スタックトレース抽出', () => {
        test('基本的なスタックトレースを抽出する', () => {
            const logLines = [
                'Info: Starting process',
                'TypeError: Cannot read property of undefined',
                '    at Object.test (/app/src/test.js:10:5)',
                '    at Module.require (internal/modules/cjs/loader.js:123:45)',
                '    at Object.<anonymous> (/app/src/main.js:5:1)',
                'Info: Process ended'
            ];
            
            const stackTrace = monitor.extractStackTrace(logLines);
            expect(stackTrace).toContain('TypeError: Cannot read property of undefined');
            expect(stackTrace).toContain('[APP_DIR]'); // サニタイズされたパス
            expect(stackTrace).toContain('[INTERNAL]'); // サニタイズされたパス
        });

        test('スタックトレースがない場合はnullを返す', () => {
            const logLines = [
                'Info: Starting process',
                'Debug: Processing data',
                'Info: Process completed'
            ];
            
            const stackTrace = monitor.extractStackTrace(logLines);
            expect(stackTrace).toBeNull();
        });

        test('複数のエラーパターンを検出する', () => {
            const logLines = [
                'ReferenceError: variable is not defined',
                '    at test.js:15:3',
                '    at main.js:8:1'
            ];
            
            const stackTrace = monitor.extractStackTrace(logLines);
            expect(stackTrace).toContain('ReferenceError: variable is not defined');
            expect(stackTrace).toContain('at test.js:15:3');
        });

        test('機密情報をサニタイズする', () => {
            const logLines = [
                'TypeError: Cannot read property of undefined',
                '    at Object.test (/home/user/project/src/test.js:10:5)',
                '    at Module.require (/opt/app/node_modules/express/lib/router.js:123:45)',
                '    at internal/modules/cjs/loader.js:456:7',
                '    at /usr/src/app/scripts/main.js:8:1'
            ];
            
            const stackTrace = monitor.extractStackTrace(logLines);
            
            // 機密情報がサニタイズされていることを確認
            expect(stackTrace).toContain('[HOME_DIR]');
            expect(stackTrace).toContain('[OPT_DIR]'); // node_modulesを含むパス
            expect(stackTrace).toContain('[INTERNAL]');
            expect(stackTrace).toContain('[SRC_DIR]');
            
            // 元のパスが含まれていないことを確認
            expect(stackTrace).not.toContain('/home/user');
            expect(stackTrace).not.toContain('node_modules/express');
            expect(stackTrace).not.toContain('/usr/src/app');
        });
    });

    describe('ログ処理', () => {
        test('エラーパターンにマッチするログを検出する', async () => {
            const createIssueSpy = jest.spyOn(monitor, 'createGitHubIssue').mockResolvedValue('issue-url');
            const shouldCreateSpy = jest.spyOn(monitor, 'shouldCreateIssue').mockReturnValue(true);
            
            await monitor.processLogLine('test-service', 'Error: Test error message');
            
            expect(shouldCreateSpy).toHaveBeenCalledWith(
                expect.any(String), // errorHash
                'test-service',
                'Error: Test error message'
            );
            expect(createIssueSpy).toHaveBeenCalledWith(
                'test-service',
                'Error: Test error message',
                expect.any(String)
            );
            
            createIssueSpy.mockRestore();
            shouldCreateSpy.mockRestore();
        });

        test('ERRORログを検出してIssue作成する', async () => {
            const createIssueSpy = jest.spyOn(monitor, 'createGitHubIssue').mockResolvedValue('issue-url');
            const shouldCreateSpy = jest.spyOn(monitor, 'shouldCreateIssue').mockReturnValue(true);
            
            await monitor.processLogLine('test-service', 'ERROR Database connection failed');
            
            expect(shouldCreateSpy).toHaveBeenCalledWith(
                expect.any(String),
                'test-service',
                'ERROR Database connection failed'
            );
            expect(createIssueSpy).toHaveBeenCalledWith(
                'test-service',
                'ERROR Database connection failed',
                expect.any(String)
            );
            
            createIssueSpy.mockRestore();
            shouldCreateSpy.mockRestore();
        });

        test('[ERROR]形式のログも検出する', async () => {
            const createIssueSpy = jest.spyOn(monitor, 'createGitHubIssue').mockResolvedValue('issue-url');
            const shouldCreateSpy = jest.spyOn(monitor, 'shouldCreateIssue').mockReturnValue(true);
            
            await monitor.processLogLine('test-service', '[ERROR] Service initialization failed');
            
            expect(shouldCreateSpy).toHaveBeenCalledWith(
                expect.any(String),
                'test-service',
                '[ERROR] Service initialization failed'
            );
            expect(createIssueSpy).toHaveBeenCalledWith(
                'test-service',
                '[ERROR] Service initialization failed',
                expect.any(String)
            );
            
            createIssueSpy.mockRestore();
            shouldCreateSpy.mockRestore();
        });

        test('エラーパターンにマッチしないログは無視する', async () => {
            const createIssueSpy = jest.spyOn(monitor, 'createGitHubIssue').mockResolvedValue('issue-url');
            
            await monitor.processLogLine('test-service', 'Info: Normal log message');
            
            expect(createIssueSpy).not.toHaveBeenCalled();
            
            createIssueSpy.mockRestore();
        });

        test('重複チェックでスキップされたIssueは作成されない', async () => {
            const createIssueSpy = jest.spyOn(monitor, 'createGitHubIssue').mockResolvedValue('issue-url');
            const shouldCreateSpy = jest.spyOn(monitor, 'shouldCreateIssue').mockReturnValue(false);
            
            await monitor.processLogLine('test-service', 'Error: Duplicate error');
            
            expect(shouldCreateSpy).toHaveBeenCalled();
            expect(createIssueSpy).not.toHaveBeenCalled();
            
            createIssueSpy.mockRestore();
            shouldCreateSpy.mockRestore();
        });
    });

    describe('クリーンアップ', () => {
        test('古いIssue履歴を削除する', () => {
            const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25時間前
            const recentTimestamp = Date.now() - (1 * 60 * 60 * 1000); // 1時間前
            
            monitor.issueHistory.issues = [
                { timestamp: oldTimestamp, errorHash: 'old' },
                { timestamp: recentTimestamp, errorHash: 'recent' }
            ];
            
            monitor.cleanupIssueHistory();
            
            expect(monitor.issueHistory.issues).toHaveLength(1);
            expect(monitor.issueHistory.issues[0].errorHash).toBe('recent');
        });
    });

    describe('再接続機能', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('プロセス終了時に再接続をスケジュールする', () => {
            monitor.isRunning = true;
            monitor.config.reconnectEnabled = true;
            
            monitor.scheduleReconnect(0);
            
            expect(monitor.reconnectAttempts).toBe(1);
            expect(monitor.reconnectTimer).not.toBeNull();
        });

        test('最大再接続回数に達した場合停止する', () => {
            monitor.isRunning = true;
            monitor.config.maxReconnectAttempts = 2;
            monitor.reconnectAttempts = 2;
            
            const stopSpy = jest.spyOn(monitor, 'stop').mockImplementation(() => {});
            
            monitor.scheduleReconnect(1);
            
            expect(stopSpy).toHaveBeenCalled();
            stopSpy.mockRestore();
        });

        test('手動停止時は再接続しない', () => {
            monitor.isRunning = false;
            monitor.config.reconnectEnabled = true;
            
            monitor.scheduleReconnect(0);
            
            expect(monitor.reconnectTimer).toBeNull();
        });

        test('再接続タイマーをクリアしてプロセス停止する', () => {
            // テスト環境であることを示す
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';
            
            monitor.reconnectTimer = setTimeout(() => {}, 1000);
            const mockProcess = { kill: jest.fn() };
            monitor.currentProcess = mockProcess;
            
            monitor.stop();
            
            expect(monitor.reconnectTimer).toBeNull();
            expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
            expect(monitor.currentProcess).toBeNull();
            expect(monitor.isRunning).toBe(false);
            
            // 環境変数を復元
            process.env.NODE_ENV = originalEnv;
        });

        test('再接続無効時は再接続しない', () => {
            monitor.isRunning = true;
            monitor.config.reconnectEnabled = false;
            
            monitor.scheduleReconnect(0);
            
            expect(monitor.reconnectTimer).toBeNull();
            expect(monitor.reconnectAttempts).toBe(1); // カウンターは増加するが実際には再接続しない
        });
    });
});

describe('DockerLogMonitor統合テスト', () => {
    test('設定ファイルから設定を読み込める', () => {
        // 実際の設定ファイルが存在することを確認
        const configPath = path.join(__dirname, '../../config/log-monitor-config.json');
        expect(existsSync(configPath)).toBe(true);
        
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        expect(config.services).toBeDefined();
        expect(config.errorPatterns).toBeDefined();
        expect(Array.isArray(config.services)).toBe(true);
        expect(Array.isArray(config.errorPatterns)).toBe(true);
    });
});