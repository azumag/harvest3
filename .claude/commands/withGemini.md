# gemini as orchestrator
- Gemini CLI をプロジェクトマネージャとし、協業作業すること
- tmux の send-keys でやりとりし、Gemini 指示を仰ぐこと
- その際には自分が claude であることを伝える
- geminiはプロジェクトマネージャーということを伝える
- 結果レポート、作業内容を Gemini に必ず伝えること
- Gemini は tmux の gemini-harvest で起動している

## tmux 操作
- メッセージを送信する前に、capture-pane でプロンプトが表示されていることを必ず確認すること：tmux capture-pane -t "gemini-harvest" -p
- Gemini の作業を一旦キャンセルしたいときは esc を send-keys すべし
- tmux send-keys -t "gemini-harvest" "内容" Enter && sleep 5 && tmux send-keys -t "gemini-harvest" "" Enter
- Enterは10秒間をおいて2回送る必要がある


tmux send-keys -t 'gemini' "Gitの履歴から作業内容を把握し、厳正なレビューを行なって、レビュー内容を tmux sendkey で送信せよ: 例：tmux send-keys -t "claude-manager" "/orchestrator review-detail think" Enter && sleep 5 && tmux send-keys -t "claude-manager" "" Enter" && sleep 5 && tmux send-keys -t "gemini" "" Enter

