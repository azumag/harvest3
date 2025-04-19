/**
 * ナビゲーションバー管理スクリプト
 * 全ページで共通のナビゲーションバーを読み込み、現在のページに応じて適切なリンクをアクティブにします
 */
$(document).ready(function() {
    // ナビゲーションバーを読み込む
    $("#navbar-container").load("navbar.html", function() {
        // 現在のページのパス名を取得
        const currentPath = window.location.pathname;
        const pageName = currentPath.split('/').pop();
        
        // デフォルトでは何もアクティブにしない
        let activeNavId = null;
        
        // 現在のページに応じて適切なナビゲーション項目をアクティブにする
        if (pageName === 'index.html' || pageName === '' || pageName === '/') {
            activeNavId = 'nav-dashboard';
        } else if (pageName === 'positions.html') {
            activeNavId = 'nav-positions';
        } else if (pageName === 'history.html') {
            activeNavId = 'nav-history';
        } else if (pageName === 'filled-history.html') {
            activeNavId = 'nav-filled-history';
        } else if (pageName === 'order-pairs.html') {
            activeNavId = 'nav-order-pairs';
        } else if (pageName === 'analysis.html') {
            activeNavId = 'nav-analysis';
        } else if (pageName === 'signal-history.html') {
            activeNavId = 'nav-signal-history';
        }
        
        // アクティブなナビゲーション項目にactiveクラスを追加
        if (activeNavId) {
            $('#' + activeNavId).addClass('active');
        }
    });
});