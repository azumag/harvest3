/**
 * 統合システム監視 - 設定値乖離とスロットル状況の包括的監視
 */

const ThrottleMonitor = require('./throttleMonitor');
const path = require('path');
const fs = require('fs');

class SystemMonitor {
    constructor(options = {}) {
        this.options = {
            configCheckInterval: options.configCheckInterval || 300000, // 5分間隔
            alertCooldown: options.alertCooldown || 60000, // 1分間のクールダウン
            enableConfigValidation: options.enableConfigValidation !== false,
            enableThrottleMonitoring: options.enableThrottleMonitoring !== false,
            ...options
        };
        
        this.throttleMonitor = new ThrottleMonitor(options.throttleOptions);
        this.configCheckTimer = null;
        this.lastConfigCheck = 0;
        this.isRunning = false;
        
        this.setupEventHandlers();
    }
    
    /**
     * 監視開始
     */
    start() {
        if (this.isRunning) {
            console.log('[SystemMonitor] 既に実行中です');
            return this;
        }
        
        this.isRunning = true;
        console.log('[SystemMonitor] システム監視開始');
        
        // スロットル監視開始
        if (this.options.enableThrottleMonitoring) {
            this.throttleMonitor.startMonitoring();
        }
        
        // 設定値検証開始
        if (this.options.enableConfigValidation) {
            this.startConfigValidation();
        }
        
        return this;
    }
    
    /**
     * 監視停止
     */
    stop() {
        if (!this.isRunning) {
            return this;
        }
        
        this.isRunning = false;
        console.log('[SystemMonitor] システム監視停止');
        
        // スロットル監視停止
        this.throttleMonitor.stopMonitoring();
        
        // 設定値検証停止
        if (this.configCheckTimer) {
            clearInterval(this.configCheckTimer);
            this.configCheckTimer = null;
        }
        
        return this;
    }
    
    /**
     * 取引所をスロットル監視に追加
     */
    addExchange(exchangeId, exchange) {
        this.throttleMonitor.addExchange(exchangeId, exchange);
        return this;
    }
    
    /**
     * 設定値検証の開始
     */
    startConfigValidation() {
        // 初回実行
        this.validateConfig();
        
        // 定期実行
        this.configCheckTimer = setInterval(() => {
            this.validateConfig();
        }, this.options.configCheckInterval);
        
        console.log('[SystemMonitor] 設定値検証開始');
    }
    
    /**
     * 設定値の検証実行
     */
    async validateConfig() {
        try {
            const now = Date.now();
            this.lastConfigCheck = now;
            
            // validate-config.shスクリプトを実行
            const { spawn } = require('child_process');
            const scriptPath = path.join(process.cwd(), 'scripts', 'validate-config.sh');
            
            if (!fs.existsSync(scriptPath)) {
                console.warn('[SystemMonitor] 設定検証スクリプトが見つかりません:', scriptPath);
                return;
            }
            
            const validation = spawn('bash', [scriptPath, '--check-readme-consistency'], {
                stdio: 'pipe'
            });
            
            let output = '';
            let errorOutput = '';
            
            validation.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            validation.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            validation.on('close', (code) => {
                if (code === 0) {
                    console.log('[SystemMonitor] 設定値検証: OK');
                } else {
                    console.error('[SystemMonitor] 設定値乖離検出');
                    this.handleConfigValidationError(output, errorOutput);
                }
            });
            
        } catch (error) {
            console.error('[SystemMonitor] 設定値検証エラー:', error.message);
        }
    }
    
    /**
     * 設定値検証エラーの処理
     */
    handleConfigValidationError(output, errorOutput) {
        const alert = {
            type: 'config_validation_error',
            timestamp: Date.now(),
            output: output.trim(),
            errorOutput: errorOutput.trim(),
            suggestion: '設定ファイルとREADMEの乖離が検出されました。scripts/generate-config-docs.sh --update-readmeで自動修正できます。'
        };
        
        console.error('🚨 設定値乖離アラート:', alert);
        
        // 外部への通知（Discord等）が必要な場合はここで実装
        this.emitAlert('config:validation:error', alert);
    }
    
    /**
     * 包括的な状態取得
     */
    getStatus() {
        const throttleStatus = this.throttleMonitor.getStatus();
        
        return {
            isRunning: this.isRunning,
            timestamp: Date.now(),
            throttleMonitoring: throttleStatus,
            configValidation: {
                enabled: this.options.enableConfigValidation,
                lastCheck: this.lastConfigCheck,
                nextCheck: this.lastConfigCheck + this.options.configCheckInterval
            },
            summary: {
                healthy: throttleStatus.summary.critical === 0 && throttleStatus.summary.warning === 0,
                totalExchanges: throttleStatus.summary.total,
                issues: throttleStatus.summary.warning + throttleStatus.summary.critical
            }
        };
    }
    
    /**
     * ヘルスチェック用のエンドポイント
     */
    getHealthCheck() {
        const status = this.getStatus();
        
        return {
            status: status.summary.healthy ? 'healthy' : 'unhealthy',
            timestamp: status.timestamp,
            checks: {
                systemMonitor: this.isRunning ? 'pass' : 'fail',
                throttleMonitor: status.throttleMonitoring.isMonitoring ? 'pass' : 'fail',
                configValidation: status.configValidation.enabled ? 'pass' : 'warn'
            },
            details: status
        };
    }
    
    /**
     * アラートの送信
     */
    emitAlert(type, data) {
        const alert = {
            type,
            timestamp: Date.now(),
            source: 'SystemMonitor',
            data
        };
        
        // 外部システム（Discord, Slack等）への通知が必要な場合はここで実装
        console.log('📢 System Alert:', alert);
    }
    
    /**
     * イベントハンドラーの設定
     */
    setupEventHandlers() {
        // スロットル監視のイベントを転送
        this.throttleMonitor.on('throttle:warning', (data) => {
            this.emitAlert('throttle:warning', data);
        });
        
        this.throttleMonitor.on('throttle:critical', (data) => {
            this.emitAlert('throttle:critical', data);
        });
        
        this.throttleMonitor.on('throttle:recovery', (data) => {
            this.emitAlert('throttle:recovery', data);
        });
        
        this.throttleMonitor.on('rateLimit:adjusted', (data) => {
            console.log(`[SystemMonitor] レート制限自動調整: ${data.exchangeId} (${data.action})`);
        });
        
        // プロセス終了時のクリーンアップ
        process.on('SIGINT', () => {
            console.log('[SystemMonitor] SIGINT受信、監視を停止します...');
            this.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.log('[SystemMonitor] SIGTERM受信、監視を停止します...');
            this.stop();
            process.exit(0);
        });
    }
    
    /**
     * 設定値の自動修正を試行
     */
    async attemptAutoFix() {
        try {
            console.log('[SystemMonitor] 設定値自動修正を試行...');
            
            const { spawn } = require('child_process');
            const scriptPath = path.join(process.cwd(), 'scripts', 'generate-config-docs.sh');
            
            if (!fs.existsSync(scriptPath)) {
                throw new Error('自動修正スクリプトが見つかりません');
            }
            
            const autoFix = spawn('bash', [scriptPath, '--update-readme'], {
                stdio: 'pipe'
            });
            
            return new Promise((resolve, reject) => {
                autoFix.on('close', (code) => {
                    if (code === 0) {
                        console.log('[SystemMonitor] 設定値自動修正完了');
                        resolve(true);
                    } else {
                        reject(new Error(`自動修正失敗: exit code ${code}`));
                    }
                });
            });
            
        } catch (error) {
            console.error('[SystemMonitor] 自動修正エラー:', error.message);
            return false;
        }
    }
}

module.exports = SystemMonitor;