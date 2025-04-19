## シグナル履歴ページのナビゲーションバーのアクティブ化修正

### 問題

signal-history.htmlページにアクセスした際に、ナビゲーションバーの「シグナル履歴」リンクがアクティブにならない。

### 原因

navbar.jsファイルに、signal-history.htmlページに対応する条件分岐が存在しない。

### 解決策

navbar.jsファイルに、signal-history.htmlページに対する条件分岐を追加する。

### 変更内容

```javascript
// 既存のコード
} else if (pageName === 'analysis.html') {
    activeNavId = 'nav-analysis';
}

// 追加する条件分岐
} else if (pageName === 'signal-history.html') {
    activeNavId = 'nav-signal-history';
}
```

### 影響範囲

navbar.jsファイルのみ。

### 図解

```mermaid
graph TD
    A[ページロード] --> B{現在のページは?}
    B -->|index.html| C[ダッシュボードをアクティブ化]
    B -->|positions.html| D[ポジションをアクティブ化]
    B -->|history.html| E[注文履歴をアクティブ化]
    B -->|filled-history.html| F[約定履歴をアクティブ化]
    B -->|order-pairs.html| G[注文ペアをアクティブ化]
    B -->|analysis.html| H[分析をアクティブ化]
    B -->|signal-history.html| I[シグナル履歴をアクティブ化]
    
    C --> J[ナビゲーションバー表示]
    D --> J
    E --> J
    F --> J
    G --> J
    H --> J
    I --> J