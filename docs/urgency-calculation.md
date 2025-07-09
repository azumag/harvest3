# Urgency計算ロジック詳細解説

## 概要
高度注文管理システムにおけるurgency（緊急度）は、注文の実行優先度を決定する重要なパラメータです。

## Urgencyレベル定義

### 1. 固定レベル
```javascript
const URGENCY_LEVELS = {
  LOW: 'low',       // 時間に余裕がある（ポストオンリー推奨）
  MEDIUM: 'medium', // 通常の実行（リミット注文推奨）
  HIGH: 'high'      // 急ぎの実行（マーケット注文推奨）
};
```

### 2. 決定ロジック

#### A. 設定ベースの決定
```javascript
// src/strategies/utils/common.js:443-450
if (orderType === 'market') {
  urgency = URGENCY_LEVELS.HIGH;
} else if (orderConfig.orderTypes?.[orderType]?.urgencyLevel) {
  urgency = URGENCY_LEVELS[orderConfig.orderTypes[orderType].urgencyLevel.toUpperCase()];
} else {
  urgency = URGENCY_LEVELS[defaultUrgency.toUpperCase()];
}
```

#### B. 設定ファイルでの制御
```javascript
// src/config.js:86
defaultUrgency: 'medium',

// 注文タイプ別設定
orderTypes: {
  market: { urgencyLevel: 'high' },
  limit: { urgencyLevel: 'medium' },
  postOnly: { urgencyLevel: 'low' }
}
```

## 注文タイプ選択への影響

### selectOptimalOrderType()での使用
```javascript
// 緊急度と流動性に基づく注文タイプ決定
if (urgency === URGENCY_LEVELS.HIGH && liquidityLevel > 0.6) {
  return ORDER_TYPES.MARKET;
} else if (urgency === URGENCY_LEVELS.MEDIUM && liquidityLevel > 0.4) {
  return ORDER_TYPES.LIMIT; // bitbank対応でIOCから変更
} else {
  return ORDER_TYPES.LIMIT_POST_ONLY;
}
```

## 流動性評価との組み合わせ

### 1. 流動性レベル計算
- スプレッド分析
- 板の厚み評価（上位5レベル）
- 注文量に対する充足率計算

### 2. 最終決定マトリックス

| Urgency | 流動性 | 選択される注文タイプ |
|---------|--------|---------------------|
| HIGH    | >0.6   | MARKET              |
| MEDIUM  | >0.4   | LIMIT               |
| LOW     | 任意   | LIMIT_POST_ONLY     |

## bitbank特有の制約

### サポートしない機能
- IOC（Immediate or Cancel）
- timeInForce オプション

### 実装された対策
1. IOC使用箇所をLIMITに変更
2. 設定でIOCを無効化
3. 警告ログの追加

## 設定変更による制御

### urgencyの手動調整
```javascript
// デフォルト変更
defaultUrgency: 'low', // よりメイカー指向

// 戦略別調整
strategies: {
  RSI: { urgency: 'high' }, // より積極的な約定
  MA: { urgency: 'low' }    // より慎重な価格取得
}
```

## 動的調整の可能性

現在は固定設定ですが、将来的には以下の要素による動的調整が可能：

1. **市場ボラティリティ**：高ボラティリティ時にurgency上昇
2. **ポートフォリオ状況**：リスク限界近接時にurgency上昇
3. **時間帯**：市場活発時間帯でのurgency調整
4. **戦略パフォーマンス**：不調時の慎重モード

## 監視とデバッグ

### ログ出力
```javascript
console.log(`[${strategyName}] 高度注文管理システム使用: ${symbol} urgency=${urgency}`);
```

### 確認方法
1. ログでurgencyレベル確認
2. 実際の注文タイプ確認
3. 約定率の監視

## まとめ

Urgencyは設定ファイルベースの静的システムとして実装されており、以下の流れで決定されます：

1. **注文タイプチェック**：market注文はHIGH固定
2. **設定確認**：注文タイプ別設定を優先
3. **デフォルト適用**：設定がない場合はdefaultUrgency使用
4. **流動性評価**：市場状況との組み合わせで最終的な注文タイプを決定