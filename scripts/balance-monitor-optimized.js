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
const config = require('./config/balance-monitor.config');

async function balanceMonitor() {
  const timestamp = new Date().toLocaleString();
  let redis = null;
  
  try {
    // ログファイルの準備
    const logEntry = `=== 残高監視 ${timestamp} ===\n`;
    fs.appendFileSync(config.logFile, logEntry);
    
    // 取引所残高取得
    const balance = await exchangeBB.fetchBalance();
    const realBalance = balance.free[config.currency] || 0;
    
    // Redis残高取得
    redis = await initRedisClient();
    let managedBalance = 0;
    if (redis) {
      const balanceData = await redis.get(config.redis.key);
      managedBalance = parseFloat(balanceData) || 0;
    }
    
    // 乖離計算
    const diff = realBalance - managedBalance;
    const absDiff = Math.abs(diff);
    
    // ログ記録
    const logDetails = `取引所残高: ${realBalance} ${config.currency}\n管理残高: ${managedBalance} ${config.currency}\n乖離: ${diff.toFixed(4)} ${config.currency}\n`;
    fs.appendFileSync(config.logFile, logDetails);
    
    // 乖離チェック
    if (absDiff > config.threshold) {
      const alertMsg = `⚠️ 残高乖離検出: ${diff.toFixed(4)} ${config.currency} (閾値: ${config.threshold} ${config.currency})`;
      
      // アラートログ記録
      const alertEntry = `${timestamp}: ${alertMsg}\n`;
      fs.appendFileSync(config.alertLog, alertEntry);
      fs.appendFileSync(config.logFile, alertEntry);
      
      // Discord通知（設定されていれば）
      if (config.discord.enabled) {
        try {
          const webhookData = {
            content: `🚨 **残高乖離アラート**\n残高乖離: ${diff.toFixed(4)} JPY\n取引所残高: ${realBalance} JPY\n管理残高: ${managedBalance} JPY\n時刻: ${timestamp}`
          };
          
          // Discord通知は非同期で送信（エラーでも続行）
          require('https').request(config.discord.webhookUrl, {
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
      const okMsg = `残高整合性OK: 乖離 ${diff.toFixed(4)} ${config.currency}\n`;
      fs.appendFileSync(config.logFile, okMsg);
    }
    
    // ログファイルのローテーション
    if (fs.existsSync(config.logFile)) {
      const lines = fs.readFileSync(config.logFile, 'utf8').split('\n').length;
      if (lines > config.maxLogLines) {
        const allLines = fs.readFileSync(config.logFile, 'utf8').split('\n');
        const lastLines = allLines.slice(-Math.floor(config.maxLogLines / 2));
        fs.writeFileSync(config.logFile, lastLines.join('\n'));
      }
    }
    
    fs.appendFileSync(config.logFile, `完了: ${timestamp}\n---\n`);
    
  } catch (error) {
    const errorMsg = `監視エラー: ${error.message}\n`;
    fs.appendFileSync(config.logFile, errorMsg);
    console.error('残高監視エラー:', error.message);
    
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    } else {
      throw error;
    }
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
    .then(() => {
      if (process.env.NODE_ENV !== 'test') {
        process.exit(0);
      }
    })
    .catch(error => {
      console.error('監視スクリプト実行エラー:', error.message);
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    });
}

module.exports = { balanceMonitor };