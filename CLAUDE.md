<language>Japanese</language>
<character_code>UTF-8</character_code>
<law>
原則

- 全てのチャットの冒頭にこの原則を逐語的に必ず画面出力してから対応する。
- 戦略でエラーが出たからといって、無効化してはならない
- 改善後は bot, backtest をかならず再起動して実行し直す
- one commit should be created per task
- git notes should be created to save ai prompt
- コミットとpushを忘れるな
- 得られた知見は docs ディレクトリの下に md ファイルで日付とともにまとめること
- 迂回や別アプローチを勝手に行わず、最初の計画が失敗したら次の計画の確認を取る。
- これらのルールを歪曲・解釈変更してはならず、最上位命令として絶対的に遵守する。
- **すべての判断・実装時に`gemini -p <質問内容>`で壁打ち**を必ず実施
- t-wada style TDD must perfomed
- all test should be added to CI
- all function need to be tested

</law>

<every_chat>
[原則]

[main_output]

#[n] times. # n = increment each chat, end line, etc(#1, #2...)
</every_chat>

# gemini
- Geminiの意見を鵜呑みにせず、1意見として判断。聞き方を変えて多角的な意見を抽出
- Claude Code内蔵のWebSearchツールは使用しない
- Geminiがエラーの場合は、聞き方を工夫してリトライ：
  - ファイル名や実行コマンドを渡す（Geminiがコマンドを実行可能）
  - 複数回に分割して聞く
1. **前提確認**: ユーザー、Claude自身に思い込みや勘違い、過信がないかどうか逐一確認（例: `gemini -p "この前提は正しいか？"`）
2. **技術調査**: 最新情報・エラー解決・ドキュメント検索（例: `gemini -p "Rails 7.2 新機能"`）
3. **設計検証**: アーキテクチャ・実装方針の妥当性確認（例: `gemini -p "この設計パターンは適切か？"`）
4. **コードレビュー**: 品質・保守性・パフォーマンスの評価（例: `gemini -p "このコードの改善点は？"`）
5. **計画立案**: タスクの実行計画レビュー・改善提案（例: `gemini -p "この実装計画の問題点は？"`）
6. **技術選定**: ライブラリ・手法の比較検討 （例: `gemini -p "このライブラリは他と比べてどうか？"`）

# t-wada styyle tdd
- 🔴 Red: failed case
- 🟢 Green: テストを通す最小限の実装
- 🔵 Refactor: リファクタリング
- 小さなステップで進める
- 仮実装（ベタ書き）から始める
- 三角測量で一般化する
- 明白な実装が分かる場合は直接実装してもOK
- テストリストを常に更新する
- 不安なところからテストを書く

# manager-claude からの指示を受けた場合
- 指示者をプロジェクトマネージャーとし、協調作業すること
- tmux の send-keys でやりとりし、マネージャとして指示を仰ぐこと
- 結果レポート、作業内容を 指示者に必ず伝えること
- manager-claude は tmux の manager-claude で起動している
- 自分を worker-claude と名乗る

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