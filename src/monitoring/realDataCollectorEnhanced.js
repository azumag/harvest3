/**
 * 実データ収集システム（強化版）- エラーハンドリングと耐障害性を実装
 * 異常系の考慮、詳細なメトリクス、リトライ機構を含む
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class RealDataCollectorEnhanced extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = {
            collectionInterval: options.collectionInterval || 60000,
            dataRetention: options.dataRetention || 30 * 24 * 60 * 60 * 1000,
            dataFile: options.dataFile || path.join(__dirname, '../../data/enhanced-performance-data.json'),
            errorLogFile: options.errorLogFile || path.join(__dirname, '../../data/error-log.json'),
            backupInterval: options.backupInterval || 24 * 60 * 60 * 1000,
            maxFileSize: options.maxFileSize || 100 * 1024 * 1024, // 100MB
            
            // リトライ設定
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            backoffMultiplier: options.backoffMultiplier || 2,
            
            // タイムアウト設定
            apiTimeout: options.apiTimeout || 10000,
            
            // エラー閾値
            errorThreshold: options.errorThreshold || 0.1, // 10%エラー率で警告
            criticalErrorThreshold: options.criticalErrorThreshold || 0.3, // 30%でクリティカル
            
            ...options
        };
        
        this.collectionTimer = null;
        this.backupTimer = null;
        this.isCollecting = false;
        this.collectedData = [];
        this.errorLog = [];
        this.statistics = {
            totalAttempts: 0,
            successfulAttempts: 0,
            failedAttempts: 0,
            errorTypes: {},
            responseTimes: [],
            memoryUsage: [],
            cpuUsage: []
        };
        
        this.ensureDataDirectory();
        this.loadExistingData();
    }
    
    /**
     * データディレクトリの確保
     */
    ensureDataDirectory() {
        const dataDir = path.dirname(this.options.dataFile);
        const errorDir = path.dirname(this.options.errorLogFile);
        
        [dataDir, errorDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }
    
    /**
     * 既存データの読み込み（エラーログを含む）
     */
    loadExistingData() {
        try {
            // メインデータの読み込み
            if (fs.existsSync(this.options.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.options.dataFile, 'utf8'));
                this.collectedData = Array.isArray(data.measurements) ? data.measurements : [];
                
                // 統計情報の復元
                if (data.statistics) {
                    this.statistics = { ...this.statistics, ...data.statistics };
                }
                
                console.log(`[EnhancedCollector] 既存データ読み込み: ${this.collectedData.length}件`);
            }
            
            // エラーログの読み込み
            if (fs.existsSync(this.options.errorLogFile)) {
                const errorData = JSON.parse(fs.readFileSync(this.options.errorLogFile, 'utf8'));
                this.errorLog = Array.isArray(errorData) ? errorData : [];
                console.log(`[EnhancedCollector] 既存エラーログ読み込み: ${this.errorLog.length}件`);
            }
            
        } catch (error) {
            console.error('[EnhancedCollector] データ読み込みエラー:', error.message);
            this.emit('error', { type: 'data_load_error', error });
        }
    }
    
    /**
     * データ収集開始
     */
    startCollection(exchanges = []) {
        if (this.isCollecting) {
            console.log('[EnhancedCollector] 既に収集中です');
            return this;
        }
        
        this.isCollecting = true;
        this.exchanges = exchanges;
        this.startTime = Date.now(); // デバッグ用の開始時刻記録
        
        console.log('[EnhancedCollector] 強化版実データ収集開始');
        console.log(`収集対象: ${exchanges.length}個の取引所`);
        console.log(`収集間隔: ${this.options.collectionInterval / 1000}秒`);
        console.log(`エラー閾値: ${this.options.errorThreshold * 100}%`);
        
        // 即座に初回収集
        this.collectDataPoint();
        
        // 定期収集開始
        this.collectionTimer = setInterval(() => {
            this.collectDataPoint();
        }, this.options.collectionInterval);
        
        // 定期バックアップ開始
        this.backupTimer = setInterval(() => {
            this.createBackup();
        }, this.options.backupInterval);
        
        // エラー率監視
        this.monitorErrorRate();
        
        return this;
    }
    
    /**
     * データ収集停止
     */
    stopCollection() {
        if (!this.isCollecting) {
            return this;
        }
        
        this.isCollecting = false;
        
        if (this.collectionTimer) {
            clearInterval(this.collectionTimer);
            this.collectionTimer = null;
        }
        
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = null;
        }
        
        // 最終データ保存
        this.saveData();
        this.saveErrorLog();
        
        console.log('[EnhancedCollector] 実データ収集停止');
        this.displayFinalStatistics();
        
        return this;
    }
    
    /**
     * 単一データポイントの収集（エラーハンドリング強化）
     */
    async collectDataPoint() {
        const timestamp = Date.now();
        const dataPoint = {
            timestamp,
            systemMetrics: this.collectSystemMetrics(),
            exchanges: {},
            errors: []
        };
        
        // 各取引所のメトリクス収集
        for (const exchange of this.exchanges) {
            this.statistics.totalAttempts++;
            
            try {
                const exchangeMetrics = await this.collectExchangeMetricsWithRetry(exchange);
                dataPoint.exchanges[exchange.id] = exchangeMetrics;
                this.statistics.successfulAttempts++;
            } catch (error) {
                this.statistics.failedAttempts++;
                
                // エラーの詳細記録
                const errorDetails = this.categorizeError(error);
                dataPoint.errors.push({
                    exchangeId: exchange.id,
                    timestamp,
                    ...errorDetails
                });
                
                // エラーログに追加
                this.logError(exchange.id, errorDetails);
                
                // エラータイプの統計更新
                this.statistics.errorTypes[errorDetails.type] = (this.statistics.errorTypes[errorDetails.type] || 0) + 1;
                
                // エラーメトリクスとして記録
                dataPoint.exchanges[exchange.id] = {
                    error: true,
                    errorType: errorDetails.type,
                    errorMessage: errorDetails.message,
                    timestamp
                };
            }
        }
        
        // データ追加
        this.collectedData.push(dataPoint);
        
        // 統計更新
        this.updateStatistics(dataPoint);
        
        // 古いデータの削除
        this.cleanupOldData();
        
        // 定期保存
        if (this.collectedData.length % 10 === 0) {
            this.saveData();
            this.saveErrorLog();
        }
        
        // ファイルサイズチェック
        this.checkFileSize();
        
        const successRate = this.calculateSuccessRate();
        console.log(`[EnhancedCollector] データポイント収集: ${this.collectedData.length}件 (成功率: ${(successRate * 100).toFixed(1)}%)`);
        
        // イベント発火
        this.emit('data_collected', { dataPoint, statistics: this.getRealtimeStatistics() });
    }
    
    /**
     * リトライ機構付き取引所メトリクス収集
     */
    async collectExchangeMetricsWithRetry(exchange, retryCount = 0) {
        const maxRetries = this.options.maxRetries;
        
        try {
            // タイムアウト付きでメトリクス収集
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout')), this.options.apiTimeout)
            );
            
            const metricsPromise = this.collectExchangeMetrics(exchange);
            
            const metrics = await Promise.race([metricsPromise, timeoutPromise]);
            
            return metrics;
            
        } catch (error) {
            if (retryCount < maxRetries) {
                const delay = this.options.retryDelay * Math.pow(this.options.backoffMultiplier, retryCount);
                console.warn(`[EnhancedCollector] ${exchange.id} リトライ ${retryCount + 1}/${maxRetries} (${delay}ms待機)`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.collectExchangeMetricsWithRetry(exchange, retryCount + 1);
            }
            
            throw error;
        }
    }
    
    /**
     * 取引所メトリクスの収集（詳細版）
     */
    async collectExchangeMetrics(exchange) {
        const startTime = Date.now();
        let apiResponseTime = null;
        let apiSuccess = false;
        let apiError = null;
        let queueSize = 0;
        let apiCallType = 'unknown';
        
        try {
            // API応答時間測定
            const startApiTime = Date.now();
            
            // 異なるAPIエンドポイントをテスト
            if (exchange.fetchStatus) {
                apiCallType = 'fetchStatus';
                await exchange.fetchStatus();
            } else if (exchange.fetchTime) {
                apiCallType = 'fetchTime';
                await exchange.fetchTime();
            } else if (exchange.fetchTicker) {
                apiCallType = 'fetchTicker';
                const symbols = Object.keys(exchange.markets || {});
                if (symbols.length > 0) {
                    await exchange.fetchTicker(symbols[0]);
                }
            } else {
                throw new Error('No suitable API method available');
            }
            
            apiResponseTime = Date.now() - startApiTime;
            apiSuccess = true;
            
            // 応答時間の記録
            this.statistics.responseTimes.push(apiResponseTime);
            
        } catch (error) {
            apiResponseTime = Date.now() - startTime;
            apiSuccess = false;
            apiError = error.message;
            
            // エラーを再発生させる
            throw error;
        }
        
        // キューサイズの取得
        try {
            if (exchange.throttle && exchange.throttle.queue) {
                queueSize = exchange.throttle.queue.length || 0;
            }
        } catch (error) {
            // キューサイズ取得失敗は無視
        }
        
        return {
            exchangeId: exchange.id,
            timestamp: Date.now(),
            api: {
                responseTime: apiResponseTime,
                success: apiSuccess,
                error: apiError,
                callType: apiCallType
            },
            throttle: {
                queueSize,
                rateLimit: exchange.rateLimit || null,
                last: exchange.last || null
            },
            config: {
                enableRateLimit: exchange.enableRateLimit || false,
                timeout: exchange.timeout || null
            },
            totalTime: Date.now() - startTime
        };
    }
    
    /**
     * システムメトリクスの収集（詳細版）
     */
    collectSystemMetrics() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        // メモリとCPU使用率の記録
        this.statistics.memoryUsage.push(memUsage.heapUsed);
        this.statistics.cpuUsage.push(cpuUsage.user + cpuUsage.system);
        
        // 直近100件のみ保持
        if (this.statistics.memoryUsage.length > 100) {
            this.statistics.memoryUsage.shift();
        }
        if (this.statistics.cpuUsage.length > 100) {
            this.statistics.cpuUsage.shift();
        }
        
        return {
            timestamp: Date.now(),
            memory: {
                rss: memUsage.rss,
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                arrayBuffers: memUsage.arrayBuffers || 0
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system,
                percent: this.calculateCPUPercent(cpuUsage)
            },
            uptime: process.uptime(),
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            loadAverage: process.platform === 'linux' || process.platform === 'darwin' ? 
                require('os').loadavg() : [0, 0, 0]
        };
    }
    
    /**
     * CPU使用率の計算
     */
    calculateCPUPercent(cpuUsage) {
        // 簡易的なCPU使用率計算
        const totalTime = cpuUsage.user + cpuUsage.system;
        const uptime = process.uptime() * 1000000; // マイクロ秒に変換
        return Math.min((totalTime / uptime) * 100, 100);
    }
    
    /**
     * エラーの分類
     */
    categorizeError(error) {
        const errorString = error.toString().toLowerCase();
        
        if (errorString.includes('timeout')) {
            return { type: 'timeout', message: error.message, severity: 'high' };
        } else if (errorString.includes('network') || errorString.includes('enotfound')) {
            return { type: 'network', message: error.message, severity: 'critical' };
        } else if (errorString.includes('rate') || errorString.includes('throttle')) {
            return { type: 'rate_limit', message: error.message, severity: 'medium' };
        } else if (errorString.includes('auth') || errorString.includes('permission')) {
            return { type: 'authentication', message: error.message, severity: 'critical' };
        } else if (errorString.includes('invalid') || errorString.includes('parse')) {
            return { type: 'invalid_response', message: error.message, severity: 'medium' };
        } else {
            return { type: 'unknown', message: error.message, severity: 'low' };
        }
    }
    
    /**
     * エラーログ記録
     */
    logError(exchangeId, errorDetails) {
        const errorEntry = {
            timestamp: new Date().toISOString(),
            exchangeId,
            ...errorDetails,
            context: {
                totalAttempts: this.statistics.totalAttempts,
                currentErrorRate: this.calculateErrorRate()
            }
        };
        
        this.errorLog.push(errorEntry);
        
        // エラーログサイズ制限（最新1000件）
        if (this.errorLog.length > 1000) {
            this.errorLog = this.errorLog.slice(-1000);
        }
        
        // 高severity のエラーはイベント発火
        if (errorDetails.severity === 'critical' || errorDetails.severity === 'high') {
            this.emit('critical_error', errorEntry);
        }
    }
    
    /**
     * 統計情報の更新
     */
    updateStatistics(dataPoint) {
        // 応答時間のトリミング（最新1000件）
        if (this.statistics.responseTimes.length > 1000) {
            this.statistics.responseTimes = this.statistics.responseTimes.slice(-1000);
        }
    }
    
    /**
     * エラー率の監視
     */
    monitorErrorRate() {
        setInterval(() => {
            const errorRate = this.calculateErrorRate();
            
            if (errorRate > this.options.criticalErrorThreshold) {
                console.error(`[EnhancedCollector] 🚨 クリティカル: エラー率 ${(errorRate * 100).toFixed(1)}%`);
                this.emit('critical_error_rate', { errorRate, threshold: this.options.criticalErrorThreshold });
            } else if (errorRate > this.options.errorThreshold) {
                console.warn(`[EnhancedCollector] ⚠️ 警告: エラー率 ${(errorRate * 100).toFixed(1)}%`);
                this.emit('high_error_rate', { errorRate, threshold: this.options.errorThreshold });
            }
        }, 60000); // 1分ごとに監視
    }
    
    /**
     * 成功率の計算
     */
    calculateSuccessRate() {
        const total = this.statistics.totalAttempts;
        if (total === 0) return 1;
        return this.statistics.successfulAttempts / total;
    }
    
    /**
     * エラー率の計算
     */
    calculateErrorRate() {
        const total = this.statistics.totalAttempts;
        if (total === 0) return 0;
        return this.statistics.failedAttempts / total;
    }
    
    /**
     * リアルタイム統計の取得
     */
    getRealtimeStatistics() {
        const responseTimes = this.statistics.responseTimes;
        const sortedTimes = [...responseTimes].sort((a, b) => a - b);
        
        return {
            totalDataPoints: this.collectedData.length,
            successRate: this.calculateSuccessRate(),
            errorRate: this.calculateErrorRate(),
            totalErrors: this.statistics.failedAttempts,
            errorTypes: this.statistics.errorTypes,
            responseTimeStats: responseTimes.length > 0 ? {
                min: Math.min(...responseTimes),
                max: Math.max(...responseTimes),
                avg: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
                p50: this.calculatePercentile(sortedTimes, 0.5),
                p90: this.calculatePercentile(sortedTimes, 0.9),
                p95: this.calculatePercentile(sortedTimes, 0.95),
                p99: this.calculatePercentile(sortedTimes, 0.99)
            } : null,
            memoryStats: this.statistics.memoryUsage.length > 0 ? {
                current: this.statistics.memoryUsage[this.statistics.memoryUsage.length - 1],
                avg: this.statistics.memoryUsage.reduce((a, b) => a + b, 0) / this.statistics.memoryUsage.length,
                max: Math.max(...this.statistics.memoryUsage)
            } : null
        };
    }
    
    /**
     * パーセンタイル計算
     */
    calculatePercentile(sortedArray, percentile) {
        if (sortedArray.length === 0) return 0;
        
        const index = Math.floor(sortedArray.length * percentile);
        const clampedIndex = Math.max(0, Math.min(index, sortedArray.length - 1));
        return sortedArray[clampedIndex];
    }
    
    /**
     * 古いデータの削除
     */
    cleanupOldData() {
        const cutoffTime = Date.now() - this.options.dataRetention;
        const originalLength = this.collectedData.length;
        
        this.collectedData = this.collectedData.filter(point => point.timestamp > cutoffTime);
        
        const removed = originalLength - this.collectedData.length;
        if (removed > 0) {
            console.log(`[EnhancedCollector] 古いデータ削除: ${removed}件`);
        }
    }
    
    /**
     * データ保存（統計情報を含む）
     */
    saveData() {
        try {
            const dataToSave = {
                metadata: {
                    version: '2.0.0',
                    collectionStarted: this.isCollecting,
                    totalMeasurements: this.collectedData.length,
                    dataRetentionDays: this.options.dataRetention / (24 * 60 * 60 * 1000),
                    lastUpdated: new Date().toISOString()
                },
                statistics: {
                    ...this.statistics,
                    responseTimes: this.statistics.responseTimes.slice(-100), // 最新100件のみ保存
                    memoryUsage: this.statistics.memoryUsage.slice(-100),
                    cpuUsage: this.statistics.cpuUsage.slice(-100)
                },
                measurements: this.collectedData
            };
            
            fs.writeFileSync(this.options.dataFile, JSON.stringify(dataToSave, null, 2));
            console.log(`[EnhancedCollector] データ保存完了: ${this.collectedData.length}件`);
            
        } catch (error) {
            console.error('[EnhancedCollector] データ保存エラー:', error.message);
            this.emit('save_error', error);
        }
    }
    
    /**
     * エラーログ保存
     */
    saveErrorLog() {
        try {
            fs.writeFileSync(this.options.errorLogFile, JSON.stringify(this.errorLog, null, 2));
        } catch (error) {
            console.error('[EnhancedCollector] エラーログ保存エラー:', error.message);
        }
    }
    
    /**
     * バックアップ作成
     */
    createBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = this.options.dataFile.replace('.json', `_backup_${timestamp}.json`);
            
            if (fs.existsSync(this.options.dataFile)) {
                fs.copyFileSync(this.options.dataFile, backupFile);
                console.log(`[EnhancedCollector] バックアップ作成: ${backupFile}`);
            }
            
            // エラーログのバックアップも作成
            const errorBackupFile = this.options.errorLogFile.replace('.json', `_backup_${timestamp}.json`);
            if (fs.existsSync(this.options.errorLogFile)) {
                fs.copyFileSync(this.options.errorLogFile, errorBackupFile);
            }
        } catch (error) {
            console.warn('[EnhancedCollector] バックアップ作成エラー:', error.message);
        }
    }
    
    /**
     * ファイルサイズチェック
     */
    checkFileSize() {
        try {
            if (fs.existsSync(this.options.dataFile)) {
                const stats = fs.statSync(this.options.dataFile);
                if (stats.size > this.options.maxFileSize) {
                    console.warn(`[EnhancedCollector] ファイルサイズ警告: ${Math.round(stats.size / 1024 / 1024)}MB`);
                    
                    // 古いデータの強制削除
                    const halfRetention = this.options.dataRetention / 2;
                    const cutoffTime = Date.now() - halfRetention;
                    this.collectedData = this.collectedData.filter(point => point.timestamp > cutoffTime);
                    this.saveData();
                }
            }
        } catch (error) {
            console.warn('[EnhancedCollector] ファイルサイズチェックエラー:', error.message);
        }
    }
    
    /**
     * 最終統計の表示
     */
    displayFinalStatistics() {
        const stats = this.getRealtimeStatistics();
        
        console.log('\n📊 最終収集統計');
        console.log('=================');
        console.log(`総データポイント: ${stats.totalDataPoints}`);
        console.log(`成功率: ${(stats.successRate * 100).toFixed(1)}%`);
        console.log(`エラー率: ${(stats.errorRate * 100).toFixed(1)}%`);
        console.log(`総エラー数: ${stats.totalErrors}`);
        
        if (stats.errorTypes && Object.keys(stats.errorTypes).length > 0) {
            console.log('\nエラー種別:');
            Object.entries(stats.errorTypes).forEach(([type, count]) => {
                console.log(`  ${type}: ${count}件`);
            });
        }
        
        if (stats.responseTimeStats) {
            console.log('\n応答時間統計:');
            console.log(`  最小: ${stats.responseTimeStats.min}ms`);
            console.log(`  平均: ${Math.round(stats.responseTimeStats.avg)}ms`);
            console.log(`  最大: ${stats.responseTimeStats.max}ms`);
            console.log(`  P50: ${stats.responseTimeStats.p50}ms`);
            console.log(`  P90: ${stats.responseTimeStats.p90}ms`);
            console.log(`  P95: ${stats.responseTimeStats.p95}ms`);
            console.log(`  P99: ${stats.responseTimeStats.p99}ms`);
        }
        
        if (stats.memoryStats) {
            console.log('\nメモリ使用量:');
            console.log(`  現在: ${Math.round(stats.memoryStats.current / 1024 / 1024)}MB`);
            console.log(`  平均: ${Math.round(stats.memoryStats.avg / 1024 / 1024)}MB`);
            console.log(`  最大: ${Math.round(stats.memoryStats.max / 1024 / 1024)}MB`);
        }
    }
}

module.exports = RealDataCollectorEnhanced;