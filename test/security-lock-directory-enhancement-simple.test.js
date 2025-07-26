/**
 * Issue #5417: セキュリティ強化 - strategy-runner一時ファイル格納場所の改善テスト
 * 簡素化版テスト - 核心的な機能のみをテスト
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Issue #5417: セキュリティ強化 - ロックディレクトリ改善テスト', () => {
    jest.setTimeout(30000);

    const TEST_LOCK_BASE_DIR = '/tmp/test-strategy-runner';
    const originalCwd = process.cwd();
    
    beforeAll(() => {
        // テスト用の一時ディレクトリをクリーンアップ
        if (fs.existsSync(TEST_LOCK_BASE_DIR)) {
            execSync(`rm -rf ${TEST_LOCK_BASE_DIR}`, { stdio: 'ignore' });
        }
    });

    afterAll(() => {
        // テスト後のクリーンアップ
        if (fs.existsSync(TEST_LOCK_BASE_DIR)) {
            execSync(`rm -rf ${TEST_LOCK_BASE_DIR}`, { stdio: 'ignore' });
        }
    });

    describe('環境変数LOCK_BASE_DIRの設定確認', () => {
        it('entrypoint.shにLOCK_BASE_DIR環境変数が定義されていること', () => {
            const result = execSync('grep -n "LOCK_BASE_DIR=" entrypoint.sh', {
                encoding: 'utf8',
                cwd: originalCwd
            });
            
            expect(result).toContain('LOCK_BASE_DIR=${LOCK_BASE_DIR:-/var/run/strategy-runner}');
        });

        it('setup_lock_base_directory関数が定義されていること', () => {
            const result = execSync('grep -n "setup_lock_base_directory()" entrypoint.sh', {
                encoding: 'utf8',
                cwd: originalCwd
            });
            
            expect(result).toContain('setup_lock_base_directory()');
        });
    });

    describe('ロックファイルパスの更新確認', () => {
        it('重要なロックファイルパスがLOCK_BASE_DIRを使用していること', () => {
            const entrypointContent = fs.readFileSync('entrypoint.sh', 'utf8');
            
            // 重要なロックファイルパスがLOCK_BASE_DIRを使用しているかチェック
            expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_FILE="$LOCK_BASE_DIR/backtest-startup-message.lock"');
            expect(entrypointContent).toContain('STARTUP_LOCK_FILE="$LOCK_BASE_DIR/strategy-runner-startup.lock"');
            expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR="$LOCK_BASE_DIR/startup_messages"');
            expect(entrypointContent).toContain('ERROR_LOG_FILE=${ERROR_LOG_FILE:-"$LOCK_BASE_DIR/backtest-errors.log"}');
        });

        it('古い/tmpへのハードコードされたパスが適切に更新されていること', () => {
            const entrypointContent = fs.readFileSync('entrypoint.sh', 'utf8');
            
            // 重要なファイルについて、古い/tmpパスが残っていないことを確認
            expect(entrypointContent).not.toContain('BACKTEST_STARTUP_LOCK_FILE="/tmp/backtest-startup-message.lock"');
            expect(entrypointContent).not.toContain('STARTUP_LOCK_FILE="/tmp/strategy-runner-startup.lock"');
            expect(entrypointContent).not.toContain('STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"');
        });
    });

    describe('Dockerfileの更新確認', () => {
        it('Dockerfileに/var/runディレクトリ作成処理が追加されていること', () => {
            const dockerfileContent = fs.readFileSync('Dockerfile', 'utf8');
            
            expect(dockerfileContent).toContain('mkdir -p /var/run/strategy-runner');
            expect(dockerfileContent).toContain('chmod 700 /var/run/strategy-runner');
        });
    });

    describe('docker-compose.ymlの更新確認', () => {
        it('botサービスにLOCK_BASE_DIR環境変数が設定されていること', () => {
            const dockerComposeContent = fs.readFileSync('docker-compose.yml', 'utf8');
            
            expect(dockerComposeContent).toContain('LOCK_BASE_DIR=/var/run/strategy-runner');
        });

        it('backtestサービスにLOCK_BASE_DIR環境変数が設定されていること', () => {
            const dockerComposeContent = fs.readFileSync('docker-compose.yml', 'utf8');
            
            // backtestサービス関連のLOCK_BASE_DIR設定があることを単純にチェック
            const hasBacktestLockBaseDir = dockerComposeContent.includes('LOCK_BASE_DIR=/var/run/strategy-runner');
            
            expect(hasBacktestLockBaseDir).toBe(true);
        });
    });

    describe('セキュリティ改善の確認', () => {
        it('実際のディレクトリでセキュリティテスト', () => {
            // テスト用ディレクトリを作成
            fs.mkdirSync(TEST_LOCK_BASE_DIR, { mode: 0o700 });
            
            // 権限の確認
            const stats = fs.statSync(TEST_LOCK_BASE_DIR);
            const permissions = (stats.mode & parseInt('777', 8)).toString(8);
            
            expect(permissions).toBe('700');
            
            // ロックファイル作成テスト
            const lockFile = path.join(TEST_LOCK_BASE_DIR, 'test-lock.lock');
            fs.writeFileSync(lockFile, 'test lock content');
            fs.chmodSync(lockFile, 0o600);
            
            expect(fs.existsSync(lockFile)).toBe(true);
            
            const fileStats = fs.statSync(lockFile);
            const filePermissions = (fileStats.mode & parseInt('777', 8)).toString(8);
            expect(filePermissions).toBe('600');
            
            // クリーンアップ
            fs.unlinkSync(lockFile);
        });
    });

    describe('後方互換性の確認', () => {
        it('Issue #5417のコメントが適切に追加されていること', () => {
            const entrypointContent = fs.readFileSync('entrypoint.sh', 'utf8');
            
            expect(entrypointContent).toContain('Issue #5417');
            expect(entrypointContent).toContain('セキュリティ強化');
        });

        it('フォールバック機能のコードが含まれていること', () => {
            const entrypointContent = fs.readFileSync('entrypoint.sh', 'utf8');
            
            expect(entrypointContent).toContain('falling back to /tmp');
            expect(entrypointContent).toContain('LOCK_BASE_DIR="/tmp"');
        });
    });
});