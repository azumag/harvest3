const { spawn } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const path = require('path');

/**
 * Docker Composeログ監視とGitHub Issue自動発行スクリプト
 */
class DockerLogMonitor {
    constructor(config = {}) {
        this.config = {
            // 監視対象サービス
            services: config.services || ['bot', 'hft', 'backtest', 'web-ui'],
            // 例外パターン（正規表現）
            errorPatterns: config.errorPatterns || [
                /Error:/i,
                /Exception:/i,
                /TypeError:/i,
                /ReferenceError:/i,
                /SyntaxError:/i,
                /UnhandledPromiseRejectionWarning/i,
                /Process exited with code [1-9]/i,
                /\[ERROR\]/i,
                /FATAL/i,
                /Uncaught/i
            ],
            // Issue発行の間隔制限（同じエラーでは5分以内に再発行しない）
            issueThrottleMs: config.issueThrottleMs || 5 * 60 * 1000,
            // Issue履歴ファイル
            issueHistoryFile: config.issueHistoryFile || '.tmp/issue-history.json',
            // 最大Issue数（1日あたり）
            maxIssuesPerDay: config.maxIssuesPerDay || 10,
            // デバッグモード
            debug: config.debug || false
        };
        
        this.issueHistory = this.loadIssueHistory();
        this.logBuffer = new Map(); // サービス別ログバッファ
    }

    /**
     * Issue履歴を読み込み
     */
    loadIssueHistory() {
        try {
            if (existsSync(this.config.issueHistoryFile)) {
                return JSON.parse(readFileSync(this.config.issueHistoryFile, 'utf8'));
            }
        } catch (error) {
            console.warn('Issue履歴の読み込みに失敗:', error.message);
        }
        return { issues: [], lastCleanup: Date.now() };
    }

    /**
     * Issue履歴を保存
     */
    saveIssueHistory() {
        try {
            const dir = path.dirname(this.config.issueHistoryFile);
            if (!existsSync(dir)) {
                require('fs').mkdirSync(dir, { recursive: true });
            }
            writeFileSync(this.config.issueHistoryFile, JSON.stringify(this.issueHistory, null, 2));
        } catch (error) {
            console.error('Issue履歴の保存に失敗:', error.message);
        }
    }

    /**
     * 古いIssue履歴をクリーンアップ（24時間以上前のものを削除）
     */
    cleanupIssueHistory() {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        this.issueHistory.issues = this.issueHistory.issues.filter(issue => issue.timestamp > oneDayAgo);
        this.issueHistory.lastCleanup = Date.now();
        this.saveIssueHistory();
    }

    /**
     * 重複Issue発行を防止するためのチェック
     */
    shouldCreateIssue(errorHash) {
        const now = Date.now();
        
        // 24時間ごとにクリーンアップ
        if (now - this.issueHistory.lastCleanup > 24 * 60 * 60 * 1000) {
            this.cleanupIssueHistory();
        }

        // 1日あたりの最大Issue数チェック
        const today = new Date().toDateString();
        const todayIssues = this.issueHistory.issues.filter(issue => 
            new Date(issue.timestamp).toDateString() === today
        );
        
        if (todayIssues.length >= this.config.maxIssuesPerDay) {
            console.warn(`1日の最大Issue数(${this.config.maxIssuesPerDay})に達しました`);
            return false;
        }

        // 同じエラーのスロットリングチェック
        const recentSameError = this.issueHistory.issues.find(issue => 
            issue.errorHash === errorHash && 
            now - issue.timestamp < this.config.issueThrottleMs
        );

        return !recentSameError;
    }

    /**
     * エラーのハッシュ値を生成（重複チェック用）
     */
    generateErrorHash(service, errorMessage) {
        // エラーメッセージから動的な部分（時刻、ファイルパスなど）を除去
        const cleanError = errorMessage
            .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/g, '[TIMESTAMP]')
            .replace(/\/[^\s]+\/([^\/\s]+\.js)/g, '[PATH]/$1')
            .replace(/line \d+/g, 'line [NUM]')
            .replace(/column \d+/g, 'column [NUM]')
            .replace(/\d+ms/g, '[TIME]ms');
        
        return `${service}:${cleanError}`.slice(0, 100);
    }

    /**
     * GitHub Issue を作成
     */
    async createGitHubIssue(service, errorMessage, logContext) {
        const title = `[自動] ${service}サービスで例外が発生`;
        const body = `## 概要
${service}サービスで例外が検出されました。

## エラー詳細
\`\`\`
${errorMessage}
\`\`\`

## ログコンテキスト
\`\`\`
${logContext}
\`\`\`

## 発生時刻
${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

## 対象サービス
- Docker Compose サービス: ${service}

---
*このIssueは自動的に作成されました。*
`;

        try {
            const { spawn } = require('child_process');
            
            return new Promise((resolve, reject) => {
                const ghCommand = spawn('gh', [
                    'issue', 'create',
                    '--title', title,
                    '--body', body,
                    '--label', 'bug,auto-generated'
                ], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let output = '';
                let errorOutput = '';

                ghCommand.stdout.on('data', (data) => {
                    output += data.toString();
                });

                ghCommand.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                ghCommand.on('close', (code) => {
                    if (code === 0) {
                        console.log(`✅ GitHub Issue作成成功: ${output.trim()}`);
                        resolve(output.trim());
                    } else {
                        console.error(`❌ GitHub Issue作成失敗: ${errorOutput}`);
                        reject(new Error(errorOutput));
                    }
                });
            });
        } catch (error) {
            console.error('GitHub Issue作成エラー:', error.message);
            throw error;
        }
    }

    /**
     * ログ行を処理
     */
    async processLogLine(service, line) {
        // デバッグ出力
        if (this.config.debug) {
            console.log(`[${service}] ${line}`);
        }

        // エラーパターンチェック
        const hasError = this.config.errorPatterns.some(pattern => pattern.test(line));
        
        if (hasError) {
            const errorHash = this.generateErrorHash(service, line);
            
            if (this.shouldCreateIssue(errorHash)) {
                // ログコンテキストを取得（前後数行）
                const logContext = this.getLogContext(service, line);
                
                try {
                    const issueUrl = await this.createGitHubIssue(service, line, logContext);
                    
                    // Issue履歴に追加
                    this.issueHistory.issues.push({
                        timestamp: Date.now(),
                        service,
                        errorHash,
                        issueUrl,
                        errorMessage: line.slice(0, 200) // メッセージを短縮
                    });
                    this.saveIssueHistory();
                    
                    console.log(`🚨 ${service}で例外検出 -> Issue作成: ${issueUrl}`);
                } catch (error) {
                    console.error(`Issue作成失敗 (${service}):`, error.message);
                }
            } else {
                console.log(`⏭️  重複/スロットル制限により Issue作成をスキップ: ${service}`);
            }
        }
    }

    /**
     * ログコンテキストを取得（バッファから前後の行）
     */
    getLogContext(service, currentLine) {
        const buffer = this.logBuffer.get(service) || [];
        const context = [...buffer, currentLine];
        return context.slice(-5).join('\n'); // 直近5行
    }

    /**
     * ログバッファを更新
     */
    updateLogBuffer(service, line) {
        if (!this.logBuffer.has(service)) {
            this.logBuffer.set(service, []);
        }
        
        const buffer = this.logBuffer.get(service);
        buffer.push(line);
        
        // バッファサイズ制限（最新10行のみ保持）
        if (buffer.length > 10) {
            buffer.shift();
        }
    }

    /**
     * Docker Composeログを監視開始
     */
    startMonitoring() {
        console.log(`🔍 Docker Composeログ監視を開始 (対象: ${this.config.services.join(', ')})`);
        
        const dockerCompose = spawn('docker', ['compose', 'logs', '-f', ...this.config.services], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        dockerCompose.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => line.trim());
            
            lines.forEach(line => {
                // Docker Composeのログ形式: service_name | log_message
                const match = line.match(/^([^|]+)\s*\|\s*(.+)$/);
                if (match) {
                    const [, service, message] = match;
                    const cleanService = service.trim();
                    const cleanMessage = message.trim();
                    
                    this.updateLogBuffer(cleanService, cleanMessage);
                    this.processLogLine(cleanService, cleanMessage);
                }
            });
        });

        dockerCompose.stderr.on('data', (data) => {
            console.error('Docker Compose エラー:', data.toString());
        });

        dockerCompose.on('close', (code) => {
            console.log(`Docker Compose監視が終了しました (exit code: ${code})`);
        });

        // グレースフルシャットダウン
        process.on('SIGINT', () => {
            console.log('\n監視を停止中...');
            dockerCompose.kill('SIGTERM');
            process.exit(0);
        });

        return dockerCompose;
    }
}

// CLIから実行された場合
if (require.main === module) {
    const config = {
        debug: process.argv.includes('--debug'),
        services: process.argv.includes('--services') ? 
            process.argv[process.argv.indexOf('--services') + 1].split(',') : 
            undefined
    };
    
    const monitor = new DockerLogMonitor(config);
    monitor.startMonitoring();
}

module.exports = DockerLogMonitor;