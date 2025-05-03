## 計画：MongoDBサービスと`src/mongoDatabase.js`の実装

この計画では、MongoDBを履歴データストアとして導入し、それと連携するJavaScriptライブラリを作成します。

### ゴール

*   MongoDBサービスを定義した`docker-compose.yml`ファイルを更新する。
*   MongoDB接続設定を`.env`および`src/config.js`に追加する。
*   `order`、`trade`、`signal`コレクションのデータを操作する`src/mongoDatabase.js`を新規作成する。

### 参考資料

*   `plan/database-redis-reconstract.md`: MongoDBに保存するデータのスキーマ定義とインデックス設定を参考にします。
*   `src/redisDatabase.js`: 履歴関連関数の設計思想を参考にしますが、厳密な対応は行わず、MongoDBの特性を活かしたシンプルな関数を実装します。

### 詳細ステップ

1.  **`docker-compose.yml`の更新**:
    *   ユーザーから提供される既存の`docker-compose.yml`の内容に、MongoDBサービス定義を追記します。
    *   MongoDBの公式イメージを使用し、永続化のためのボリューム設定を含めます。
    *   必要に応じて、他のサービスからMongoDBにアクセスできるようネットワーク設定を行います。

    ```mermaid
    graph TD
        A[既存のdocker-compose.yml] --> B{MongoDBサービス定義の追加}
        B --> C[更新されたdocker-compose.yml]
    ```

2.  **`.env`ファイルの更新**:
    *   MongoDBの接続URI、データベース名などの設定情報を`.env`ファイルに追記します。

    ```mermaid
    graph TD
        D[既存の.env] --> E{MongoDB設定の追記}
        E --> F[更新された.env]
    ```

3.  **`src/config.js`の更新**:
    *   `.env`ファイルからMongoDBの接続情報を読み込み、アプリケーション全体で利用できるように設定を追加します。

    ```mermaid
    graph TD
        G[既存のsrc/config.js] --> H{MongoDB設定の読み込み追加}
        H --> I[更新されたsrc/config.js]
    ```

4.  **`src/mongoDatabase.js`の新規作成**:
    *   MongoDBクライアントを初期化し、接続を管理する関数を実装します。
    *   `order`、`trade`、`signal`コレクションへの参照を取得する関数を実装します。
    *   各コレクションに対して、以下のシンプルな操作関数を実装します。
        *   データの追加（例: `addOrder`, `addTrade`, `addSignal`）
        *   データのリスト取得（例: `listOrders`, `listTrades`, `listSignals`） - フィルタリングやページングの機能は必要に応じて検討します。
        *   IDによるデータ取得（例: `getOrderById`, `getTradeById`, `getSignalById`） - `orders`は`orderId`、`trades`は`tradeId`、`signals`は`_id`を使用します。
    *   `plan/database-redis-reconstract.md`に記載されているインデックス設定を参考に、必要に応じてインデックス作成処理を組み込みます（初期化時など）。

    ```mermaid
    graph TD
        J[新規ファイル src/mongoDatabase.js] --> K{MongoDB接続初期化}
        K --> L{コレクション参照取得}
        L --> M[データ操作関数実装<br/>(追加, リスト, ID取得)]
        M --> N{インデックス設定}
    ```

5.  **計画の提示**:
    *   この計画をユーザーに提示し、内容に問題がないか、修正の必要がないかを確認します。

6.  **計画のファイル書き出し（オプション）**:
    *   ユーザーが希望する場合、上記の計画内容をMarkdownファイルとして保存します。

7.  **モード切り替え**:
    *   計画の承認後、実際のコード実装を行うためにCodeモードへの切り替えを提案します。