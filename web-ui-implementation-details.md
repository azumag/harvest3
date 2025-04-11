# ウェブUI実装詳細計画

## 1. バックエンドAPI詳細設計

### 依存パッケージ
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "better-sqlite3": "^11.9.1",
    "morgan": "^1.10.0"
  }
}
```

### APIエンドポイント詳細

#### 1.1 ポジション情報取得API
- **エンドポイント**: `GET /api/positions`
- **機能**: 現在の取引ポジションの一覧を取得
- **レスポンス例**:
```json
{
  "positions": [
    {
      "exchangeId": "bitbank",
      "symbol": "BTC/JPY",
      "strategyKey": "trendFollowing",
      "buyAmount": 0.1,
      "sellAmount": 0.05,
      "netPosition": 0.05,
      "averageBuyPrice": 6000000,
      "averageSellPrice": 6200000,
      "unrealizedPnL": 10000,
      "realizedPnL": 5000
    }
  ]
}
```

#### 1.2 取引履歴取得API
- **エンドポイント**: `GET /api/history`
- **パラメータ**:
  - `exchangeId`: 取引所ID (オプション)
  - `symbol`: 通貨ペア (オプション)
  - `strategyKey`: 戦略キー (オプション)
  - `startDate`: 開始日時 (オプション)
  - `endDate`: 終了日時 (オプション)
  - `limit`: 取得件数 (デフォルト: 100)
  - `offset`: オフセット (デフォルト: 0)
- **レスポンス例**:
```json
{
  "history": [
    {
      "id": 123,
      "timestamp": 1680000000000,
      "exchangeId": "bitbank",
      "symbol": "BTC/JPY",
      "strategyKey": "trendFollowing",
      "side": "buy",
      "amount": 0.01,
      "price": 6000000,
      "value": 60000
    }
  ],
  "total": 156
}
```

#### 1.3 集計サマリーAPI
- **エンドポイント**: `GET /api/summary`
- **パラメータ**:
  - `period`: 期間 (daily, weekly, monthly, yearly, all) (デフォルト: all)
- **レスポンス例**:
```json
{
  "summary": {
    "totalBuyAmount": 1.5,
    "totalSellAmount": 1.3,
    "totalBuyCost": 9000000,
    "totalSellValue": 9500000,
    "realizedPnL": 500000,
    "currentPositions": 0.2,
    "currentPositionValue": 1200000
  },
  "byExchange": {
    "bitbank": {
      "totalBuyAmount": 1.0,
      "totalSellAmount": 0.9,
      "realizedPnL": 350000
    },
    "bitflyer": {
      "totalBuyAmount": 0.5,
      "totalSellAmount": 0.4,
      "realizedPnL": 150000
    }
  },
  "byStrategy": {
    "trendFollowing": {
      "totalBuyAmount": 1.0,
      "totalSellAmount": 0.8,
      "realizedPnL": 300000
    },
    "arbitrage": {
      "totalBuyAmount": 0.5,
      "totalSellAmount": 0.5,
      "realizedPnL": 200000
    }
  }
}
```

### API実装ファイル

#### src/api/index.js
```javascript
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const routes = require('./routes');

// APIサーバーセットアップ
const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// 静的ファイル提供
app.use(express.static('src/web'));

// APIルート
app.use('/api', routes);

// サーバー起動
app.listen(PORT, () => {
  console.log(`API Server running on port ${PORT}`);
});

module.exports = app;
```

#### src/api/routes.js
```javascript
const express = require('express');
const router = express.Router();
const positionsController = require('./controllers/positions');
const historyController = require('./controllers/history');
const summaryController = require('./controllers/summary');

// 各種ルート定義
router.get('/positions', positionsController.getPositions);
router.get('/history', historyController.getHistory);
router.get('/summary', summaryController.getSummary);

module.exports = router;
```

## 2. フロントエンド画面設計

### 2.1 ページ構成

1. **ダッシュボード** (index.html)
   - 現在のポジション概要
   - 累積損益グラフ（日次/週次/月次切替可能）
   - 主要指標のカード表示

2. **取引履歴** (history.html)
   - フィルタリング可能なテーブル
   - ページネーション機能
   - CSV出力オプション

3. **分析** (analysis.html)
   - 時系列取引グラフ
   - 戦略別パフォーマンス比較
   - 取引所別パフォーマンス比較

### 2.2 ワイヤーフレーム（概念）

```
+----------------------------------------+
|             ナビゲーションバー          |
+----------------------------------------+
|                                        |
|  +------------------+  +------------+  |
|  | 累積損益グラフ    |  | 現在ポジ    |  |
|  |                  |  | ション概要  |  |
|  +------------------+  +------------+  |
|                                        |
|  +------------------+  +------------+  |
|  | 取引所別サマリー  |  | 戦略別      |  |
|  |                  |  | サマリー    |  |
|  +------------------+  +------------+  |
|                                        |
|  +-----------------------------------+  |
|  | 最近の取引（テーブル）             |  |
|  |                                   |  |
|  +-----------------------------------+  |
|                                        |
+----------------------------------------+
```

### 2.3 使用するライブラリとCDNリンク

```html
<!-- CSS フレームワーク -->
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">

<!-- データテーブル -->
<link href="https://cdn.datatables.net/1.13.1/css/dataTables.bootstrap5.min.css" rel="stylesheet">

<!-- グラフライブラリ -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.0.0/dist/chart.umd.min.js"></script>

<!-- JavaScript フレームワーク -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script src="https://code.jquery.com/jquery-3.7.0.min.js"></script>
<script src="https://cdn.datatables.net/1.13.1/js/jquery.dataTables.min.js"></script>
<script src="https://cdn.datatables.net/1.13.1/js/dataTables.bootstrap5.min.js"></script>
```

## 3. Docker構成の詳細

### 3.1 Docker Compose更新計画

既存の`docker-compose.yml`に以下のサービスを追加：

```yaml
services:
  # 既存のサービス（省略）...

  web-ui:
    image: harvest3-web-ui
    container_name: trade_viewer
    build:
      context: .
      dockerfile: WebUI.Dockerfile
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./src:/usr/src/app/src
      - ./data:/usr/src/app/data
      - ./package.json:/usr/src/app/package.json
    depends_on:
      - bot
    environment:
      - NODE_ENV=production
      - PORT=3000
```

### 3.2 WebUI用Dockerfile

```dockerfile
# ベースイメージを指定
FROM node:16-bullseye

# 必要なライブラリをインストール
RUN apt-get update && apt-get install -y \
    sqlite3 \
    libsqlite3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリを設定
WORKDIR /usr/src/app

# パッケージファイルをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install --production

# アプリケーションのソースコードをコピー
COPY src/ ./src/

# ポートを公開
EXPOSE 3000

# コンテナが起動したらAPIサーバーを実行
CMD ["node", "src/api/index.js"]
```

### 3.3 パッケージ依存関係の更新

`package.json`に追加する内容：

```json
{
  "dependencies": {
    // 既存の依存関係
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "morgan": "^1.10.0"
  },
  "scripts": {
    // 既存のスクリプト
    "start-web": "node src/api/index.js"
  }
}
```

## 4. 実装手順詳細

### 4.1 準備作業
1. 必要なディレクトリ構造を作成
2. package.jsonに依存パッケージを追加
3. WebUI用Dockerfileを作成

### 4.2 バックエンドAPI実装
1. APIコントローラー実装
   - positions.js: ポジション情報取得
   - history.js: 取引履歴取得
   - summary.js: 集計情報取得
2. 各エンドポイントのテスト

### 4.3 フロントエンド実装
1. HTML/CSSテンプレート作成
2. JavaScript関数実装
   - APIからのデータ取得
   - グラフ描画処理
   - テーブル表示処理
3. レスポンシブデザイン調整

### 4.4 Docker統合
1. docker-compose.yml更新
2. コンテナビルドとテスト

### 4.5 最終テスト
1. 全体の統合テスト
2. パフォーマンス確認