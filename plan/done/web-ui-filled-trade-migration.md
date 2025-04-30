# Web UI 約定履歴・約定サマリー移行計画

## 背景

現状のWeb UIでは、注文履歴（trade:orderHistory）と注文サマリー（trade:orderSummary）を使用して実現損益などを計算しています。しかし、正確には約定サマリー（trade:filledSummary）と約定履歴（trade:filledHistory）を使用すべきです。

`redisDatabase.js`には既に約定サマリーと約定履歴の実装が存在していますが、一部の関数では依然として注文履歴と注文サマリーを使用しています。また、実現損益の計算方法が各所で異なっています。

## 現状の問題点

1. `getTradeRecordsAsObject`関数は`trade:orderSummary`を使用していますが、正しくは`trade:filledSummary`を使用すべきです。

2. 実現損益の計算方法が各所で異なっています：
   - `addFilledTrade`関数では平均購入コストを使用した正確な計算方法
   - `getTradeSummary`関数では単純な差分計算
   - `redis-positions.js`コントローラーでは別の計算方法

3. 約定履歴を表示するページが存在しません。

## 修正計画

### 1. 約定履歴ページの作成

#### 1.1 約定履歴ページのHTML作成

現在の取引履歴ページ（history.html）をベースに、約定履歴ページ（filled-history.html）を作成します。約定履歴ページには以下の特徴を持たせます：

- タイトルとヘッダーを「約定履歴」に変更
- 手数料情報を表示するカラムを追加
- 取引履歴との違いを明確にするための説明文を追加

#### 1.2 約定履歴ページのJavaScript作成

対応するJavaScriptファイル（filled-history.js）を作成します。

#### 1.3 APIエンドポイントの追加

`/api/filled-history`エンドポイントを追加します。このエンドポイントは`trade:filledHistory`からデータを取得します。

### 2. バックエンド修正

#### 2.1 `getTradeRecordsAsObject`関数の修正

`trade:orderSummary`の代わりに`trade:filledSummary`を使用するように修正します。

```javascript
// 修正前
const recordKey = `trade:orderSummary:${exchangeId}:${symbol}:${strategyKey}`;

// 修正後
const recordKey = `trade:filledSummary:${exchangeId}:${symbol}:${strategyKey}`;
```

#### 2.2 実現損益計算の統一

新規データに対しては`addFilledTrade`関数の計算方法を使用します：

```javascript
// 平均購入コストを使用した実現損益計算
const avgBuyCost = currentBuyCost / currentBuyAmount;
const soldCost = amount * avgBuyCost;
const profit = value - soldCost;
```

過去データについては現状の値をそのまま維持し、新しい計算方法は新規データにのみ適用します。

### 3. 既存ページの修正

#### 3.1 ダッシュボードの修正

dashboard.jsを修正して、約定サマリーと約定履歴を使用するようにします。

#### 3.2 分析ページの修正

analysis.jsを修正して、約定サマリーと約定履歴を使用するようにします。

#### 3.3 ポジションページの修正

positions.jsを修正して、約定サマリーと約定履歴を使用するようにします。

#### 3.4 ナビゲーションバーの修正

ナビゲーションバーに約定履歴へのリンクを追加します。

## 実装順序

1. 約定履歴ページの作成
   - HTML作成
   - JavaScript作成
   - APIエンドポイント追加

2. バックエンドの修正
   - `getTradeRecordsAsObject`関数の修正
   - 実現損益計算の統一（新規データのみ）

3. 既存ページの修正
   - ダッシュボードの修正
   - 分析ページの修正
   - ポジションページの修正
   - ナビゲーションバーの修正

4. テストと検証

## 注意点

- 約定履歴ページには手数料情報も表示し、取引履歴との違いを明確にします。
- 過去データはそのままに、新しい計算方法は新規データにのみ適用します。
- 既存の取引履歴ページはそのままにして、約定履歴ページを新たに追加します。
- 移行後も一定期間は両方のデータを保持し、問題がないことを確認します。

## 実装詳細

### 約定履歴ページのHTML構造

```html
<!-- 約定履歴テーブル -->
<table id="filled-trades-history-table" class="table table-striped">
    <thead>
        <tr>
            <th>ID</th>
            <th>日時</th>
            <th>取引所</th>
            <th>銘柄</th>
            <th>戦略</th>
            <th>取引方向</th>
            <th>数量</th>
            <th>価格</th>
            <th>金額</th>
            <th>手数料</th> <!-- 新規追加 -->
        </tr>
    </thead>
    <tbody>
        <!-- APIから取得したデータがここに表示されます -->
    </tbody>
</table>
```

### APIエンドポイント追加

```javascript
// redis-routes.js に追加
router.get('/filled-history', getFilledHistory);

// 新しいコントローラー関数
async function getFilledHistory(req, res) {
  try {
    // クエリパラメータを取得
    const { 
      exchangeId, 
      symbol, 
      strategyKey, 
      startDate, 
      endDate, 
      limit = 100, 
      offset = 0 
    } = req.query;
    
    // フィルター条件を構築
    const filters = {};
    
    if (exchangeId) filters.exchangeId = exchangeId;
    if (symbol) filters.symbol = symbol;
    if (strategyKey) filters.strategyKey = strategyKey;
    if (startDate) filters.startDate = parseInt(startDate, 10);
    if (endDate) filters.endDate = parseInt(endDate, 10);
    
    // 約定履歴を取得
    const { history, total } = await getFilledTradeHistory(
      filters,
      parseInt(limit, 10),
      parseInt(offset, 10)
    );
    
    // 結果をJSON形式で返す
    res.json({
      history,
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (error) {
    console.error('約定履歴取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
```

### 実現損益計算の統一

```javascript
// getTradeSummary関数内の修正
// 修正前
const realizedPnL = totalSellValue - totalBuyCost;

// 修正後（新規データのみに適用）
// 既存の実現損益計算はそのまま維持
// 新規データに対しては、addFilledTrade関数の計算方法を使用