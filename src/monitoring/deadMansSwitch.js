/**
 * Dead Man's Switch - 監視システム自体の死活監視
 * 監視システムがダウンした場合の検知・通知システム
 */

const fs = require('fs');
const path = require('path');

class DeadMansSwitch {
  constructor(options = {}) {
    this.options = {
      heartbeatInterval: options.heartbeatInterval || 60000, // 1分間隔
      alertThreshold: options.alertThreshold || 300000, // 5分でアラート
      heartbeatFile: options.heartbeatFile || '/tmp/system-monitor-heartbeat',
      externalNotificationUrl: options.externalNotificationUrl || null,
      ...options
    };

    this.heartbeatTimer = null;
    this.isRunning = false;
  }

  /**
     * ハートビート送信開始
     */
  startHeartbeat() {
    if (this.isRunning) {
      return this;
    }

    this.isRunning = true;
    this.sendHeartbeat(); // 即座に最初のハートビート

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.options.heartbeatInterval);

    console.log('[DeadMansSwitch] ハートビート送信開始');
    return this;
  }

  /**
     * ハートビート送信停止
     */
  stopHeartbeat() {
    if (!this.isRunning) {
      return this;
    }

    this.isRunning = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    console.log('[DeadMansSwitch] ハートビート送信停止');
    return this;
  }

  /**
     * ハートビート送信
     */
  sendHeartbeat() {
    try {
      const heartbeat = {
        timestamp: Date.now(),
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        status: 'alive'
      };

      // ファイルベースのハートビート
      fs.writeFileSync(this.options.heartbeatFile, JSON.stringify(heartbeat));

      // 外部通知（オプション）
      if (this.options.externalNotificationUrl) {
        this.sendExternalHeartbeat(heartbeat);
      }

    } catch (error) {
      console.error('[DeadMansSwitch] ハートビート送信エラー:', error.message);
    }
  }

  /**
     * 外部への生存通知
     */
  async sendExternalHeartbeat(heartbeat) {
    try {
      const https = require('https');
      const http = require('http');
      const url = require('url');

      const parsedUrl = url.parse(this.options.externalNotificationUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const postData = JSON.stringify({
        source: 'SystemMonitor',
        heartbeat
      });

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = client.request(options, (res) => {
        // レスポンス処理（必要に応じて）
      });

      req.on('error', (error) => {
        console.warn('[DeadMansSwitch] 外部通知エラー:', error.message);
      });

      req.setTimeout(5000); // 5秒タイムアウト
      req.write(postData);
      req.end();

    } catch (error) {
      console.warn('[DeadMansSwitch] 外部ハートビート送信エラー:', error.message);
    }
  }

  /**
     * 最後のハートビート確認
     */
  static checkLastHeartbeat(heartbeatFile = '/tmp/system-monitor-heartbeat', alertThreshold = 300000) {
    try {
      if (!fs.existsSync(heartbeatFile)) {
        return {
          status: 'missing',
          message: 'ハートビートファイルが見つかりません',
          lastSeen: null
        };
      }

      const heartbeatData = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
      const now = Date.now();
      const timeSinceLastHeartbeat = now - heartbeatData.timestamp;

      if (timeSinceLastHeartbeat > alertThreshold) {
        return {
          status: 'dead',
          message: `監視システムが ${Math.floor(timeSinceLastHeartbeat / 1000)}秒間応答していません`,
          lastSeen: heartbeatData.timestamp,
          timeSinceLastHeartbeat
        };
      }

      return {
        status: 'alive',
        message: '監視システムは正常に動作しています',
        lastSeen: heartbeatData.timestamp,
        timeSinceLastHeartbeat,
        heartbeatData
      };

    } catch (error) {
      return {
        status: 'error',
        message: `ハートビートチェックエラー: ${error.message}`,
        lastSeen: null
      };
    }
  }

  /**
     * プロセス終了時のクリーンアップ
     */
  setupCleanup() {
    const cleanup = () => {
      this.stopHeartbeat();
      try {
        if (fs.existsSync(this.options.heartbeatFile)) {
          fs.unlinkSync(this.options.heartbeatFile);
        }
      } catch (error) {
        console.warn('[DeadMansSwitch] クリーンアップエラー:', error.message);
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

    return this;
  }
}

module.exports = DeadMansSwitch;