#!/usr/bin/env node
/**
 * scripts/balance-monitor-optimized.js
 * Issue #234: 残高整合性予防監視 (最適化版)
 * 
 * 使用方法: node scripts/balance-monitor-optimized.js
 * crontab: 毎5分実行 /usr/bin/node $PROJECT_DIR/scripts/balance-monitor-optimized.js
 */

const { exchangeBB } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const fs = require('fs');
const path = require('path');

// 設定
const THRESHOLD = 1.0;  // 1JPY以上の乖離で警告
const LOG_FILE = '/tmp/balance-monitor.log';
const ALERT_LOG = '/tmp/balance-alert.log';

async function balanceMonitor() {
  const timestamp = new Date().toLocaleString();
  let redis = null;
  
  try {
    // ログファイルの準備
    const logEntry = `=== 残高監視 ${timestamp} ===\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    
    // 取引所残高取得
    const balance = await exchangeBB.fetchBalance();
    const realBalance = balance.free.JPY || 0;
    
    // Redis残高取得
    redis = await initRedisClient();
    let managedBalance = 0;
    if (redis) {
      const jpyBalance = await redis.get('balance:bitbank:JPY');
      managedBalance = parseFloat(jpyBalance) || 0;
    }
    
    // 乖離計算
    const diff = realBalance - managedBalance;
    const absDiff = Math.abs(diff);
    
    // ログ記録
    const logDetails = `取引所残高: ${realBalance} JPY\n管理残高: ${managedBalance} JPY\n乖離: ${diff.toFixed(4)} JPY\n`;
    fs.appendFileSync(LOG_FILE, logDetails);
    
    // 乖離チェック
    if (absDiff > THRESHOLD) {
      const alertMsg = `⚠️ 残高乖離検出: ${diff.toFixed(4)} JPY (閾値: ${THRESHOLD} JPY)`;
      
      // アラートログ記録
      const alertEntry = `${timestamp}: ${alertMsg}\n`;
      fs.appendFileSync(ALERT_LOG, alertEntry);
      fs.appendFileSync(LOG_FILE, alertEntry);
      
      // Discord通知（環境変数があれば）
      if (process.env.DISCORD_WEBHOOK_URL) {
        try {
          const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
          
          // URL検証とHTTPS強制
          if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
            console.warn('Invalid Discord webhook URL format');
            return;
          }
          
          const webhookData = {
            content: `🚨 **残高乖離アラート**\n残高乖離: ${diff.toFixed(4)} JPY\n取引所残高: ${realBalance} JPY\n管理残高: ${managedBalance} JPY\n時刻: ${timestamp}`
          };
          
          // Discord通知は非同期で送信（エラーでも続行）
          const webhookUrlObj = new URL(webhookUrl);
          require('https').request(webhookUrlObj, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          }, (res) => {
            // レスポンスは無視
          }).on('error', (err) => {
            console.warn('Discord通知エラー:', err.message);
          }).end(JSON.stringify(webhookData));
          
        } catch (discordError) {
          console.warn('Discord通知失敗:', discordError.message);
        }
      }
      
      // コンソール出力（cron実行時はメール通知される）
      console.log(`残高乖離アラート: ${diff.toFixed(4)} JPY`);
      
      // 自動修正の提案
      console.log('自動修正を実行するには:');
      console.log('node scripts/emergency-balance-fix-optimized.js');
      
    } else {
      const okMsg = `残高整合性OK: 乖離 ${diff.toFixed(4)} JPY\n`;
      fs.appendFileSync(LOG_FILE, okMsg);
    }
    
    // ログファイルのローテーション
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').length;
      if (lines > 1000) {
        const allLines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
        const lastLines = allLines.slice(-500);
        fs.writeFileSync(LOG_FILE, lastLines.join('\n'));
      }
    }
    
    fs.appendFileSync(LOG_FILE, `完了: ${timestamp}\n---\n`);
    
  } catch (error) {
    const errorMsg = `監視エラー: ${error.message}\n`;
    fs.appendFileSync(LOG_FILE, errorMsg);
    console.error('残高監視エラー:', error.message);
    process.exit(1);
  } finally {
    // Redis接続を明示的に閉じる
    if (redis) {
      try {
        await redis.quit();
      } catch (closeError) {
        console.warn('Redis接続終了エラー:', closeError.message);
      }
    }
  }
}

// スクリプトとして実行された場合のみ実行
if (require.main === module) {
  balanceMonitor()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('監視スクリプト実行エラー:', error.message);
      process.exit(1);
    });
}

module.exports = { balanceMonitor };