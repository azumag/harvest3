/**
 * 基本異常検知システム起動スクリプト
 * Ultra-Deep Analysis後の予防的品質管理システム
 */
require('dotenv').config();
const { BasicAnomalyDetector } = require('../src/monitoring/basicAnomalyDetector');

async function startBasicAnomalyDetector() {
  console.log(`
████████████████████████████████████████████████████████████████████████
██                                                                    ██
██     🛡️ 基本異常検知システム起動 - Ultra-Deep Analysis 成果実装        ██
██                                                                    ██
████████████████████████████████████████████████████████████████████████

## 🎯 実装背景: Ultra-Deep Analysis 発見問題への対策

### 発見された重大問題:
✅ ポジション偏り 100%ロング → trade_summary欠落が原因 → 解決済み
✅ 売り注文完全停止 → formattedAvailableAmount→0 → 解決済み  
🔴 filled_trade完全欠落 → updateFilledTrades機能停止 → 緊急修復中

### 本システムの目的:
🔍 リアルタイム異常検知による早期問題発見
🔧 自動修復機能による迅速対応
🛡️ 予防的品質管理による再発防止
📊 包括的ヘルスモニタリング

### 監視対象:
• Position-Summary整合性 (5分間隔)
• ポジション偏り監視 (10分間隔)
• 注文実行失敗率 (15分間隔)  
• データ完全性チェック (30分間隔)
• 予測的リスク分析 (60分間隔)
  `);

  const detector = new BasicAnomalyDetector();
  
  try {
    // 初期化
    console.log('\n🔧 BasicAnomalyDetector初期化中...');
    const initialized = await detector.initialize();
    
    if (!initialized) {
      throw new Error('初期化に失敗しました');
    }
    
    // 開始前の現状確認
    console.log('\n📊 開始前システム状態確認');
    
    // Redis接続確認
    const client = detector.client;
    const positionCount = await client.keys('position:*').then(keys => keys.length);
    const summaryCount = await client.keys('summary:trade:*').then(keys => keys.length);
    const filledTradeCount = await client.keys('filled_trade:*').then(keys => keys.length);
    const pendingOrderCount = await client.keys('pending_order:*').then(keys => keys.length);
    
    console.log(`
現在のデータ状況:
  ポジション: ${positionCount}件
  取引サマリー: ${summaryCount}件  
  約定履歴: ${filledTradeCount}件
  未約定注文: ${pendingOrderCount}件
    `);
    
    // 重要データの欠落チェック
    const criticalIssues = [];
    if (filledTradeCount === 0) {
      criticalIssues.push('🔴 CRITICAL: filled_trade完全欠落');
    }
    if (summaryCount < 10) {
      criticalIssues.push('🟡 WARNING: summary:trade不足');
    }
    if (positionCount > 200) {
      criticalIssues.push('🟡 WARNING: ポジション数過多');
    }
    
    if (criticalIssues.length > 0) {
      console.log('\n⚠️ 検出された問題:');
      criticalIssues.forEach(issue => console.log(`  ${issue}`));
      console.log('\n→ 監視システムによる継続的追跡を開始します');
    } else {
      console.log('\n✅ 現在のシステム状態: 正常');
    }
    
    // 監視開始
    console.log('\n🚀 基本異常検知システム開始...');
    await detector.start();
    
    // 定期的な状態レポート
    setInterval(() => {
      const status = detector.getStatus();
      const recentAlerts = status.alertHistory.length;
      
      console.log(`\n📈 定期レポート (${new Date().toLocaleString('ja-JP')})`);
      console.log(`  システム稼働: ${status.isRunning ? '✅ 正常' : '❌ 停止'}`);
      console.log(`  直近アラート: ${recentAlerts}件`);
      
      if (status.lastChecks.positionBias) {
        const longRatio = (status.lastChecks.positionBias.longRatio * 100).toFixed(1);
        console.log(`  ポジション偏り: ${longRatio}%`);
      }
      
      if (status.lastChecks.positionSummaryConsistency) {
        const inconsistency = (status.lastChecks.positionSummaryConsistency.inconsistencyRate * 100).toFixed(1);
        console.log(`  データ整合性: ${inconsistency}%不整合`);
      }
      
    }, 30 * 60 * 1000); // 30分ごと
    
    // 緊急停止ハンドラー
    process.on('SIGINT', async () => {
      console.log('\n🛑 緊急停止シグナル受信...');
      await detector.stop();
      
      const finalStatus = detector.getStatus();
      console.log(`\n📊 最終レポート:`);
      console.log(`  総アラート数: ${finalStatus.alertHistory.length}件`);
      console.log(`  最終チェック: ${new Date(Object.values(finalStatus.lastChecks).reduce((latest, check) => 
        Math.max(latest, check.timestamp || 0), 0)).toLocaleString('ja-JP')}`);
      
      console.log('\n✅ 基本異常検知システム正常終了');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 終了シグナル受信...');
      await detector.stop();
      process.exit(0);
    });
    
    // 初回Discord通知
    console.log('\n🤖 初期状態をDiscordに通知中...');
    try {
      const notificationMessage = `
🛡️ **基本異常検知システム起動完了**

**現在のシステム状態:**
• ポジション: ${positionCount}件
• 取引サマリー: ${summaryCount}件
• 約定履歴: ${filledTradeCount}件${filledTradeCount === 0 ? ' 🔴 CRITICAL' : ''}
• 未約定注文: ${pendingOrderCount}件

**監視開始:**
✅ Position-Summary整合性監視 (5分間隔)
✅ ポジション偏り監視 (10分間隔)
✅ 注文実行失敗率監視 (15分間隔)
✅ データ完全性監視 (30分間隔)
✅ 予測的リスク分析 (60分間隔)

**Ultra-Deep Analysis成果実装:** 
完了済み問題の再発防止と新規問題の早期検出を開始
      `;
      
      // Discord通知は環境に応じて実装
      console.log('Discord通知内容:', notificationMessage);
      
    } catch (error) {
      console.log('Discord通知エラー (継続実行):', error.message);
    }
    
    console.log(`
════════════════════════════════════════════════════════════════════════
🎉 基本異常検知システム稼働開始

次世代harvest3への進化:
• 従来の事後対応型 → 予防的品質管理システム
• 手動監視 → 自動異常検知・修復
• 問題の長期潜伏 → リアルタイム発見・対処

システムは24時間365日稼働し、Ultra-Deep Analysisで発見された
問題の再発防止と新たな問題の早期発見を実行します。

🤖 Basic Anomaly Detection System Online
Co-Authored-By: Claude <noreply@anthropic.com>
════════════════════════════════════════════════════════════════════════
    `);
    
    // メインループ (永続実行)
    console.log('\n⏰ メインループ開始 - Ctrl+Cで停止');
    
  } catch (error) {
    console.error(`❌ 基本異常検知システムエラー: ${error.message}`);
    console.error(error.stack);
    
    if (detector) {
      await detector.stop();
    }
    
    process.exit(1);
  }
}

// スクリプトが直接実行された場合
if (require.main === module) {
  startBasicAnomalyDetector().catch(error => {
    console.error('起動エラー:', error.message);
    process.exit(1);
  });
}

module.exports = { startBasicAnomalyDetector };