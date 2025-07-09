/**
 * データ収集の基底クラス
 * realDataCollector と realDataCollectorEnhanced で共有される共通機能
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class BaseDataCollector extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      collectionInterval: 60000, // 1分
      dataFile: './reports/real-data-analysis.json',
      backupInterval: 3600000, // 1時間
      maxBackups: 24, // 最大24個のバックアップを保持
      retryDelay: 5000,
      maxRetries: 3,
      ...options
    };

    // 共通プロパティ
    this.isCollecting = false;
    this.exchanges = [];
    this.collectedData = [];
    this.collectionTimer = null;
    this.backupTimer = null;
    this.statistics = {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      responseTimes: [],
      startTime: null,
      lastSuccessTime: null,
      errorTypes: {}
    };

    // ディレクトリの存在確認・作成
    this.ensureDirectoryExists(this.options.dataFile);
    this.loadExistingData();
  }

  /**
     * ディレクトリが存在しない場合は作成
     */
  ensureDirectoryExists(filePath) {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
      console.log(`[BaseDataCollector] ディレクトリを作成しました: ${directory}`);
    }
  }

  /**
     * 既存データの読み込み
     */
  loadExistingData() {
    try {
      if (fs.existsSync(this.options.dataFile)) {
        const data = JSON.parse(fs.readFileSync(this.options.dataFile, 'utf8'));
        if (data.collectedData && Array.isArray(data.collectedData)) {
          this.collectedData = data.collectedData;
          console.log(`[BaseDataCollector] 既存データを読み込みました: ${this.collectedData.length}件`);
        }
        if (data.statistics) {
          // 統計データの一部を復元（ランタイム統計は除く）
          this.statistics.totalAttempts = data.statistics.totalAttempts || 0;
          this.statistics.successfulAttempts = data.statistics.successfulAttempts || 0;
          this.statistics.failedAttempts = data.statistics.failedAttempts || 0;
          this.statistics.errorTypes = data.statistics.errorTypes || {};
        }
      }
    } catch (error) {
      console.warn('[BaseDataCollector] 既存データの読み込みに失敗:', error.message);
    }
  }

  /**
     * データ収集開始
     */
  startCollection(exchanges = []) {
    if (this.isCollecting) {
      console.warn('[BaseDataCollector] 既に収集中です');
      return this;
    }

    this.exchanges = exchanges;
    this.isCollecting = true;
    this.statistics.startTime = new Date().toISOString();

    console.log('[BaseDataCollector] 実データ収集開始');
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

    console.log('[BaseDataCollector] データ収集を停止しました');
    console.log(`収集データ数: ${this.collectedData.length}`);
    console.log(`成功率: ${this.calculateSuccessRate().toFixed(2)}%`);

    return this;
  }

  /**
     * データポイントの収集（サブクラスで実装）
     */
  async collectDataPoint() {
    throw new Error('collectDataPoint() must be implemented by subclass');
  }

  /**
     * 成功率計算
     */
  calculateSuccessRate() {
    if (this.statistics.totalAttempts === 0) {
      return 0;
    }
    return (this.statistics.successfulAttempts / this.statistics.totalAttempts) * 100;
  }

  /**
     * エラー率計算
     */
  calculateErrorRate() {
    if (this.statistics.totalAttempts === 0) {
      return 0;
    }
    return (this.statistics.failedAttempts / this.statistics.totalAttempts) * 100;
  }

  /**
     * 応答時間統計の計算
     */
  getResponseTimeStats() {
    if (this.statistics.responseTimes.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p99: 0 };
    }

    const sorted = [...this.statistics.responseTimes].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      min: sorted[0],
      max: sorted[len - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / len,
      p50: sorted[Math.floor(len * 0.5)],
      p90: sorted[Math.floor(len * 0.9)],
      p99: sorted[Math.floor(len * 0.99)]
    };
  }

  /**
     * リアルタイム統計の取得
     */
  getRealtimeStatistics() {
    return {
      timestamp: new Date().toISOString(),
      totalAttempts: this.statistics.totalAttempts,
      successfulAttempts: this.statistics.successfulAttempts,
      failedAttempts: this.statistics.failedAttempts,
      successRate: this.calculateSuccessRate(),
      errorRate: this.calculateErrorRate(),
      responseTimeStats: this.getResponseTimeStats(),
      memoryStats: this.getMemoryStats(),
      errorTypes: { ...this.statistics.errorTypes },
      dataPoints: this.collectedData.length,
      isCollecting: this.isCollecting,
      uptime: this.statistics.startTime ?
        Date.now() - new Date(this.statistics.startTime).getTime() : 0
    };
  }

  /**
     * メモリ使用量統計
     */
  getMemoryStats() {
    const usage = process.memoryUsage();
    return {
      current: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
      total: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100,
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100
    };
  }

  /**
     * データ保存
     */
  saveData() {
    try {
      const saveData = {
        lastUpdated: new Date().toISOString(),
        collectedData: this.collectedData,
        statistics: this.getRealtimeStatistics(),
        options: this.options
      };

      fs.writeFileSync(this.options.dataFile, JSON.stringify(saveData, null, 2));
      console.log(`[BaseDataCollector] データを保存しました: ${this.collectedData.length}件`);
    } catch (error) {
      console.error('[BaseDataCollector] データ保存エラー:', error);
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
        console.log(`[BaseDataCollector] バックアップを作成しました: ${backupFile}`);

        // 古いバックアップのクリーンアップ
        this.cleanupOldBackups();
      }
    } catch (error) {
      console.error('[BaseDataCollector] バックアップ作成エラー:', error);
    }
  }

  /**
     * 古いバックアップファイルのクリーンアップ
     */
  cleanupOldBackups() {
    try {
      const directory = path.dirname(this.options.dataFile);
      const baseName = path.basename(this.options.dataFile, '.json');
      const files = fs.readdirSync(directory);

      const backupFiles = files
        .filter(file => file.startsWith(`${baseName}_backup_`) && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(directory, file),
          mtime: fs.statSync(path.join(directory, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // 最大保持数を超えたバックアップを削除
      if (backupFiles.length > this.options.maxBackups) {
        const filesToDelete = backupFiles.slice(this.options.maxBackups);
        filesToDelete.forEach(file => {
          fs.unlinkSync(file.path);
          console.log(`[BaseDataCollector] 古いバックアップを削除: ${file.name}`);
        });
      }
    } catch (error) {
      console.error('[BaseDataCollector] バックアップクリーンアップエラー:', error);
    }
  }

  /**
     * システム情報の取得
     */
  getSystemMetrics() {
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        rss: usage.rss
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      loadAverage: require('os').loadavg(),
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }

  /**
     * エラー分類（サブクラスで拡張可能）
     */
  categorizeError(error) {
    const message = error.message || error.toString();

    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return { type: 'timeout', severity: 'high' };
    } else if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
      return { type: 'network', severity: 'critical' };
    } else if (message.includes('Rate limit') || message.includes('429')) {
      return { type: 'rate_limit', severity: 'medium' };
    } else if (message.includes('Authentication') || message.includes('401')) {
      return { type: 'authentication', severity: 'critical' };
    } else if (message.includes('JSON') || message.includes('parse')) {
      return { type: 'invalid_response', severity: 'medium' };
    } else {
      return { type: 'unknown', severity: 'low' };
    }
  }

  /**
     * リトライロジック付きの関数実行
     */
  async executeWithRetry(operation, context = '') {
    let lastError;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`[BaseDataCollector] ${context} 試行 ${attempt}/${this.options.maxRetries} 失敗:`, error.message);

        if (attempt < this.options.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
        }
      }
    }

    throw lastError;
  }
}

module.exports = BaseDataCollector;