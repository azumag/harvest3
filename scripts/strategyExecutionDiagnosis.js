/**
 * 戦略実行の根本的な問題診断
 * なぜシグナル記録が0件なのかを突き止める
 */
require('dotenv').config();
const redis = require('redis');

async function strategyExecutionDiagnosis() {
  try {
    console.log('=== 戦略実行根本問題診断 ===');

    // Redisクライアント接続
    const client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();

    // 1. Redis内の全キー パターン調査
    console.log('\n1. Redis内データ構造調査');

    const allKeys = await client.keys('*');
    console.log(`Redis総キー数: ${allKeys.length}件`);

    const keyPatterns = {};
    allKeys.forEach(key => {
      const pattern = key.split(':')[0];
      keyPatterns[pattern] = (keyPatterns[pattern] || 0) + 1;
    });

    console.log('\nキーパターン別統計:');
    Object.entries(keyPatterns)
      .sort(([,a], [,b]) => b - a)
      .forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count}件`);
      });

    // 2. 戦略関連キーの詳細調査
    console.log('\n2. 戦略関連データ調査');

    const strategyKeys = allKeys.filter(key => key.includes('strategy'));
    console.log(`戦略関連キー: ${strategyKeys.length}件`);

    if (strategyKeys.length > 0) {
      console.log('戦略関連キー一覧:');
      strategyKeys.slice(0, 10).forEach(key => {
        console.log(`  ${key}`);
      });
    }

    // 3. 最近のログ活動確認
    console.log('\n3. 最近のシステム活動確認');

    // タイムスタンプを含むキーを探す
    const timestampKeys = [];
    for (const key of allKeys.slice(0, 100)) { // 最初の100件を調査
      try {
        const data = await client.hGetAll(key);
        if (data.timestamp || data.createdAt || data.lastUpdate) {
          const ts = parseInt(data.timestamp || data.createdAt || data.lastUpdate);
          if (ts > Date.now() - 24 * 60 * 60 * 1000) { // 24時間以内
            timestampKeys.push({
              key,
              timestamp: ts,
              type: key.split(':')[0]
            });
          }
        }
      } catch (err) {
        // エラーはスキップ
      }
    }

    timestampKeys.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`直近24時間の活動: ${timestampKeys.length}件`);
    if (timestampKeys.length > 0) {
      console.log('最近の活動:');
      timestampKeys.slice(0, 10).forEach(item => {
        const date = new Date(item.timestamp).toLocaleString('ja-JP');
        console.log(`  ${item.type}: ${date}`);
      });
    }

    // 4. 設定とパラメータ確認
    console.log('\n4. 戦略設定確認');

    const paramKeys = allKeys.filter(key => key.includes('param'));
    console.log(`パラメータキー: ${paramKeys.length}件`);

    if (paramKeys.length > 0) {
      console.log('パラメータ例:');
      for (const key of paramKeys.slice(0, 5)) {
        try {
          const data = await client.hGetAll(key);
          console.log(`  ${key}:`);
          console.log(`    enabled: ${data.enabled}`);
          console.log(`    strategy: ${data.strategy || 'unknown'}`);
        } catch (err) {
          // エラーはスキップ
        }
      }
    }

    // 5. エラーログ確認
    console.log('\n5. エラーログ調査');

    const errorKeys = allKeys.filter(key => key.includes('error') || key.includes('log'));
    console.log(`エラー/ログキー: ${errorKeys.length}件`);

    // 6. 戦略実行状況の推測
    console.log('\n6. 戦略実行状況診断');

    const positionCount = allKeys.filter(key => key.startsWith('position:')).length;
    const pendingOrderCount = allKeys.filter(key => key.startsWith('pending_order:')).length;
    const filledTradeCount = allKeys.filter(key => key.startsWith('filled_trade:')).length;

    console.log(`ポジション: ${positionCount}件`);
    console.log(`未約定注文: ${pendingOrderCount}件`);
    console.log(`約定済み取引: ${filledTradeCount}件`);

    // 7. 問題診断
    console.log('\n7. 根本問題診断');

    const issues = [];

    if (strategyKeys.length === 0) {
      issues.push('🚨 戦略関連データが全く存在しない - 戦略が実行されていない可能性');
    }

    if (paramKeys.length === 0) {
      issues.push('🚨 戦略パラメータが存在しない - 設定に問題がある可能性');
    }

    if (positionCount > 0 && strategyKeys.length === 0) {
      issues.push('🚨 ポジションは存在するがシグナル記録がない - データ保存に問題');
    }

    if (timestampKeys.length === 0) {
      issues.push('⚠️ 最近の活動が検出されない - システムが停止している可能性');
    }

    if (pendingOrderCount > 0 && filledTradeCount === 0) {
      issues.push('⚠️ 未約定注文はあるが約定記録がない - 注文執行に問題');
    }

    console.log('\n発見された問題:');
    if (issues.length === 0) {
      console.log('✅ データベースレベルでは明確な問題は検出されませんでした');
    } else {
      issues.forEach(issue => console.log(`  ${issue}`));
    }

    // 8. 次のアクション提案
    console.log('\n8. 次のアクション');

    if (strategyKeys.length === 0) {
      console.log('- saveStrategySignal関数の実装を確認');
      console.log('- 戦略実行ログを確認（コンソールまたはファイル）');
      console.log('- Redis接続とデータ保存の動作確認');
    }

    if (positionCount > 0 && strategyKeys.length === 0) {
      console.log('- ポジション作成時のシグナル保存ロジックを確認');
      console.log('- データベース保存の例外処理を確認');
    }

    console.log('- 戦略実行の詳細ログ有効化');
    console.log('- 手動でのシグナル生成テスト実行');

    await client.quit();
    console.log('\n✅ 根本問題診断完了');

  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

strategyExecutionDiagnosis();