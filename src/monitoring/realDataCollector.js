/**
 * 実データ収集システム - 理論値から実証値への移行
 * 30日間の実データ収集を必須タスクとして実行
 */

const fs = require('fs');
const path = require('path');

class RealDataCollector {
    constructor(options = {}) {
        this.options = {
            collectionInterval: options.collectionInterval || 60000, // 1分間隔
            dataRetention: options.dataRetention || 30 * 24 * 60 * 60 * 1000, // 30日
            dataFile: options.dataFile || path.join(__dirname, '../../data/real-performance-data.json'),
            backupInterval: options.backupInterval || 24 * 60 * 60 * 1000, // 24時間
            maxFileSize: options.maxFileSize || 50 * 1024 * 1024, // 50MB
            ...options
        };
        
        this.collectionTimer = null;
        this.backupTimer = null;
        this.isCollecting = false;
        this.collectedData = [];
        
        // データディレクトリの作成
        this.ensureDataDirectory();
    }
    
    /**
     * データディレクトリの確保
     */
    ensureDataDirectory() {
        const dataDir = path.dirname(this.options.dataFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // 既存データの読み込み
        this.loadExistingData();
    }
    
    /**
     * 既存データの読み込み
     */
    loadExistingData() {
        try {
            if (fs.existsSync(this.options.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.options.dataFile, 'utf8'));
                this.collectedData = Array.isArray(data.measurements) ? data.measurements : [];
                console.log(`[RealDataCollector] 既存データ読み込み: ${this.collectedData.length}件`);
            }
        } catch (error) {
            console.warn('[RealDataCollector] 既存データ読み込みエラー:', error.message);
            this.collectedData = [];
        }
    }
    
    /**
     * データ収集開始
     */
    startCollection(exchanges = []) {
        if (this.isCollecting) {
            console.log('[RealDataCollector] 既に収集中です');
            return this;
        }
        
        this.isCollecting = true;
        this.exchanges = exchanges;
        
        console.log('[RealDataCollector] 実データ収集開始');
        console.log(`収集対象: ${exchanges.length}個の取引所`);
        console.log(`収集間隔: ${this.options.collectionInterval / 1000}秒`);
        console.log(`保存先: ${this.options.dataFile}`);
        
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
        
        console.log('[RealDataCollector] 実データ収集停止');
        return this;
    }
    
    /**
     * 単一データポイントの収集
     */
    async collectDataPoint() {
        const timestamp = Date.now();
        const dataPoint = {
            timestamp,
            systemMetrics: this.collectSystemMetrics(),
            exchanges: {}
        };
        
        // 各取引所のメトリクス収集
        for (const exchange of this.exchanges) {
            try {
                const exchangeMetrics = await this.collectExchangeMetrics(exchange);
                dataPoint.exchanges[exchange.id] = exchangeMetrics;
            } catch (error) {
                console.warn(`[RealDataCollector] ${exchange.id} メトリクス収集エラー:`, error.message);
                dataPoint.exchanges[exchange.id] = {
                    error: error.message,
                    timestamp
                };
            }
        }
        
        // データ追加
        this.collectedData.push(dataPoint);
        
        // 古いデータの削除
        this.cleanupOldData();
        
        // 定期保存
        if (this.collectedData.length % 10 === 0) { // 10件ごとに保存
            this.saveData();
        }
        
        // ファイルサイズチェック
        this.checkFileSize();
        
        console.log(`[RealDataCollector] データポイント収集: ${this.collectedData.length}件 (${new Date(timestamp).toISOString()})`);
    }
    
    /**
     * システムメトリクスの収集
     */
    collectSystemMetrics() {
        const memUsage = process.memoryUsage();
        
        return {
            timestamp: Date.now(),
            memory: {
                rss: memUsage.rss,
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external
            },
            uptime: process.uptime(),
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            cpuUsage: process.cpuUsage()
        };
    }
    
    /**
     * 取引所メトリクスの収集
     */
    async collectExchangeMetrics(exchange) {
        const startTime = Date.now();
        let apiResponseTime = null;
        let apiSuccess = false;
        let apiError = null;
        let queueSize = 0;
        
        try {
            // API応答時間測定（軽量なAPI呼び出し）
            const startApiTime = Date.now();
            
            // fetchTickerの代わりに軽量なAPIを使用
            if (exchange.fetchStatus) {
                await exchange.fetchStatus();
            } else if (exchange.fetchTime) {
                await exchange.fetchTime();
            } else {
                // 最後の手段としてfetchTicker（軽量なシンボル）
                const symbols = Object.keys(exchange.markets || {});
                if (symbols.length > 0) {
                    await exchange.fetchTicker(symbols[0]);
                }
            }
            
            apiResponseTime = Date.now() - startApiTime;
            apiSuccess = true;
            
        } catch (error) {
            apiResponseTime = Date.now() - startTime;
            apiSuccess = false;
            apiError = error.message;
        }
        
        // キューサイズの推定
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
                error: apiError
            },
            throttle: {
                queueSize,
                rateLimit: exchange.rateLimit || null,
                last: exchange.last || null
            },
            config: {
                enableRateLimit: exchange.enableRateLimit || false,
                timeout: exchange.timeout || null
            }
        };
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
            console.log(`[RealDataCollector] 古いデータ削除: ${removed}件`);
        }
    }
    
    /**
     * データ保存
     */
    saveData() {
        try {
            const dataToSave = {
                metadata: {
                    version: '1.0.0',
                    collectionStarted: this.isCollecting,
                    totalMeasurements: this.collectedData.length,
                    dataRetentionDays: this.options.dataRetention / (24 * 60 * 60 * 1000),
                    lastUpdated: new Date().toISOString()
                },
                measurements: this.collectedData
            };
            
            fs.writeFileSync(this.options.dataFile, JSON.stringify(dataToSave, null, 2));
            console.log(`[RealDataCollector] データ保存完了: ${this.collectedData.length}件`);
            
        } catch (error) {
            console.error('[RealDataCollector] データ保存エラー:', error.message);
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
                console.log(`[RealDataCollector] バックアップ作成: ${backupFile}`);
            }
        } catch (error) {
            console.warn('[RealDataCollector] バックアップ作成エラー:', error.message);
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
                    console.warn(`[RealDataCollector] ファイルサイズ警告: ${Math.round(stats.size / 1024 / 1024)}MB > ${Math.round(this.options.maxFileSize / 1024 / 1024)}MB`);
                    
                    // 古いデータの強制削除
                    const halfRetention = this.options.dataRetention / 2;
                    const cutoffTime = Date.now() - halfRetention;
                    this.collectedData = this.collectedData.filter(point => point.timestamp > cutoffTime);
                    this.saveData();
                }
            }
        } catch (error) {
            console.warn('[RealDataCollector] ファイルサイズチェックエラー:', error.message);
        }
    }
    
    /**
     * 収集統計の取得
     */
    getCollectionStats() {
        const now = Date.now();
        const last24h = now - (24 * 60 * 60 * 1000);
        const last7d = now - (7 * 24 * 60 * 60 * 1000);
        
        const recent24h = this.collectedData.filter(d => d.timestamp > last24h);
        const recent7d = this.collectedData.filter(d => d.timestamp > last7d);
        
        return {
            total: this.collectedData.length,
            isCollecting: this.isCollecting,
            dataFile: this.options.dataFile,
            fileExists: fs.existsSync(this.options.dataFile),
            fileSize: fs.existsSync(this.options.dataFile) ? fs.statSync(this.options.dataFile).size : 0,
            coverage: {
                last24hours: recent24h.length,
                last7days: recent7d.length,
                totalDays: this.collectedData.length > 0 ? 
                    Math.round((now - this.collectedData[0].timestamp) / (24 * 60 * 60 * 1000) * 10) / 10 : 0
            },
            exchanges: this.exchanges ? this.exchanges.map(e => e.id) : []
        };
    }
}

module.exports = RealDataCollector;