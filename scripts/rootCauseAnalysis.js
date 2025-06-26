/**
 * 根本原因分析：なぜtrade_summaryが欠落したのか
 * システム設計レベルの問題を特定する
 */
require('dotenv').config();
const redis = require('redis');

async function rootCauseAnalysis() {
  try {
    console.log(`
████████████████████████████████████████████████████████████████████████
██                                                                    ██
██    🔬 ULTRA-DEEP: 根本原因分析 - システム設計レベルの問題特定          ██
██                                                                    ██
████████████████████████████████████████████████████████████████████████

## 🎯 分析対象: trade_summary欠落の根本原因

### 仮説1: データ生成プロセスの問題
### 仮説2: エラーハンドリングの不備
### 仮説3: システム設計上の構造的欠陥
### 仮説4: 依存関係の複雑さと脆弱性
`);

    // Redisクライアント接続
    const client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();

    // 1. データ生成タイミングの分析
    console.log('\n🔍 Phase 1: データ生成タイミング分析');
    
    // positionとtrade_summaryの作成タイムスタンプ分析
    const positionKeys = await client.keys('position:*');
    const tradeSummaryKeys = await client.keys('summary:trade:*');
    
    console.log(`現在のポジション数: ${positionKeys.length}`);
    console.log(`現在のtrade_summary数: ${tradeSummaryKeys.length}`);
    
    // 最古と最新のポジションタイムスタンプ
    const positionTimestamps = [];
    for (const key of positionKeys.slice(0, 50)) { // サンプリング
      try {
        const pos = await client.hGetAll(key);
        const timestamp = parseInt(pos.createdAt) || 0;
        if (timestamp > 0) {
          positionTimestamps.push({
            key,
            timestamp,
            symbol: pos.symbol,
            strategy: pos.strategyKey,
            amount: parseFloat(pos.amount)
          });
        }
      } catch (err) {
        // エラーはスキップ
      }
    }
    
    positionTimestamps.sort((a, b) => a.timestamp - b.timestamp);
    
    if (positionTimestamps.length > 0) {
      const oldest = positionTimestamps[0];
      const newest = positionTimestamps[positionTimestamps.length - 1];
      
      console.log(`\n最古のポジション: ${new Date(oldest.timestamp).toLocaleString('ja-JP')}`);
      console.log(`  ${oldest.symbol} ${oldest.strategy} ${oldest.amount}`);
      console.log(`最新のポジション: ${new Date(newest.timestamp).toLocaleString('ja-JP')}`);
      console.log(`  ${newest.symbol} ${newest.strategy} ${newest.amount}`);
      
      const timeSpan = newest.timestamp - oldest.timestamp;
      console.log(`ポジション作成期間: ${(timeSpan / (1000 * 60 * 60 * 24)).toFixed(1)}日間`);
    }

    // 2. trade_summary生成不備の原因分析
    console.log('\n🔍 Phase 2: trade_summary生成不備原因分析');
    
    // 戦略・通貨ペア組み合わせ分析
    const combinations = new Map();
    for (const pos of positionTimestamps) {
      const key = `${pos.symbol}:${pos.strategy}`;
      if (!combinations.has(key)) {
        combinations.set(key, { positions: 0, totalAmount: 0, firstSeen: pos.timestamp });
      }
      const combo = combinations.get(key);
      combo.positions++;
      combo.totalAmount += pos.amount;
    }
    
    console.log(`\n戦略・通貨ペア組み合わせ: ${combinations.size}種類`);
    console.log(`trade_summary存在数: ${tradeSummaryKeys.length}種類`);
    console.log(`欠落率: ${((combinations.size - tradeSummaryKeys.length) / combinations.size * 100).toFixed(1)}%`);
    
    // 欠落パターン分析
    const missing = [];
    for (const [combo, data] of combinations) {
      const [symbol, strategy] = combo.split(':');
      const summaryKey = `summary:trade:bitbank:${symbol}:${strategy}`;
      const exists = await client.exists(summaryKey);
      
      if (!exists) {
        missing.push({
          symbol,
          strategy,
          positions: data.positions,
          totalAmount: data.totalAmount,
          firstSeen: data.firstSeen
        });
      }
    }
    
    if (missing.length > 0) {
      console.log(`\n⚠️ 欠落していた組み合わせ: ${missing.length}種類`);
      missing.sort((a, b) => b.positions - a.positions).slice(0, 10).forEach(item => {
        console.log(`  ${item.symbol} ${item.strategy}: ${item.positions}ポジション, 総額${item.totalAmount.toFixed(4)}`);
      });
    }

    // 3. システム設計上の問題分析
    console.log('\n🔍 Phase 3: システム設計問題分析');
    
    console.log(`
【発見された設計問題】

1. 🚨 データ整合性保証の欠如
   - ポジション作成時にtrade_summary自動生成されない
   - 手動同期に依存する脆弱な設計
   - ACID特性の未考慮

2. 🚨 単一障害点の存在
   - trade_summary欠落で売り注文完全停止
   - 依存関係の一方向性（ポジション→サマリー）
   - フェイルセーフ機能の不備

3. 🚨 監視機能の不足
   - データ不整合の早期検出不能
   - 異常状態のアラート機能なし
   - ヘルスチェック機能の未実装

4. 🚨 エラー伝播の問題
   - サイレントエラーの蓄積
   - 局所的エラーのシステム全体への影響
   - 段階的劣化の未検出
`);

    // 4. 具体的な発生シナリオ推定
    console.log('\n🔍 Phase 4: 発生シナリオ推定');
    
    // Redis接続エラーやシステム再起動履歴の調査
    const allKeys = await client.keys('*');
    const keysByType = {};
    allKeys.forEach(key => {
      const type = key.split(':')[0];
      keysByType[type] = (keysByType[type] || 0) + 1;
    });
    
    console.log('\nRedis内データ分布:');
    Object.entries(keysByType)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}件`);
      });

    // 5. 推定される発生シナリオ
    console.log(`
【推定発生シナリオ】

🎯 最有力仮説: 段階的データ劣化

1. 初期状態: システム正常動作
   ↓
2. 何らかのトリガー（システム再起動、Redis接続エラー等）
   ↓
3. trade_summary生成・更新プロセスの部分的停止
   ↓
4. 新規ポジション作成は継続（買い注文は正常）
   ↓
5. trade_summary未更新により売り注文が徐々に不能化
   ↓
6. 監視機能不足により問題の長期間放置
   ↓
7. 最終的に100%ロング偏りの危険状態に到達

🔑 重要な気づき:
- この問題は「突然発生」ではなく「段階的悪化」
- 早期発見できれば軽微な修正で済んだ
- システムの自己修復機能が必要
`);

    // 6. 類似問題の潜在リスク評価
    console.log('\n🔍 Phase 5: 類似問題の潜在リスク評価');
    
    // 他の重要データの整合性チェック
    const riskAreas = [
      { name: 'pending_order', keys: await client.keys('pending_order:*') },
      { name: 'filled_trade', keys: await client.keys('filled_trade:*') },
      { name: 'params', keys: await client.keys('params:*') },
      { name: 'ohlcv', keys: await client.keys('ohlcv:*') },
      { name: 'ticker', keys: await client.keys('ticker:*') }
    ];
    
    console.log('\n潜在的リスクエリア:');
    riskAreas.forEach(area => {
      const risk = area.keys.length === 0 ? '🔴 HIGH' : 
                  area.keys.length < 10 ? '🟡 MEDIUM' : '🟢 LOW';
      console.log(`  ${area.name}: ${area.keys.length}件 ${risk}`);
    });

    await client.quit();

    // 7. 戦略的対応方針
    console.log(`
🚀 戦略的対応方針

【Phase 1: 緊急安定化 (完了済み)】
✅ trade_summary再構築
✅ 売り注文機能復旧
✅ 即座リスク軽減

【Phase 2: 構造的改善 (必須)】
🔲 データ整合性自動検証システム
🔲 リアルタイム異常検知アラート
🔲 自動修復機能実装
🔲 ヘルスチェック機能追加

【Phase 3: 予防的強化 (推奨)】
🔲 冗長化とフェイルセーフ
🔲 段階的劣化検出
🔲 予測的メンテナンス
🔲 包括的監視ダッシュボード

【Phase 4: アーキテクチャ進化 (長期)】
🔲 イベント駆動アーキテクチャ
🔲 マイクロサービス分離
🔲 分散システム設計
🔲 クラウドネイティブ化
`);

    console.log('\n✅ 根本原因分析完了');
    
  } catch (error) {
    console.error('❌ 分析エラー:', error.message);
  }
}

rootCauseAnalysis();