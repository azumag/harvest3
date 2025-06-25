# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## tmuxを使い、gemini　cliと協調作業してください. 
geminiはgemini-harvest というセッションペーンにいます。
相談事をこのペーンにおくり、レスポンスをうけとってください。
相談事の中には、geminiへの指示も含めてください。

### Geminiへの指示
- geminiですと名乗ること
- claude への返答を tmux send-keys -t "gemini-harvest" を用いて送ること
- sendkey で返答を送った後に、10秒おいて enter を送ること
- 最終結果レポートも同じ様におくること

### 操作
tmux send-keys -t "gemini-harvest" "<相談事>" Enter
tmux send-keys -t "gemini-harvest" "" Enter (Enterは時間をおいて２回送る必要があります）
tmux capture-pane -t "gemini-harvest" -p
Geminiの作業を一旦キャンセルしたいときは esc をsendkeyすべし

# 調査
何か調査する必要がある時は、gemini に websearchをたのむこと
gemini -p "WebSearch: ..."

## 🏗️ Project Overview

**harvest3** is a sophisticated cryptocurrency trading bot system built with Node.js that executes multiple trading strategies in parallel. The system uses a microservices architecture with Docker containers and dual-database approach (Redis + MongoDB) for optimal performance.

### Tech Stack
- **Runtime**: Node.js 16
- **Exchange API**: ccxt v3.1.60  
- **Databases**: Redis 8 (real-time), MongoDB 7.0 (historical)
- **Web Framework**: Express.js
- **UI**: Vanilla JavaScript + Chart.js 4.4.9
- **Testing**: Jest 29.7.0
- **Containers**: Docker + Docker Compose

### Core Services
```
bot (strategy-runner)    # Main strategy execution container
hft                     # High-frequency trading container  
backtest               # Backtesting execution container
web-ui (trade_viewer)  # Web UI container
redis                  # Real-time database
mongodb               # Historical database
```

## 🛠️ Essential Commands

### Development Commands
```bash
# Testing
npm test                    # Run all tests
npm run test:unit          # Run unit tests only
npm run test:watch         # Watch mode testing

# Bot Operations  
npm start                  # Start main bot
npm run start-hft         # Start HFT bot
npm run start-web         # Start Web UI server
npm run backtest          # Run backtesting

# Balance Management
npm run check-balance     # Check balance consistency
npm run compare-balance   # Compare exchange vs internal balance
npm run fix-position-inconsistencies  # Fix position inconsistencies
```

### Docker Operations (Makefile)
```bash
# Quick restarts (recommended for development)
make quick-restart-bot       # Restart bot container
make quick-restart-backtest  # Restart backtest container
make restart-webui          # Restart Web UI

# Full restarts
make restart-all           # Restart all containers
make restart-bot          # Full bot restart
make restart-backtest     # Full backtest restart

# Bot-specific commands
make bot-logs             # View bot logs
make bot-status          # Check bot status  
make bot-exec            # Shell into bot container
make help                # Show all available commands
```

### Key Configuration Files
- `src/config.js` - Central strategy configuration and parameters
- `docker-compose.yml` - Container orchestration
- `.env` - Environment variables (API keys, database URLs)
- `Makefile` - Docker operation shortcuts

## 🔨 最重要ルール - 新しいルールの追加プロセス

ユーザーから今回限りではなく常に対応が必要だと思われる指示を受けた場合：

1. CLAUDE.mdに追加ルールとして記載する
2. 以降は標準ルールとして常に適用する

このプロセスにより、プロジェクトのルールを継続的に改善していきます

## 重要: 実行結果や応答を以下のコマンドでDiscordに送信                                                                                                                                                 
```bash
claude-discord-bot send-to-discord "あなたの応答内容" --session claude-harvest
```                                                                                                                                                   

## 📢 Discord通知チャンネル仕様

### チャンネル別通知分類
| チャンネル | 通知内容 | 変更履歴 |
|------------|----------|----------|
| **#order** | 取引実行・注文関連・リスク管理の正常処理 | |
| | • 注文拒否（バリデーション失敗） | 2025-06-25 |
| | • 注文実行失敗（リトライ後） | 2025-06-25 |
| | • ストップロス実行 | 2025-06-25 |
| | • 正常な取引実行 | |
| **#error** | システムエラー・異常状態 | |
| | • リスク管理チェック失敗 | |
| | • データベース接続エラー | |
| | • 戦略実行エラー | |

### 通知変更の原則
- **正常な取引活動** → #order チャンネル
- **システム障害・エラー** → #error チャンネル
- 注文拒否は**正常なバリデーション機能**なので #order へ
- ストップロス実行は**正常なリスク管理**なので #order へ

## ⚠️ データベース操作における重要な制約

### RedisとMongoDBのデータ削除禁止
**絶対にRedisとMongoDBのデータを全削除してはならない**

理由：
- ポジション管理データが失われる
- オーダー戦略データが消失する
- **取引所側のオープンオーダーとの不整合が発生**
- 金銭的損失につながる可能性

### やむを得ずデータを全削除する場合の必須手順
1. **取引所側の全オープンオーダーをキャンセル**
2. **`closeAllPositions.js` を実行** - 全ポジションを解消
3. **`updateAllSummaryTimestamp.js` を実行** - サマリータイムスタンプを更新
4. 取引所との整合性を確認

この手順を踏まずにデータ削除を行うことは厳禁とする。

## 残高チェックにおける制約

### JPY（日本円）の除外
**残高チェック機能では、JPY（日本円）を比較対象から除外する**

理由：
- 暗号通貨の残高管理に焦点を当てるため
- JPY残高は取引所側で別途管理されるため

実装：
- `src/common/balanceChecker.js` で JPY を自動的にスキップ
- 手動実行時も自動実行時も常に適用される

## Geminiへの指示における重要な注意点
- geminiにレポートを送信する際は、送信した後、10秒ほど待ってからenterを再送信してください

## TDD TODOリスト（t-wada流）

### 基本方針

- 🔴 Red: 失敗するテストを書く
- 🟢 Green: テストを通す最小限の実装
- 🔵 Refactor: リファクタリング
- 小さなステップで進める
- 仮実装（ベタ書き）から始める
- 三角測量で一般化する
- 明白な実装が分かる場合は直接実装してもOK
- テストリストを常に更新する
- 不安なところからテストを書く
