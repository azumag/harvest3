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
            // 最大Issue数（1日あたり、0で無制限）
            maxIssuesPerDay: config.maxIssuesPerDay ?? 0,
            // デバッグモード
            debug: config.debug || false,
            // 再接続設定
            reconnectEnabled: config.reconnectEnabled !== false, // デフォルトで有効
            reconnectIntervalMs: config.reconnectIntervalMs || 10 * 1000, // 10秒間隔
            maxReconnectAttempts: config.maxReconnectAttempts || -1 // -1は無制限
        };
        
        this.issueHistory = this.loadIssueHistory();
        this.logBuffer = new Map(); // サービス別ログバッファ
        this.isRunning = false;
        this.currentProcess = null;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
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
    shouldCreateIssue(errorHash, service, errorMessage) {
        const now = Date.now();
        
        // 24時間ごとにクリーンアップ
        if (now - this.issueHistory.lastCleanup > 24 * 60 * 60 * 1000) {
            this.cleanupIssueHistory();
        }

        // 1日あたりの最大Issue数チェック（0の場合は無制限）
        if (this.config.maxIssuesPerDay > 0) {
            const today = new Date().toDateString();
            const todayIssues = this.issueHistory.issues.filter(issue => 
                new Date(issue.timestamp).toDateString() === today
            );
            
            if (todayIssues.length >= this.config.maxIssuesPerDay) {
                if (this.config.debug) {
                    console.warn(`1日の最大Issue数(${this.config.maxIssuesPerDay})に達しました`);
                }
                return false;
            }
        }

        // 同じエラーハッシュのスロットリングチェック
        const recentSameError = this.issueHistory.issues.find(issue => 
            issue.errorHash === errorHash && 
            now - issue.timestamp < this.config.issueThrottleMs
        );

        if (recentSameError) {
            if (this.config.debug) {
                console.log(`⏭️  重複スキップ (ハッシュ): ${errorHash.slice(0, 50)}...`);
            }
            return false;
        }

        // 同じサービスでの類似エラーの追加チェック
        const recentSimilarError = this.issueHistory.issues.find(issue => 
            issue.service === service &&
            issue.errorType === this.extractErrorType(errorMessage) &&
            now - issue.timestamp < this.config.issueThrottleMs * 2 // より長い期間でチェック
        );

        if (recentSimilarError) {
            if (this.config.debug) {
                console.log(`⏭️  類似エラースキップ (${service}): ${this.extractErrorType(errorMessage)}`);
            }
            return false;
        }

        return true;
    }

    /**
     * エラーのハッシュ値を生成（重複チェック用）
     */
    generateErrorHash(service, errorMessage) {
        // エラーメッセージから動的な部分（時刻、ファイルパスなど）を除去
        const cleanError = errorMessage
            // タイムスタンプの正規化
            .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?([Z]|[+-]\d{2}:\d{2})?/g, '[TIMESTAMP]')
            .replace(/\d{2}:\d{2}:\d{2}/g, '[TIME]')
            // ファイルパスの正規化  
            .replace(/\/[^\s]+\/([^\/\s]+\.(js|ts|json|py))/g, '[PATH]/$1')
            .replace(/\s+at\s+[^\s]+:[^\s]+/g, ' at [LOCATION]')
            // 行番号・列番号の正規化
            .replace(/line \d+/g, 'line [NUM]')
            .replace(/column \d+/g, 'column [NUM]')
            .replace(/:\d+:\d+/g, ':[NUM]:[NUM]')
            // 時間・ID・数値の正規化
            .replace(/\d+ms/g, '[TIME]ms')
            .replace(/\b\d{13,}\b/g, '[TIMESTAMP_MS]')
            .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]')
            .replace(/\b\d{4,}\b/g, '[NUM]')
            // メモリアドレスやハッシュ値の正規化
            .replace(/0x[0-9a-f]+/gi, '[ADDR]')
            .replace(/\b[0-9a-f]{32,}\b/gi, '[HASH]')
            // URLやポート番号の正規化
            .replace(/https?:\/\/[^\s]+/g, '[URL]')
            .replace(/:\d{2,5}\b/g, ':[PORT]')
            // 空白の正規化
            .replace(/\s+/g, ' ')
            .trim();
        
        // エラータイプを抽出してより一般化
        const errorType = this.extractErrorType(cleanError);
        const generalizedError = `${errorType}:${cleanError}`;
        
        return `${service}:${generalizedError}`.slice(0, 150);
    }

    /**
     * エラータイプを抽出（より精密な分類のため）
     */
    extractErrorType(errorMessage) {
        const patterns = [
            { pattern: /TypeError/i, type: 'TypeError' },
            { pattern: /ReferenceError/i, type: 'ReferenceError' },
            { pattern: /SyntaxError/i, type: 'SyntaxError' },
            { pattern: /RangeError/i, type: 'RangeError' },
            { pattern: /URIError/i, type: 'URIError' },
            { pattern: /EvalError/i, type: 'EvalError' },
            { pattern: /UnhandledPromiseRejectionWarning/i, type: 'UnhandledPromise' },
            { pattern: /Process exited with code/i, type: 'ProcessExit' },
            { pattern: /\[ERROR\]/i, type: 'GenericError' },
            { pattern: /FATAL/i, type: 'Fatal' },
            { pattern: /Uncaught/i, type: 'Uncaught' },
            { pattern: /Connection\s+(failed|refused|timeout)/i, type: 'ConnectionError' },
            { pattern: /Database\s+error/i, type: 'DatabaseError' },
            { pattern: /Authentication\s+(failed|error)/i, type: 'AuthError' },
            { pattern: /Permission\s+denied/i, type: 'PermissionError' },
            { pattern: /File\s+not\s+found/i, type: 'FileNotFound' },
            { pattern: /Error:/i, type: 'Error' }
        ];

        for (const { pattern, type } of patterns) {
            if (pattern.test(errorMessage)) {
                return type;
            }
        }
        
        return 'Unknown';
    }

    /**
     * GitHub Issue を作成
     */
    async createGitHubIssue(service, errorMessage, logContext) {
        // ログコンテキストからスタックトレースを抽出
        const logLines = logContext.split('\n');
        const stackTrace = this.extractStackTrace(logLines);
        
        const title = `[自動] ${service}サービスで例外が発生`;
        const body = `## 概要
${service}サービスで例外が検出されました。

## エラー詳細
\`\`\`
${errorMessage}
\`\`\`

${stackTrace ? `## スタックトレース
\`\`\`
${stackTrace}
\`\`\`

` : ''}## ログコンテキスト
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
            const errorType = this.extractErrorType(line);
            
            if (this.shouldCreateIssue(errorHash, service, line)) {
                // ログコンテキストを取得（前後数行）
                const logContext = this.getLogContext(service, line);
                
                try {
                    const issueUrl = await this.createGitHubIssue(service, line, logContext);
                    
                    // Issue履歴に追加（エラータイプも含める）
                    this.issueHistory.issues.push({
                        timestamp: Date.now(),
                        service,
                        errorHash,
                        errorType,
                        issueUrl,
                        errorMessage: line.slice(0, 200) // メッセージを短縮
                    });
                    this.saveIssueHistory();
                    
                    console.log(`🚨 ${service}で例外検出 [${errorType}] -> Issue作成: ${issueUrl}`);
                } catch (error) {
                    console.error(`Issue作成失敗 (${service}):`, error.message);
                }
            } else {
                if (this.config.debug) {
                    console.log(`⏭️  重複/スロットル制限により Issue作成をスキップ: ${service} [${errorType}]`);
                }
            }
        }
    }

    /**
     * ログコンテキストを取得（バッファから前後の行）
     */
    getLogContext(service, currentLine) {
        const buffer = this.logBuffer.get(service) || [];
        const context = [...buffer, currentLine];
        return context.slice(-10).join('\n'); // 直近10行に拡大
    }

    /**
     * スタックトレースを抽出（機密情報をサニタイズ）
     */
    extractStackTrace(logLines) {
        const stackTraceLines = [];
        let inStackTrace = false;
        
        for (const line of logLines) {
            // スタックトレースの開始を検出
            if (line.includes('Error:') || line.includes('Exception:') || 
                line.includes('TypeError:') || line.includes('ReferenceError:') ||
                line.includes('at ')) {
                inStackTrace = true;
                stackTraceLines.push(line);
            } else if (inStackTrace) {
                // スタックトレースの行を検出
                if (line.trim().startsWith('at ') || 
                    line.includes('.js:') || line.includes('.ts:') ||
                    line.includes('node_modules') || line.includes('internal/')) {
                    stackTraceLines.push(line);
                } else if (line.trim() === '' || line.includes('---')) {
                    // 空行または区切り線でスタックトレース終了
                    break;
                } else {
                    // その他の行が来たらスタックトレース終了
                    break;
                }
            }
        }
        
        if (stackTraceLines.length === 0) {
            return null;
        }
        
        // 機密情報をサニタイズ
        const sanitized = stackTraceLines.map(line => {
            let sanitizedLine = line;
            
            // 絶対パスのサニタイズ（順序重要）
            sanitizedLine = sanitizedLine.replace(/\/usr\/src\/app\/[^\s:)]+/g, '[SRC_DIR]');
            sanitizedLine = sanitizedLine.replace(/\/workspaces\/[^\s:)]+/g, '[WORKSPACE]');
            sanitizedLine = sanitizedLine.replace(/\/home\/[^\s:)]+/g, '[HOME_DIR]');
            sanitizedLine = sanitizedLine.replace(/\/opt\/[^\s:)]+/g, '[OPT_DIR]');
            sanitizedLine = sanitizedLine.replace(/\/usr\/[^\s:)]+/g, '[USR_DIR]');
            sanitizedLine = sanitizedLine.replace(/\/var\/[^\s:)]+/g, '[VAR_DIR]');
            sanitizedLine = sanitizedLine.replace(/\/tmp\/[^\s:)]+/g, '[TMP_DIR]');
            sanitizedLine = sanitizedLine.replace(/\/app\/[^\s:)]+/g, '[APP_DIR]');
            
            // node_modules とinternal/ の特別処理
            sanitizedLine = sanitizedLine.replace(/[^\s]*node_modules[^\s:)]*/g, '[NODE_MODULES]');
            sanitizedLine = sanitizedLine.replace(/[^\s]*internal\/[^\s:)]*/g, '[INTERNAL]');
            
            // プロジェクト内の相対パスは保持
            sanitizedLine = sanitizedLine.replace(/\/[^\s]*\/(src\/[^\s:)]+)/g, '$1');
            sanitizedLine = sanitizedLine.replace(/\/[^\s]*\/(scripts\/[^\s:)]+)/g, '$1');
            sanitizedLine = sanitizedLine.replace(/\/[^\s]*\/(test\/[^\s:)]+)/g, '$1');
            
            return sanitizedLine;
        });
        
        return sanitized.join('\n');
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
     * 監視停止
     */
    stop() {
        console.log('\n🛑 ログ監視を停止中...');
        this.isRunning = false;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.currentProcess) {
            this.currentProcess.kill('SIGTERM');
            this.currentProcess = null;
        }
        
        console.log('✅ ログ監視を停止しました');
        
        // テスト環境では process.exit() をスキップ
        if (process.env.NODE_ENV !== 'test') {
            process.exit(0);
        }
    }

    /**
     * Docker Composeプロセスを開始
     */
    startDockerComposeProcess() {
        if (this.config.debug) {
            console.log(`📡 Docker Composeプロセスを開始 (試行回数: ${this.reconnectAttempts + 1})`);
        }

        const dockerCompose = spawn('docker', ['compose', 'logs', '-f', ...this.config.services], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.currentProcess = dockerCompose;

        dockerCompose.stdout.on('data', (data) => {
            // 再接続成功時はカウンターをリセット
            if (this.reconnectAttempts > 0) {
                console.log('✅ Docker Compose接続復旧しました');
                this.reconnectAttempts = 0;
            }

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
            const errorMessage = data.toString().trim();
            if (this.config.debug) {
                console.error('Docker Compose エラー:', errorMessage);
            }
        });

        dockerCompose.on('close', (code) => {
            if (this.config.debug) {
                console.log(`📋 Docker Compose監視が終了 (exit code: ${code})`);
            }

            // 手動停止でない場合は再接続を試行
            if (this.isRunning && this.config.reconnectEnabled) {
                this.scheduleReconnect(code);
            }
        });

        dockerCompose.on('error', (error) => {
            console.error('❌ Docker Composeプロセスエラー:', error.message);
            
            if (this.isRunning && this.config.reconnectEnabled) {
                this.scheduleReconnect(-1);
            }
        });

        return dockerCompose;
    }

    /**
     * 再接続をスケジュール
     */
    scheduleReconnect(exitCode) {
        this.reconnectAttempts++;
        
        // 最大再接続回数をチェック（-1は無制限）
        if (this.config.maxReconnectAttempts > 0 && 
            this.reconnectAttempts > this.config.maxReconnectAttempts) {
            console.error(`💥 最大再接続回数 (${this.config.maxReconnectAttempts}) に達しました。監視を終了します。`);
            this.stop();
            return;
        }

        // 再接続が無効な場合はスケジュールしない
        if (!this.config.reconnectEnabled || !this.isRunning) {
            return;
        }

        const delay = this.config.reconnectIntervalMs;
        console.log(`🔄 ${delay / 1000}秒後にDocker Compose接続を再試行... (${this.reconnectAttempts}回目)`);
        
        this.reconnectTimer = setTimeout(() => {
            if (this.isRunning) {
                this.startDockerComposeProcess();
            }
        }, delay);
    }

    /**
     * Docker Composeログを監視開始
     */
    startMonitoring() {
        console.log(`🔍 Docker Composeログ監視を開始 (対象: ${this.config.services.join(', ')})`);
        
        if (this.config.reconnectEnabled) {
            console.log(`🔄 自動再接続有効 (間隔: ${this.config.reconnectIntervalMs / 1000}秒)`);
        }
        
        this.isRunning = true;
        this.reconnectAttempts = 0;

        // グレースフルシャットダウン
        process.on('SIGINT', () => this.stop());
        process.on('SIGTERM', () => this.stop());
        process.on('exit', () => {
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
            }
        });
        process.on('uncaughtException', (error) => {
            console.error('予期しないエラー:', error);
            this.stop();
        });

        // 初回接続
        this.startDockerComposeProcess();
    }
}

// CLIから実行された場合
if (require.main === module) {
    // CLI引数のバリデーション関数
    function validateAndGetIntegerArg(argName, defaultValue, min = 1) {
        const argIndex = process.argv.indexOf(argName);
        if (argIndex === -1) {
            return defaultValue;
        }
        
        const valueIndex = argIndex + 1;
        if (valueIndex >= process.argv.length) {
            throw new Error(`${argName} に値が指定されていません`);
        }
        
        const value = parseInt(process.argv[valueIndex]);
        if (isNaN(value) || value < min) {
            throw new Error(`${argName} には ${min} 以上の整数を指定してください: ${process.argv[valueIndex]}`);
        }
        
        return value;
    }

    const config = {
        debug: process.argv.includes('--debug'),
        services: process.argv.includes('--services') ? 
            process.argv[process.argv.indexOf('--services') + 1].split(',') : 
            undefined,
        reconnectEnabled: !process.argv.includes('--no-reconnect'),
        reconnectIntervalMs: process.argv.includes('--reconnect-interval') ?
            validateAndGetIntegerArg('--reconnect-interval', undefined, 1) * 1000 : undefined,
        maxReconnectAttempts: process.argv.includes('--max-reconnect') ?
            validateAndGetIntegerArg('--max-reconnect', undefined, 1) : undefined
    };
    
    const monitor = new DockerLogMonitor(config);
    monitor.startMonitoring();
}

module.exports = DockerLogMonitor;