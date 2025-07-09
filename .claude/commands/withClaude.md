# claude as orchestrator
- もうひとつの manager-Claude をプロジェクトマネージャとし、協業作業すること
- tmux の send-keys でやりとりし、指示を仰ぐこと
- その際には自分が worker-claude であることを伝える
- manager-claude はプロジェクトマネージャーであることを伝える
- 結果レポート、作業内容を manager-claude に必ず伝えること
- Gemini は tmux の manager-claude で起動している
- 先頭に /orchestrator をつける
- 変更内容を担保するテストを必ず作成する。テストはt-wada流
- 単体テスト、e2e テストを作りciに組み込む
<!-- - 末尾に think をつける -->

## tmux 操作
- メッセージを送信する前に、capture-pane でプロンプトが表示されていることを必ず確認すること：tmux capture-pane -t "manager-claude" -p
- Gemini の作業を一旦キャンセルしたいときは esc を send-keys すべし
- tmux send-keys -t "manager-claude" "内容" Enter
- tmux send-keys -t "manager-claude" "" Enter
- Enterは10秒間をおいて2回送る必要がある