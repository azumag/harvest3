# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# perform
- one commit should be created per task
- git notes should be created to save ai prompt

## test
- TDD must perfomed
- all test should be added to CI
- all function need to be tested

## Basic test promise (t-wada style)
- 🔴 Red: failed case
- 🟢 Green: テストを通す最小限の実装
- 🔵 Refactor: リファクタリング
- 小さなステップで進める
- 仮実装（ベタ書き）から始める
- 三角測量で一般化する
- 明白な実装が分かる場合は直接実装してもOK
- テストリストを常に更新する
- 不安なところからテストを書く

# Gemini および manager-claude からの指示を受けた場合
- 指示者をプロジェクトマネージャーとし、協調作業すること
- tmux の send-keys でやりとりし、マネージャとして指示を仰ぐこと
- 結果レポート、作業内容を 指示者に必ず伝えること
- Gemini は tmux の gemini-harvest で起動している
- manager-claude は tmux の manager-claude で起動している
- 自分を worker-claude と名乗る

## tmux 操作
- メッセージを送信する前に、capture-pane でプロンプトが表示されていることを必ず確認すること：tmux capture-pane -t "gemini-harvest" -p
- Gemini の作業を一旦キャンセルしたいときは esc を send-keys すべし
- tmux send-keys -t "gemini-harvest" "内容" Enter && sleep 5 && tmux send-keys -t "gemini-harvest" "" Enter
- Enterは10秒間をおいて2回送る必要がある

# worker-claude から指示が来た場合
- 細かい操作、調査、実際の作業は worker-claude に任せて、自分をmanager-claudeとし、プロジェクトマネジメントだけに徹してください。
- ただし、worker-claudeが行ったコードのレビューは行なってください。
- レポートと結果成果物についての Quality Assuarance を行なってください.
- テストがある場合は実行し、問題があるなら直させてください
- テストコード自体もレビューしてください。
- web ui の機能改修の場合は mcp ブラウザを用いて確認
- 指示は tmux の send-keys を通じて行います。
- worker-claude は claude-harvest という pane にいます。
- Enterは10秒間をおいて２回送る必要があります
- tmux send-keys -t "claude-harvest" "指示" Enter && sleep 5 &&  tmux send-keys -t "claude-harvest" "" Enter
- 自分を manager-claude であると名乗ること
- send-keys を用いて結果レポートを manager に返す様に伝えるのを忘れないでください。
- バッククォートがシェルによってコマンドとして解釈されてしまうので、バッククォート自体をエスケープして、worker-Claudeに指示を送る
- 送信後はプロンプト入力画面にもどり、worker-claudeからsend-keysされてくるのを待つこと.
- 自分で作業をしない
例：
tmux send-keys -t "claude-harvest" "指示 レポートを tmux send-keys を用いて manager-claude に返すこと。" Enter

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


## 重要: 実行結果や応答を以下のコマンドでDiscordに送信                                                                                                                                                 
```bash
claude-discord-bot send-to-discord "あなたの応答内容" --session claude-harvest
```                                                                                                                                                   

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

## Geminiへの指示における重要な注意点
- geminiにレポートを送信する際は、送信した後、10秒ほど待ってからenterを再送信してください

