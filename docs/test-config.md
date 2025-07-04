# 現在の設定値 (自動生成)

**生成日時**: 2025年07月04日  
**生成元**: `src/common/const.js`  
**生成コマンド**: `./scripts/generate-config-docs.sh`

## 概要

この文書は設定ファイルから自動生成された、現在の設定値の完全なリストです。
手動での編集は推奨されません。設定を変更する場合は、ソースファイルを直接編集してください。

## 設定詳細

[0;34m[INFO][0m 設定値を抽出しています...
#### 設定値の参照

> ⚠️ **重要な警告**: 以下は自動生成された参考値です（生成日時: 2025年07月04日）。
> 
> 実際のエラーログとの乖離が発生する可能性があります。詳細なトラブルシューティングは[🚨 緊急対応・トラブルシューティング](#-緊急対応トラブルシューティング)を参照してください。
> 
> **必須**: 最新の設定値は必ず実際の設定ファイルやソースコードを直接確認してください。

**主要な設定ファイル**
- **API制限設定**: `src/common/const.js` の `EXCHANGE_SETTINGS`
- **取引設定**: `src/common/const.js` の `TRADING_SETTINGS`
- **注文管理設定**: `src/common/const.js` の `ORDER_MANAGEMENT_SETTINGS`

**自動抽出された設定値（2025年07月04日時点）**

```javascript
// src/common/const.js - EXCHANGE_SETTINGS（自動生成）
const EXCHANGE_SETTINGS = {
  "RATE_LIMIT": 5000,
  "TIMEOUT": 60000,
  "MAX_THROTTLE_QUEUE_SIZE": 1500,
  "RECV_WINDOW": 60000,
  "BACKOFF_ENABLED": true,
  "BACKOFF_INITIAL_DELAY": 1000,
  "BACKOFF_MAX_DELAY": 30000,
  "BACKOFF_MULTIPLIER": 2,
  "HEALTH_CHECK_INTERVAL": 60000,
  "MAX_CONSECUTIVE_FAILURES": 5,
  "MAX_CONCURRENT_PAIRS": 3,
  "EXECUTION_DELAY_MS": 1000
};

// src/common/const.js - TRADING_SETTINGS（自動生成）
const TRADING_SETTINGS = {
  "DEFAULT_AMOUNT": 0.0001,
  "TRADE_PERCENTAGE": 0.01,
  "EXCLUDE_SYMBOLS": [
    "ELF/",
    "MATIC/",
    "RNDR/",
    "BCH/"
  ]
};

// src/common/const.js - ORDER_MANAGEMENT_SETTINGS（自動生成）
const ORDER_MANAGEMENT_SETTINGS = {
  "MAX_SLIPPAGE": 0.005,
  "ORDER_TIMEOUT": 60000,
  "MAX_RETRIES": 3,
  "RETRY_DELAY": 1000
};
```

> **注意**: この情報は自動生成されており、`scripts/generate-config-docs.sh`により更新できます。

## 更新方法

このドキュメントを更新するには：

```bash
# 独立ドキュメントのみ更新
./scripts/generate-config-docs.sh docs/current-config.md

# README.mdも同時に更新
./scripts/generate-config-docs.sh docs/current-config.md --update-readme
```

## 検証方法

設定値の整合性を確認するには：

```bash
# 基本検証
./scripts/validate-config.sh

# README整合性も含む完全検証
./scripts/validate-config.sh --check-readme-consistency
```

---
*このファイルは自動生成されています。手動での編集は避けてください。*
