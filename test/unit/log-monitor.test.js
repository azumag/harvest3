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
            errorPatterns: [/Error:/i, /Exception:/i],
            issueThrottleMs: 1000, // テスト用に短く設定
            issueHistoryFile: TEST_ISSUE_HISTORY_FILE,
            maxIssuesPerDay: 3,
            debug: false
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
            expect(defaultMonitor.config.maxIssuesPerDay).toBe(10);
            expect(defaultMonitor.config.issueThrottleMs).toBe(5 * 60 * 1000);
        });

        test('カスタム設定で初期化される', () => {
            expect(monitor.config.services).toEqual(['test-service']);
            expect(monitor.config.maxIssuesPerDay).toBe(3);
            expect(monitor.config.issueThrottleMs).toBe(1000);
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
    });

    describe('Issue作成判定', () => {
        test('初回エラーでIssue作成可能', () => {
            const shouldCreate = monitor.shouldCreateIssue('new-error-hash');
            expect(shouldCreate).toBe(true);
        });

        test('スロットリング期間内の同じエラーではIssue作成しない', () => {
            const errorHash = 'throttle-test-hash';
            
            // 履歴に追加
            monitor.issueHistory.issues.push({
                timestamp: Date.now() - 500, // 500ms前
                errorHash: errorHash
            });
            
            const shouldCreate = monitor.shouldCreateIssue(errorHash);
            expect(shouldCreate).toBe(false);
        });

        test('スロットリング期間経過後は再度Issue作成可能', () => {
            const errorHash = 'throttle-expired-hash';
            
            // 履歴に追加（スロットリング期間より古い）
            monitor.issueHistory.issues.push({
                timestamp: Date.now() - 2000, // 2秒前（スロットリング1秒より長い）
                errorHash: errorHash
            });
            
            const shouldCreate = monitor.shouldCreateIssue(errorHash);
            expect(shouldCreate).toBe(true);
        });

        test('1日の最大Issue数に達した場合Issue作成しない', () => {
            const today = Date.now();
            
            // 最大数までIssueを追加
            for (let i = 0; i < monitor.config.maxIssuesPerDay; i++) {
                monitor.issueHistory.issues.push({
                    timestamp: today,
                    errorHash: `hash-${i}`
                });
            }
            
            const shouldCreate = monitor.shouldCreateIssue('new-hash');
            expect(shouldCreate).toBe(false);
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

    describe('ログ処理', () => {
        test('エラーパターンにマッチするログを検出する', async () => {
            const createIssueSpy = jest.spyOn(monitor, 'createGitHubIssue').mockResolvedValue('issue-url');
            const shouldCreateSpy = jest.spyOn(monitor, 'shouldCreateIssue').mockReturnValue(true);
            
            await monitor.processLogLine('test-service', 'Error: Test error message');
            
            expect(shouldCreateSpy).toHaveBeenCalled();
            expect(createIssueSpy).toHaveBeenCalledWith(
                'test-service',
                'Error: Test error message',
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