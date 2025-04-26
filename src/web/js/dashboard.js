/**
  * ダッシュボード画面の機能を制御するスクリプト
  */
 
 // グローバル変数
 let currentPeriod = 'daily';
 let profitChart = null;
 let allOrderPairs = []; // すべての注文ペアデータを保持
 let currentSymbolFilter = 'all'; // 現在選択されている銘柄フィルタ
 let keys = null;
 let uniqueExchanges = []; // ユニークな取引所IDを保持
 let allSummaryData = null; // 全てのサマリーデータを保持
 
 // 初期化関数
 function initDashboard() {
   console.log('ダッシュボードの初期化を開始します');
   
   // 初期データ読み込み
   loadDashboardData();
   
   // ポジションタブのイベントリスナー設定
   document.querySelectorAll('#positionTabs .nav-link').forEach(tab => {
     tab.addEventListener('click', function(e) {
       // タブIDからアクティブなタブを更新
       const tabId = e.target.id;
       if (tabId === 'exchange-tab') activePositionTab = 'exchange';
       else if (tabId === 'symbol-tab') activePositionTab = 'symbol';
       else if (tabId === 'strategy-tab') activePositionTab = 'strategy';
     });
   });
 
 }
 
 // スクリプトが読み込まれたら即時実行
 // DOMContentLoadedが既に発火していても動作するように
 if (document.readyState === 'loading') {
   document.addEventListener('DOMContentLoaded', initDashboard);
 } else {
   // DOMはすでに読み込み済み
   initDashboard();
 }
 
 /**
  * ダッシュボードの全データを読み込む
  */
 async function loadDashboardData() {
   try {
     keys = await loadKeys();
     if (keys && keys.length > 0) {
       uniqueExchanges = [...new Set(keys.map(key => key.split(':')[1]))].sort(); // ユニークな取引所IDを取得しソート
       createExchangeSummaryTabs(uniqueExchanges); // 取引所サマリータブを生成
       await loadSummary(); // 全サマリーデータを読み込む
     } else {
       // キーがない場合の処理（例：エラーメッセージ表示など）
       console.warn('取引キーが見つかりませんでした。');
       // ローディング表示を削除またはメッセージ表示
       const exchangeTabsContainer = document.getElementById('exchangeSummaryTabs');
       const exchangeContentContainer = document.getElementById('exchangeSummaryTabContent');
       if (exchangeTabsContainer) exchangeTabsContainer.innerHTML = '<li class="nav-item"><span class="nav-link disabled">データなし</span></li>';
       if (exchangeContentContainer) exchangeContentContainer.innerHTML = '<div class="no-data-message p-3"><p>表示するサマリーデータがありません。</p></div>';
     }
     // 他のデータ読み込み（必要に応じて）
     // loadPositions();
     // loadOrderPairsSummary();
     // loadRecentTrades();
   } catch (error) {
     console.error('ダッシュボードデータの読み込み中にエラーが発生しました:', error);
     // エラー発生時のUI表示（例：エラーメッセージ）
     const exchangeTabsContainer = document.getElementById('exchangeSummaryTabs');
     const exchangeContentContainer = document.getElementById('exchangeSummaryTabContent');
     if (exchangeTabsContainer) exchangeTabsContainer.innerHTML = '<li class="nav-item"><span class="nav-link disabled text-danger">エラー</span></li>';
     if (exchangeContentContainer) exchangeContentContainer.innerHTML = `<div class="alert alert-danger" role="alert">データの読み込みに失敗しました: ${error.message}</div>`;
   }
 }
 
 /**
  * 取引所サマリーのタブを動的に生成する
  * @param {string[]} exchanges - 取引所IDの配列
  */
 function createExchangeSummaryTabs(exchanges) {
   const tabsContainer = document.getElementById('exchangeSummaryTabs');
   const contentContainer = document.getElementById('exchangeSummaryTabContent');
 
   if (!tabsContainer || !contentContainer) {
     console.error('タブコンテナが見つかりません。');
     return;
   }
 
   // コンテナをクリア
   tabsContainer.innerHTML = '';
   contentContainer.innerHTML = '';
 
   if (exchanges.length === 0) {
     tabsContainer.innerHTML = '<li class="nav-item"><span class="nav-link disabled">取引所なし</span></li>';
     contentContainer.innerHTML = '<div class="no-data-message p-3"><p>表示する取引所がありません。</p></div>';
     return;
   }
 
   exchanges.forEach((exchange, index) => {
     const isActive = index === 0;
     const tabId = `exchange-summary-tab-${exchange}`;
     const contentId = `exchange-summary-content-${exchange}`;
 
     // タブボタンHTML
     const tabHtml = `
       <li class="nav-item" role="presentation">
         <button class="nav-link ${isActive ? 'active' : ''}" id="${tabId}" data-bs-toggle="tab" data-bs-target="#${contentId}" type="button" role="tab" aria-controls="${contentId}" aria-selected="${isActive}">
           ${exchange}
         </button>
       </li>
     `;
     tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
 
     // タブコンテンツHTML (初期状態はローディングスピナー)
     const contentHtml = `
       <div class="tab-pane fade ${isActive ? 'show active' : ''}" id="${contentId}" role="tabpanel" aria-labelledby="${tabId}">
         <div class="text-center py-3 initial-loading">
           <div class="spinner-border text-primary spinner-border-sm" role="status">
             <span class="visually-hidden">読み込み中...</span>
           </div>
         </div>
       </div>
     `;
     contentContainer.insertAdjacentHTML('beforeend', contentHtml);
 
     // タブクリック時のイベントリスナー
     const tabElement = document.getElementById(tabId);
     if (tabElement) {
       tabElement.addEventListener('shown.bs.tab', () => {
         // データが読み込まれていれば表示、なければローディング表示のまま
         if (allSummaryData) {
           displayExchangeSummary(exchange, contentId);
         }
       });
     }
   });
 }
 
 
 async function loadKeys() {
   try {
     const response = await fetch('/api/trade-keys');
     if (!response.ok) {
       throw new Error(`key情報の取得に失敗しました (${response.status})`);
     }
     const data = await response.json();
     console.log('key情報:', data);
     return data;
   } catch (error) {
     console.error(error);
     // エラーを再スローして呼び出し元で処理できるようにする
     throw error;
   }
 }
 
 /**
 * ポジション情報を読み込んで表示
 */
 // ポジション表示に関するグローバル変数
 let allPositions = []; // すべてのポジションデータを保持
 let currentPositionPage = 1; // 現在のページ（旧方式用）
 const positionsPerPage = 7; // 1ページあたりの表示件数（旧方式用）
 let activePositionTab = 'exchange'; // アクティブなタブ：'exchange', 'symbol', 'strategy'
 function loadPositions() {
   // 各タブのコンテナに読み込み中の表示
   const loadingHTML = `
     <div class="text-center py-3">
       <div class="spinner-border text-primary" role="status">
         <span class="visually-hidden">読み込み中...</span>
       </div>
     </div>
   `;
   
   document.getElementById('positions-container-exchange').innerHTML = loadingHTML;
   document.getElementById('positions-container-symbol').innerHTML = loadingHTML;
   document.getElementById('positions-container-strategy').innerHTML = loadingHTML;
   
   // APIからデータ取得
   fetch('/api/positions')
     .then(response => response.json())
     .then(data => {
       if (!data.positions || data.positions.length === 0) {
         const noDataHTML = `
           <div class="no-data-message">
             <p>現在のポジションはありません</p>
           </div>
         `;
         document.getElementById('positions-container-exchange').innerHTML = noDataHTML;
         document.getElementById('positions-container-symbol').innerHTML = noDataHTML;
         document.getElementById('positions-container-strategy').innerHTML = noDataHTML;
         return;
       }
       
       // 全ポジションデータをグローバル変数に保存
       allPositions = data.positions;
       
       // 新しいグループ化表示メソッドで表示
       displayGroupedPositions();
       
       // 旧方式の表示も維持（現在は非表示）
       // 現在のページを1ページ目に戻す
       currentPositionPage = 1;
       
       // ポジションの表示を更新（旧方式）
       // 互換性のために残しておく
       // displayPositionsPage();
     })
     .catch(error => {
       console.error('ポジション情報の取得に失敗しました:', error);
       const errorHTML = `
         <div class="alert alert-danger" role="alert">
           ポジション情報の取得に失敗しました。詳細はコンソールを確認してください。
         </div>
       `;
       document.getElementById('positions-container-exchange').innerHTML = errorHTML;
       document.getElementById('positions-container-symbol').innerHTML = errorHTML;
       document.getElementById('positions-container-strategy').innerHTML = errorHTML;
     });
 }
 
 /**
  * ポジションの特定ページを表示
  */
 function displayPositionsPage() {
   const container = document.getElementById('positions-container');
   const paginationContainer = document.getElementById('positions-pagination');
   
   // 表示するポジションの範囲を計算
   const startIndex = (currentPositionPage - 1) * positionsPerPage;
   const endIndex = Math.min(startIndex + positionsPerPage, allPositions.length);
   const currentPagePositions = allPositions.slice(startIndex, endIndex);
   
   // ポジションカードを表示
   let html = '';
   currentPagePositions.forEach(position => {
     const isPositive = position.realizedPnL > 0;
     const cardClass = isPositive ? 'positive' : position.realizedPnL < 0 ? 'negative' : '';
     
     html += `
       <div class="position-summary ${cardClass} mb-2 p-2 border rounded" id="position-summary-${position.exchangeId}-${position.symbol.replace('/', '-')}-${position.strategyKey}">
         <div class="d-flex justify-content-between align-items-center">
           <div>
             <strong>${position.symbol}</strong>
             <small class="text-muted ms-2">${position.exchangeId} - ${position.strategyKey}</small>
           </div>
           <span class="badge ${isPositive ? 'bg-success' : position.realizedPnL < 0 ? 'bg-danger' : 'bg-secondary'}">
             ${position.realizedPnL !== null && position.realizedPnL !== undefined ? position.realizedPnL.toLocaleString() : '0'} 円
           </span>
         </div>
       </div>
     `;
   });
   
   container.innerHTML = html;
   
   // ページネーションを更新
   updatePositionsPagination();
 }
 
 /**
  * ポジションデータを取引所、通貨、戦略別にグループ化して表示
  */
 function displayGroupedPositions() {
   // データが空の場合の処理
   if (allPositions.length === 0) {
     document.getElementById('positions-container-exchange').innerHTML = '<div class="no-data-message"><p>現在のポジションはありません</p></div>';
     document.getElementById('positions-container-symbol').innerHTML = '<div class="no-data-message"><p>現在のポジションはありません</p></div>';
     document.getElementById('positions-container-strategy').innerHTML = '<div class="no-data-message"><p>現在のポジションはありません</p></div>';
     return;
   }
   
   // タブに応じたデータのグループ化
   const byExchange = groupPositionsByKey(allPositions, 'exchangeId');
   const bySymbol = groupPositionsByKey(allPositions, 'symbol');
   const byStrategy = groupPositionsByKey(allPositions, 'strategyKey');
   
   // 各タブのコンテンツを更新
   displayPositionGroupContent('positions-container-exchange', byExchange);
   displayPositionGroupContent('positions-container-symbol', bySymbol);
   displayPositionGroupContent('positions-container-strategy', byStrategy);
   
   // タブのイベントリスナーを設定
   setupPositionTabListeners();
 }
 
 /**
  * ポジションデータを特定のキーでグループ化する
  * @param {Array} positions - ポジションデータの配列
  * @param {string} key - グループ化するキー
  * @returns {Object} - グループ化されたポジションデータ
  */
 function groupPositionsByKey(positions, key) {
   const grouped = {};
   
   positions.forEach(position => {
     const groupKey = position[key];
     if (!grouped[groupKey]) {
       grouped[groupKey] = [];
     }
     grouped[groupKey].push(position);
   });
   
   return grouped;
 }
 
 /**
  * グループ化されたポジションをコンテナに表示
  * @param {string} containerId - 表示するコンテナのID
  * @param {Object} groupedData - グループ化されたポジションデータ
  */
 function displayPositionGroupContent(containerId, groupedData) {
   const container = document.getElementById(containerId);
   let html = '';
   
   // グループごとにポジションを表示
   Object.keys(groupedData).forEach(groupKey => {
     const positions = groupedData[groupKey];
     const totalPnL = positions.reduce((sum, pos) => sum + (pos.realizedPnL || 0), 0);
     const totalFee = positions.reduce((sum, pos) => sum + (pos.totalFee || 0), 0); // 手数料合計を計算
     const isPositive = totalPnL > 0;
     const badgeClass = isPositive ? 'bg-success' : totalPnL < 0 ? 'bg-danger' : 'bg-secondary';
     
     // ユニークなIDを生成
     const groupId = `group-${containerId}-${groupKey.replace(/[^a-zA-Z0-9]/g, '-')}`;
     
     html += `
       <div class="position-group mb-2">
         <div class="position-group-header" data-bs-toggle="collapse" data-bs-target="#${groupId}">
           <h6>
             ${groupKey}
             <span>
               <span class="badge rounded-pill ${badgeClass} me-2">${totalPnL.toLocaleString()} 円</span>
               <span class="text-muted me-2">(${totalFee.toLocaleString()})</span> <!-- 手数料合計を括弧で囲んで追加 -->
               <span class="badge bg-secondary">${positions.length}</span>
             </span>
           </h6>
         </div>
         <div class="collapse" id="${groupId}">
           <div class="p-2">
     `;
     
     // グループ内の各ポジションを表示
     positions.forEach(position => {
       const isPositive = position.netPnL > 0; // 合算損益で色分け
       const cardClass = isPositive ? 'positive' : position.netPnL < 0 ? 'negative' : ''; // 合算損益で色分け
       
       html += `
         <div class="position-summary ${cardClass} mb-2 p-2 border rounded">
           <div class="d-flex justify-content-between align-items-center">
             <div>
               <strong>${position.symbol}</strong>
               <small class="text-muted ms-2">${position.exchangeId} - ${position.strategyKey}</small>
             </div>
             <div class="d-flex align-items-center"> <!-- d-flex と align-items-center を追加 -->
               <span class="badge ${position.realizedPnL > 0 ? 'bg-success' : position.realizedPnL < 0 ? 'bg-danger' : 'bg-secondary'} me-1">
                 ${position.realizedPnL !== null && position.realizedPnL !== undefined ? position.realizedPnL.toLocaleString() : '0'}
               </span>
               +
               <span class="badge bg-info text-dark mx-1"> <!-- me-1 を mx-1 に変更して左右にマージン -->
                 ${position.totalFee !== null && position.totalFee !== undefined ? position.totalFee.toLocaleString() : '0'}
               </span>
               =
               <span class="badge ${isPositive ? 'bg-success' : position.netPnL < 0 ? 'bg-danger' : 'bg-secondary'} ms-1"> <!-- マージンを追加 -->
                 ${position.netPnL !== null && position.netPnL !== undefined ? position.netPnL.toLocaleString() : '0'} 円
               </span>
             </div>
           </div>
         </div>
       `;
     });
     
     html += `
           </div>
         </div>
       </div>
     `;
   });
   
   container.innerHTML = html;
 }
 
 /**
  * ポジションタブのイベントリスナーを設定
  */
 function setupPositionTabListeners() {
   document.querySelectorAll('#positionTabs .nav-link').forEach(tab => {
     tab.addEventListener('click', function(e) {
       // タブIDからアクティブなタブを更新
       const tabId = e.target.id;
       if (tabId === 'exchange-tab') activePositionTab = 'exchange';
       else if (tabId === 'symbol-tab') activePositionTab = 'symbol';
       else if (tabId === 'strategy-tab') activePositionTab = 'strategy';
     });
   });
 }
 
 /**
  * ポジションのページネーションを更新
  */
 function updatePositionsPagination() {
   const paginationContainer = document.getElementById('positions-pagination');
   
   // 総ページ数を計算
   const totalPages = Math.ceil(allPositions.length / positionsPerPage);
   
   if (totalPages <= 1) {
     // ページが1つしかない場合はページネーション非表示
     paginationContainer.innerHTML = '';
     return;
   }
   
   let paginationHtml = `
     <nav aria-label="ポジションページネーション">
       <ul class="pagination pagination-sm justify-content-center mb-0">
   `;
   
   // 前へボタン
   paginationHtml += `
     <li class="page-item ${currentPositionPage === 1 ? 'disabled' : ''}">
       <a class="page-link" href="#" data-page="${currentPositionPage - 1}" aria-label="前へ">
         <span aria-hidden="true">&laquo;</span>
       </a>
     </li>
   `;
   
   // ページ番号
   for (let i = 1; i <= totalPages; i++) {
     paginationHtml += `
       <li class="page-item ${i === currentPositionPage ? 'active' : ''}">
         <a class="page-link" href="#" data-page="${i}">${i}</a>
       </li>
     `;
   }
   
   // 次へボタン
   paginationHtml += `
     <li class="page-item ${currentPositionPage === totalPages ? 'disabled' : ''}">
       <a class="page-link" href="#" data-page="${currentPositionPage + 1}" aria-label="次へ">
         <span aria-hidden="true">&raquo;</span>
       </a>
     </li>
   `;
   
   paginationHtml += `
       </ul>
     </nav>
   `;
   
   paginationContainer.innerHTML = paginationHtml;
   
   // ページネーションのクリックイベントを設定
   document.querySelectorAll('#positions-pagination .page-link').forEach(link => {
     link.addEventListener('click', (e) => {
       e.preventDefault();
       const page = parseInt(e.target.getAttribute('data-page') || e.target.parentElement.getAttribute('data-page'));
       if (!isNaN(page) && page > 0 && page <= totalPages) {
         currentPositionPage = page;
         displayPositionsPage();
       }
     });
   });
 }
 
 /**
  * サマリー情報を読み込んで表示 (全取引所対応)
  */
 async function loadSummary() {
   // 戦略別サマリーコンテナ (こちらは変更なし)
   const strategyContainer = document.getElementById('strategy-summary-container');
   
   // 戦略別サマリーのローディング表示
   if (strategyContainer) {
     strategyContainer.innerHTML = `
       <div class="text-center py-5">
         <div class="spinner-border text-primary" role="status">
           <span class="visually-hidden">読み込み中...</span>
         </div>
       </div>
     `;
   }
   
   try {
     // APIから全サマリーデータ取得 (引数なし)
     const response = await fetch(`/api/summary`);
     if (!response.ok) {
       throw new Error(`サマリー情報の取得に失敗しました (${response.status})`);
     }
     allSummaryData = await response.json(); // グローバル変数に保存
     
     // デバッグ用：APIレスポンスをコンソールに出力
     console.log('全サマリーデータ:', allSummaryData);
     
     // 最初にアクティブな取引所タブのサマリーを表示
     const activeTab = document.querySelector('#exchangeSummaryTabs .nav-link.active');
     if (activeTab) {
       const activeExchangeId = activeTab.textContent.trim(); // タブのテキストから取引所IDを取得
       const activeContentId = activeTab.getAttribute('data-bs-target').substring(1); // #を除去
       displayExchangeSummary(activeExchangeId, activeContentId);
     } else if (uniqueExchanges.length > 0) {
       // アクティブタブが見つからない場合、最初の取引所を表示
       const firstExchangeId = uniqueExchanges[0];
       const firstContentId = `exchange-summary-content-${firstExchangeId}`;
       displayExchangeSummary(firstExchangeId, firstContentId);
     }
     
     // 戦略別サマリーを表示 (データ構造が同じならそのまま使えるはず)
     if (strategyContainer) {
       displayStrategySummary(allSummaryData, strategyContainer);
     }
     
     // 累積損益グラフを更新 (データ構造が同じならそのまま使えるはず)
     // updateProfitChart(allSummaryData); // 必要ならコメント解除
     
   } catch (error) {
     console.error('サマリー情報の取得に失敗しました:', error);
     const errorHtml = `
       <div class="alert alert-danger" role="alert">
         サマリー情報の取得に失敗しました。詳細はコンソールを確認してください。
       </div>
     `;
     // エラー表示 (取引所タブと戦略タブの両方)
     const exchangeContentContainer = document.getElementById('exchangeSummaryTabContent');
     if (exchangeContentContainer) {
       // 全てのタブコンテンツにエラー表示
       exchangeContentContainer.querySelectorAll('.tab-pane').forEach(pane => {
         pane.innerHTML = errorHtml;
       });
     }
     if (strategyContainer) {
       strategyContainer.innerHTML = errorHtml;
     }
   }
 }
 
 /**
  * 特定の取引所のサマリーを指定されたコンテナに表示
  * @param {string} exchangeId - 表示する取引所のID
  * @param {string} containerId - 表示するコンテナ要素のID
  */
 function displayExchangeSummary(exchangeId, containerId) {
   const container = document.getElementById(containerId);
   if (!container) {
     console.error(`コンテナが見つかりません: ${containerId}`);
     return;
   }
 
   // グローバルデータから該当取引所のデータを取得
   const exchangeData = allSummaryData?.byExchange?.[exchangeId];
 
   if (!exchangeData) {
     container.innerHTML = `
       <div class="no-data-message p-3">
         <p>${exchangeId} のサマリーデータがありません</p>
       </div>
     `;
     return;
   }
   
   // テーブルをレスポンシブコンテナで囲む
   let html = '<div class="table-responsive"><table class="summary-table table-sm">';
   html += `
     <thead>
       <tr>
         <th>項目</th>
         <th>値</th>
       </tr>
     </thead>
     <tbody>
   `;
   
   // 数値をフォーマットする関数 (既存のものを流用または改善)
   const formatNumber = (num) => {
     if (num === null || num === undefined) return '0';
     // 1000以上の場合は小数点以下を省略
     if (Math.abs(num) >= 1000) {
       return Math.round(num).toLocaleString();
     }
     // 1000未満の場合は小数点以下1桁まで表示
     return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
   };
 
   // 表示する項目とキーのマッピング
   const summaryItems = [
     { label: '買った額', key: 'totalBuyCost', unit: '円' },
     { label: '売った額', key: 'totalSellValue', unit: '円' },
     { label: '手数料', key: 'totalFee', unit: '円' },
     { label: '実現損益', key: 'realizedPnL', unit: '円', classKey: 'realizedPnL' },
     { label: '純損益', key: 'netPnL', unit: '円', classKey: 'netPnL' },
     // 必要に応じて他の項目を追加
     // { label: '買付量', key: 'buyAmount', unit: '' },
     // { label: '売却量', key: 'sellAmount', unit: '' },
     // { label: 'ネットポジション', key: 'netPosition', unit: '' },
   ];
 
   // 各項目を表示
   summaryItems.forEach(item => {
     const value = exchangeData[item.key];
     let valueClass = '';
     if (item.classKey) {
       const pnlValue = exchangeData[item.classKey];
       valueClass = pnlValue > 0 ? 'profit' : pnlValue < 0 ? 'loss' : '';
     }
     html += `
       <tr>
         <td>${item.label}</td>
         <td class="${valueClass}">${formatNumber(value)} ${item.unit}</td>
       </tr>
     `;
   });
   
   html += '</tbody></table></div>';
   container.innerHTML = html;
 }
 
 /**
  * 戦略別サマリーを表示 (変更なし、ただし呼び出し元で allSummaryData を渡す)
  * @param {Object} data - APIから取得した全サマリーデータ
  * @param {HTMLElement} container - 表示するコンテナ要素
  */
 function displayStrategySummary(data, container) {
   if (!data.byStrategy || Object.keys(data.byStrategy).length === 0) {
     container.innerHTML = `
       <div class="no-data-message">
         <p>表示するデータがありません</p>
       </div>
     `;
     return;
   }
   
   // テーブルをレスポンシブコンテナで囲む
   let html = '<div class="table-responsive"><table class="summary-table table-sm">';
   html += `
     <thead>
       <tr>
         <th>戦略</th>
         <th>買った額</th>
         <th>売った額</th>
         <th>手数料</th>
         <th>実現損益</th>
         <th>純損益</th>
       </tr>
     </thead>
     <tbody>
   `;
   
   // 各戦略のデータを表示
   Object.keys(data.byStrategy).forEach(strategyKey => {
     const strategy = data.byStrategy[strategyKey];
     const pnlClass = strategy.realizedPnL > 0 ? 'profit' : strategy.realizedPnL < 0 ? 'loss' : '';
     const netPnlClass = strategy.netPnL > 0 ? 'profit' : strategy.netPnL < 0 ? 'loss' : '';
     
     // 数値を短く表示するためのフォーマット関数
     const formatNumber = (num) => {
       if (num === null || num === undefined) return '0';
       // 1000以上の場合は小数点以下を省略
       if (Math.abs(num) >= 1000) {
         return Math.round(num).toLocaleString();
       }
       // 1000未満の場合は小数点以下1桁まで表示
       return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
     };
     
     html += `
       <tr>
         <td>${strategyKey}</td>
         <td>${formatNumber(strategy.totalBuyCost)} 円</td>
         <td>${formatNumber(strategy.totalSellValue)} 円</td>
         <td>${formatNumber(strategy.totalFee)} 円</td>
         <td class="${pnlClass}">${formatNumber(strategy.realizedPnL)} 円</td>
         <td class="${netPnlClass}">${formatNumber(strategy.netPnL)} 円</td>
       </tr>
     `;
   });
   
   html += '</tbody></table></div>';
   container.innerHTML = html;
 }
 
 
 /**
  * 注文ペアサマリーを読み込んで表示
  */
 /**
  * 注文ペアサマリーを読み込んで表示
  */
 function loadOrderPairsSummary() {
   const container = document.getElementById('order-pairs-summary-container');
   
   // ローディング表示
   container.innerHTML = `
     <div class="text-center py-5">
       <div class="spinner-border text-primary" role="status">
         <span class="visually-hidden">読み込み中...</span>
       </div>
     </div>
   `;
   
   // APIからデータ取得
   fetch('/api/current-order-pairs')
     .then(response => response.json())
     .then(data => {
       if (!data.currentOrderPairs || data.currentOrderPairs.length === 0) {
         container.innerHTML = `
           <div class="no-data-message">
             <p>注文ペアデータがありません</p>
           </div>
         `;
         return;
       }
       
       // 全データを保存
       allOrderPairs = data.currentOrderPairs;
       
       // 銘柄リストを更新
       updateSymbolDropdown();
       
       // フィルタに基づいて表示
       displayFilteredOrderPairs();
     })
     .catch(error => {
       console.error('注文ペアサマリーの取得に失敗しました:', error);
       container.innerHTML = `
         <div class="alert alert-danger" role="alert">
           注文ペアサマリーの取得に失敗しました。詳細はコンソールを確認してください。
         </div>
       `;
     });
 }
 
 /**
  * 銘柄ドロップダウンを更新
  */
 function updateSymbolDropdown() {
   const symbolFilter = document.getElementById('symbol-filter');
   if (!symbolFilter) return;
   
   // 現在の選択値を保存
   const currentValue = symbolFilter.value;
   
   // ユニークな銘柄リストを取得
   const uniqueSymbols = [...new Set(allOrderPairs.map(item => item.symbol))].sort();
   
   // ドロップダウンの選択肢を更新（「すべて表示」オプションは維持）
   let options = '<option value="all">すべて表示</option>';
   uniqueSymbols.forEach(symbol => {
     options += `<option value="${symbol}">${symbol}</option>`;
   });
   
   symbolFilter.innerHTML = options;
   
   // 以前の選択値が存在すれば復元
   if (uniqueSymbols.includes(currentSymbolFilter) || currentSymbolFilter === 'all') {
     symbolFilter.value = currentSymbolFilter;
   } else {
     // 以前の選択値が存在しない場合は「すべて表示」に
     currentSymbolFilter = 'all';
     symbolFilter.value = 'all';
   }
 }
 
 /**
  * フィルタに基づいて注文ペアを表示
  */
 function displayFilteredOrderPairs() {
   const container = document.getElementById('order-pairs-summary-container');
   
   // フィルタリング
   let filteredPairs = allOrderPairs;
   if (currentSymbolFilter !== 'all') {
     filteredPairs = allOrderPairs.filter(item => item.symbol === currentSymbolFilter);
   }
   
   if (filteredPairs.length === 0) {
     container.innerHTML = `
       <div class="no-data-message">
         <p>条件に一致する注文ペアはありません</p>
       </div>
     `;
     return;
   }
   
   // カードを生成
   let html = '';
   
   filteredPairs.forEach(item => {
     // 買い/売り注文情報を取得
     const buyOrder = item.pair.buyOrder || {};
     const sellOrder = item.pair.sellOrder || {};
     
     // ステータスバッジのスタイルを決定
     const getBadgeClass = (status) => {
       switch(status) {
         case 'open': return 'bg-primary';
         case 'closed': return 'bg-success';
         case 'canceled': return 'bg-warning';
         case 'expired': return 'bg-secondary';
         case 'rejected': return 'bg-danger';
         default: return 'bg-secondary';
       }
     };
     
     // 価格とステータスの表示を整形
     const buyPrice = buyOrder.price ? buyOrder.price.toLocaleString() : '-';
     const sellPrice = sellOrder.price ? sellOrder.price.toLocaleString() : '-';
     const buyStatus = buyOrder.status || '-';
     const sellStatus = sellOrder.status || '-';
     const amount = item.pair.amount || (buyOrder.amount || sellOrder.amount || 0);
     
     // 買い/売り注文の状態に応じたバッジスタイル
     const buyBadgeClass = getBadgeClass(buyStatus);
     const sellBadgeClass = getBadgeClass(sellStatus);
     
     // 日時表示
     const formatDate = (timestamp) => {
       if (!timestamp) return '-';
       const date = new Date(timestamp);
       return date.toLocaleString('ja-JP', {
         month: '2-digit',
         day: '2-digit',
         hour: '2-digit',
         minute: '2-digit'
       });
     };
     
     const buyDate = formatDate(buyOrder.timestamp);
     const sellDate = formatDate(sellOrder.timestamp);
     
     // カードHTMLを生成
     html += `
       <div class="order-pair-card">
         <h6>
           ${item.symbol}
           <small class="text-muted">${item.exchangeId}</small>
         </h6>
         <div class="small text-muted mb-2">${item.strategyKey}</div>
         
         <div class="price-info">
           <span class="price-label">買価格:</span>
           <span class="buy-price">${buyPrice}</span>
         </div>
         <div class="price-info">
           <span class="price-label">売価格:</span>
           <span class="sell-price">${sellPrice}</span>
         </div>
         
         <div class="small">数量: ${amount}</div>
         
         <div class="status">
           <span>買: <span class="badge ${buyBadgeClass}">${buyStatus}</span></span>
           <span>売: <span class="badge ${sellBadgeClass}">${sellStatus}</span></span>
         </div>
         
         <div class="metadata">
           <div>買: ${buyDate}</div>
           <div>売: ${sellDate}</div>
         </div>
       </div>
     `;
   });
   
   container.innerHTML = html;
 }