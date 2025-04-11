/**
 * リアルタイム更新機能を管理するクラス
 */
class RealtimeUpdater {
  constructor() {
    this.eventSource = null;
    this.connected = false;
    this.reconnectTimeout = null;
    this.statusElement = document.getElementById('realtime-status');
    this.listeners = {
      'trade_added': [],
      'batch_update': [],
      'connected': []
    };
    
    // ページ離脱時に接続を閉じる
    window.addEventListener('beforeunload', () => this.disconnect());
  }

  /**
   * SSE接続を開始
   */
  connect() {
    if (this.eventSource) {
      this.disconnect();
    }
    
    try {
      this.eventSource = new EventSource('/api/events');
      
      // 接続イベント
      this.eventSource.onopen = () => {
        console.log('リアルタイム更新に接続しました');
        this.connected = true;
        this.updateStatusUI(true);
        
        // 接続リスナーを呼び出す
        if (this.listeners['connected']) {
          this.listeners['connected'].forEach(callback => callback({
            message: 'リアルタイム更新に接続しました',
            timestamp: Date.now()
          }));
        }
      };
      
      // メッセージ受信イベント
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // イベントタイプに応じたリスナーを呼び出し
          if (data.type && this.listeners[data.type]) {
            this.listeners[data.type].forEach(callback => callback(data.data));
          }
        } catch (error) {
          console.error('イベントデータの解析エラー:', error);
        }
      };
      
      // エラーイベント
      this.eventSource.onerror = (error) => {
        console.error('SSE接続エラー:', error);
        this.connected = false;
        this.updateStatusUI(false);
        this.eventSource.close();
        
        // 5秒後に再接続
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
      };
    } catch (error) {
      console.error('SSE接続の確立中にエラーが発生しました:', error);
      this.connected = false;
      this.updateStatusUI(false);
      
      // 5秒後に再接続
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
    }
  }
  
  /**
   * イベントリスナーを追加
   * @param {string} eventType - イベントタイプ
   * @param {Function} callback - コールバック関数
   */
  addListener(eventType, callback) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);
  }
  
  /**
   * 接続を閉じる
   */
  disconnect() {
    clearTimeout(this.reconnectTimeout);
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    this.connected = false;
    this.updateStatusUI(false);
  }
  
  /**
   * UI上のステータス表示を更新
   * @param {boolean} connected - 接続状態
   */
  updateStatusUI(connected) {
    if (!this.statusElement) {
      this.statusElement = document.getElementById('realtime-status');
      if (!this.statusElement) return;
    }
    
    const badge = this.statusElement.querySelector('.badge');
    if (badge) {
      if (connected) {
        badge.textContent = 'リアルタイム更新中';
        badge.className = 'badge bg-success badge-pulse';
      } else {
        badge.textContent = 'オフライン';
        badge.className = 'badge bg-secondary';
      }
    }
  }
}

// グローバルインスタンス
const realtimeUpdater = new RealtimeUpdater();

// ページロード時に自動接続
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => realtimeUpdater.connect(), 1000);
});