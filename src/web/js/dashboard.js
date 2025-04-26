/**
  * ダッシュボード画面の機能を制御するスクリプト
  */
 
 // グローバル変数
 /**
  * ダッシュボード画面の機能を制御するスクリプト
  */
 
 // グローバル変数
 let currentOrderPairs = []; // 注文ペアデータを保持
 let currentSymbolFilter = 'all'; // 選択中の銘柄フィルタ
 
 /**
  * 初期化関数
  */
 function initDashboard() {
   console.log('ダッシュボードの初期化を開始します');
 
   // サマリーデータの読み込みと表示
   loadAndDisplaySummary();
 
   // タブ切り替えイベントリスナー設定
   const summaryTabs = document.getElementById('summaryTabs');
   if (summaryTabs) {
     summaryTabs.addEventListener('shown.bs.tab', function (event) {
       // アクティブになったタブのIDを取得
       const activeTabId = event.target.id;
       console.log(`タブが切り替えられました: ${activeTabId}`);
 
       // 必要に応じて各タブのコンテンツを再レンダリング（データは既にロード済み）
       // loadAndDisplaySummary() で一度ロード・集計したデータを使用
       // ここでは特に再レンダリングは不要だが、複雑なUIの場合は必要になることも
     });
   }
 
   // 注文ペアサマリーの銘柄フィルターのイベントリスナー設定
   const symbolFilter = document.getElementById('order-pair-symbol-filter');
   if (symbolFilter) {
     symbolFilter.addEventListener('change', function() {
       currentSymbolFilter = this.value;
       // 注文ペアサマリーの再表示
       renderOrderPairsSummary(currentOrderPairs);
     });
   }
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
  * サマリーデータを読み込み表示する
  */
 async function loadAndDisplaySummary() {
   const loadingElement = document.getElementById('summary-loading');
   const containerElement = document.getElementById('summary-container');
 
   try {
     // APIからサマリーデータを取得
     const response = await fetch('/api/trade-summary');
     if (!response.ok) {
       throw new Error(`サマリー情報の取得に失敗しました (${response.status})`);
     }
 
     const data = await response.json();
     console.log('取得したサマリーデータ:', data);
 
     // データの処理と集計
     const processedData = processSummaryData(data);
 
     // 各セクションの表示
     renderExchangeSummary(processedData.byExchange);
     renderSymbolSummary(processedData.bySymbol); // 銘柄別サマリーのレンダリングを追加
     renderStrategySummary(processedData.byStrategy);
     renderOrderPairsSummary(processedData.orderPairs); // 注文ペアサマリーのレンダリングを再度追加
 
     // ローディング表示を非表示にしてコンテンツを表示
     if (loadingElement) loadingElement.classList.add('d-none');
     if (containerElement) containerElement.classList.remove('d-none');
 
   } catch (error) {
     console.error('サマリーデータの取得と表示中にエラーが発生しました:', error);
 
     // エラーメッセージを表示
     if (loadingElement) {
       loadingElement.innerHTML = `
         <div class="alert alert-danger" role="alert">
           データの読み込みに失敗しました: ${error.message}
         </div>
       `;
     }
   }
 }
 
 /**
  * APIから取得したデータを加工・集計する
  * @param {Array} data - APIから取得した注文ペアデータの配列
  * @returns {Object} - 加工後のデータ（byExchange, bySymbol, byStrategy, orderPairs）
  */
 function processSummaryData(data) {
   // 結果を格納するオブジェクト
   const result = {
     byExchange: {},
     bySymbol: {}, // 銘柄別集計用
     byStrategy: {},
     orderPairs: [] // 注文ペアデータを保持
   };
 
   // 配列データであることを確認
   if (!Array.isArray(data)) {
     console.error('APIレスポンスが期待される配列形式ではありません:', data);
     // エラー処理または空のデータを返すなどの対応
     return result;
   }
 
   // 注文ペアデータとして元データを保存
   result.orderPairs = data;
   currentOrderPairs = data; // グローバル変数に保存
 
   // 各エントリを処理して集計
   data.forEach(entry => {
     const { exchangeId, symbol, strategyKey, totalBuyCost, totalSellValue, totalFee, realizedPnL } = entry;
 
     // 取引所データの集計
     if (!result.byExchange[exchangeId]) {
       result.byExchange[exchangeId] = {
         totalBuyCost: 0,
         totalSellValue: 0,
         totalFee: 0,
         realizedPnL: 0,
         netPnL: 0
       };
     }
     result.byExchange[exchangeId].totalBuyCost += totalBuyCost || 0;
     result.byExchange[exchangeId].totalSellValue += totalSellValue || 0;
     result.byExchange[exchangeId].totalFee += totalFee || 0;
     result.byExchange[exchangeId].realizedPnL += realizedPnL || 0;
 
     // 銘柄データの集計
     if (!result.bySymbol[symbol]) {
       result.bySymbol[symbol] = {
         totalBuyCost: 0,
         totalSellValue: 0,
         totalFee: 0,
         realizedPnL: 0,
         netPnL: 0
       };
     }
     result.bySymbol[symbol].totalBuyCost += totalBuyCost || 0;
     result.bySymbol[symbol].totalSellValue += totalSellValue || 0;
     result.bySymbol[symbol].totalFee += totalFee || 0;
     result.bySymbol[symbol].realizedPnL += realizedPnL || 0;
 
     // 戦略データの集計
     const strategyId = strategyKey || 'unknown'; // strategyKeyがない場合はunknownとして集計
     if (!result.byStrategy[strategyId]) {
       result.byStrategy[strategyId] = {
         totalBuyCost: 0,
         totalSellValue: 0,
         totalFee: 0,
         realizedPnL: 0,
         netPnL: 0
       };
     }
     result.byStrategy[strategyId].totalBuyCost += totalBuyCost || 0;
     result.byStrategy[strategyId].totalSellValue += totalSellValue || 0;
     result.byStrategy[strategyId].totalFee += totalFee || 0;
     result.byStrategy[strategyId].realizedPnL += realizedPnL || 0;
   });
 
   // 純損益の計算
   Object.keys(result.byExchange).forEach(key => {
     result.byExchange[key].netPnL = result.byExchange[key].realizedPnL - result.byExchange[key].totalFee;
   });
 
   Object.keys(result.bySymbol).forEach(key => {
     result.bySymbol[key].netPnL = result.bySymbol[key].realizedPnL - result.bySymbol[key].totalFee;
   });
 
   Object.keys(result.byStrategy).forEach(key => {
     result.byStrategy[key].netPnL = result.byStrategy[key].realizedPnL - result.byStrategy[key].totalFee;
   });
 
   return result;
 }
 
 /**
  * 取引所別サマリーを表示する
  * @param {Object} exchangeData - 取引所別にグループ化されたデータ
  */
 function renderExchangeSummary(exchangeData) {
   const container = document.getElementById('exchange-summary-container');
   if (!container) return;
 
   // データがない場合
   if (!exchangeData || Object.keys(exchangeData).length === 0) {
     container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
     return;
   }
 
   let html = '';
 
   // 各取引所のカードを生成
   Object.keys(exchangeData).forEach(exchangeId => {
     const data = exchangeData[exchangeId];
     const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
 
     html += `
     <div class="col-md-6 col-lg-4 mb-3">
       <div class="card h-100">
         <div class="card-header">
           <h6 class="mb-0">${exchangeId}</h6>
         </div>
         <div class="card-body">
           <table class="table table-sm mb-0">
             <tbody>
               <tr>
                 <td>買った額</td>
                 <td class="text-end">${formatNumber(data.totalBuyCost)} 円</td>
               </tr>
               <tr>
                 <td>売った額</td>
                 <td class="text-end">${formatNumber(data.totalSellValue)} 円</td>
               </tr>
               <tr>
                 <td>手数料</td>
                 <td class="text-end">${formatNumber(data.totalFee)} 円</td>
               </tr>
               <tr>
                 <td>実現損益</td>
                 <td class="text-end ${data.realizedPnL > 0 ? 'text-success' : data.realizedPnL < 0 ? 'text-danger' : ''}">
                   ${formatNumber(data.realizedPnL)} 円
                 </td>
               </tr>
               <tr>
                 <td>純損益</td>
                 <td class="text-end ${netPnlClass} fw-bold">
                   ${formatNumber(data.netPnL)} 円
                 </td>
               </tr>
             </tbody>
           </table>
         </div>
       </div>
     </div>
     `;
   });
 
   container.innerHTML = html;
 }
 
 /**
  * 銘柄別サマリーを表示する (新規追加)
  * @param {Object} symbolData - 銘柄別にグループ化されたデータ
  */
 function renderSymbolSummary(symbolData) {
   const container = document.getElementById('symbol-summary-container');
   if (!container) return;
 
   // データがない場合
   if (!symbolData || Object.keys(symbolData).length === 0) {
     container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
     return;
   }
 
   let html = '';
 
   // 各銘柄のカードを生成
   Object.keys(symbolData).forEach(symbol => {
     const data = symbolData[symbol];
     const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
 
     html += `
     <div class="col-md-6 col-lg-4 mb-3">
       <div class="card h-100">
         <div class="card-header">
           <h6 class="mb-0">${symbol}</h6>
         </div>
         <div class="card-body">
           <table class="table table-sm mb-0">
             <tbody>
               <tr>
                 <td>買った額</td>
                 <td class="text-end">${formatNumber(data.totalBuyCost)} 円</td>
               </tr>
               <tr>
                 <td>売った額</td>
                 <td class="text-end">${formatNumber(data.totalSellValue)} 円</td>
               </tr>
               <tr>
                 <td>手数料</td>
                 <td class="text-end">${formatNumber(data.totalFee)} 円</td>
               </tr>
               <tr>
                 <td>実現損益</td>
                 <td class="text-end ${data.realizedPnL > 0 ? 'text-success' : data.realizedPnL < 0 ? 'text-danger' : ''}">
                   ${formatNumber(data.realizedPnL)} 円
                 </td>
               </tr>
               <tr>
                 <td>純損益</td>
                 <td class="text-end ${netPnlClass} fw-bold">
                   ${formatNumber(data.netPnL)} 円
                 </td>
               </tr>
             </tbody>
           </table>
         </div>
       </div>
     </div>
     `;
   });
 
   container.innerHTML = html;
 }
 
 /**
  * 戦略別サマリーを表示する
  * @param {Object} strategyData - 戦略別にグループ化されたデータ
  */
 function renderStrategySummary(strategyData) {
   const container = document.getElementById('strategy-summary-container');
   if (!container) return;
 
   // データがない場合
   if (!strategyData || Object.keys(strategyData).length === 0) {
     container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
     return;
   }
 
   let html = '';
 
   // 各戦略のカードを生成
   Object.keys(strategyData).forEach(strategyKey => {
     const data = strategyData[strategyKey];
     const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
 
     html += `
     <div class="col-md-6 col-lg-4 mb-3">
       <div class="card h-100">
         <div class="card-header">
           <h6 class="mb-0">${strategyKey}</h6>
         </div>
         <div class="card-body">
           <table class="table table-sm mb-0">
             <tbody>
               <tr>
                 <td>買った額</td>
                 <td class="text-end">${formatNumber(data.totalBuyCost)} 円</td>
               </tr>
               <tr>
                 <td>売った額</td>
                 <td class="text-end">${formatNumber(data.totalSellValue)} 円</td>
               </tr>
               <tr>
                 <td>手数料</td>
                 <td class="text-end">${formatNumber(data.totalFee)} 円</td>
               </tr>
               <tr>
                 <td>実現損益</td>
                 <td class="text-end ${data.realizedPnL > 0 ? 'text-success' : data.realizedPnL < 0 ? 'text-danger' : ''}">
                   ${formatNumber(data.realizedPnL)} 円
                 </td>
               </tr>
               <tr>
                 <td>純損益</td>
                 <td class="text-end ${netPnlClass} fw-bold">
                   ${formatNumber(data.netPnL)} 円
                 </td>
               </tr>
             </tbody>
           </table>
         </div>
       </div>
     </div>
     `;
   });
 
   container.innerHTML = html;
 }
 
 /**
  * 注文ペアサマリーを表示する
  * @param {Array} orderPairs - 注文ペアデータの配列
  */
 function renderOrderPairsSummary(orderPairs) {
   const container = document.getElementById('order-pairs-summary-container');
   if (!container) return;
 
   // 銘柄ドロップダウンの更新
   updateOrderPairSymbolDropdown(orderPairs);
 
   // データがない場合
   if (!orderPairs || orderPairs.length === 0) {
     container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
     return;
   }
 
   // フィルタリング
   let filteredPairs = orderPairs;
   if (currentSymbolFilter !== 'all') {
     filteredPairs = orderPairs.filter(item => item.symbol === currentSymbolFilter);
   }
 
   // フィルタ後にデータがない場合
   if (filteredPairs.length === 0) {
     container.innerHTML = '<div class="col-12"><div class="alert alert-info">条件に一致する注文ペアはありません</div></div>';
     return;
   }
 
   let html = '';
 
   // 各注文ペアのカードを生成
   filteredPairs.forEach(item => {
     const buyOrder = item.pair?.buyOrder || {};
     const sellOrder = item.pair?.sellOrder || {};
 
     // 日時フォーマット
     const formatDate = timestamp => {
       if (!timestamp) return '-';
       const date = new Date(timestamp);
       return date.toLocaleString('ja-JP', {
         month: '2-digit',
         day: '2-digit',
         hour: '2-digit',
         minute: '2-digit'
       });
     };
 
     // ステータスに対応するバッジクラス
     const getStatusBadgeClass = status => {
       switch(status) {
         case 'open': return 'bg-primary';
         case 'closed': return 'bg-success';
         case 'canceled': return 'bg-warning';
         case 'expired': return 'bg-secondary';
         case 'rejected': return 'bg-danger';
         default: return 'bg-secondary';
       }
     };
 
     // 価格データのフォーマット
     const buyPrice = buyOrder.price ? buyOrder.price.toLocaleString() : '-';
     const sellPrice = sellOrder.price ? sellOrder.price.toLocaleString() : '-';
     const buyStatus = buyOrder.status || '-';
     const sellStatus = sellOrder.status || '-';
     const amount = item.pair?.amount || buyOrder.amount || sellOrder.amount || 0;
 
     html += `
     <div class="col-md-6 col-lg-4 mb-3">
       <div class="card h-100 order-pair-card">
         <div class="card-header d-flex justify-content-between align-items-center">
           <h6 class="mb-0">${item.symbol}</h6>
           <small class="text-muted">${item.exchangeId}</small>
         </div>
         <div class="card-body">
           <p class="small text-muted mb-2">${item.strategyKey}</p>
 
           <div class="mb-2">
             <div class="d-flex justify-content-between">
               <span class="price-label">買価格:</span>
               <span class="buy-price">${buyPrice}</span>
             </div>
             <div class="d-flex justify-content-between">
               <span class="price-label">売価格:</span>
               <span class="sell-price">${sellPrice}</span>
             </div>
           </div>
 
           <div class="small mb-2">数量: ${amount}</div>
 
           <div class="d-flex justify-content-between mb-2">
             <span>買: <span class="badge ${getStatusBadgeClass(buyStatus)}">${buyStatus}</span></span>
             <span>売: <span class="badge ${getStatusBadgeClass(sellStatus)}">${sellStatus}</span></span>
           </div>
 
           <div class="border-top pt-2 small text-muted">
             <div>買: ${formatDate(buyOrder.timestamp)}</div>
             <div>売: ${formatDate(sellOrder.timestamp)}</div>
           </div>
         </div>
       </div>
     </div>
     `;
   });
 
   container.innerHTML = html;
 }
 
 /**
  * 注文ペア用の銘柄ドロップダウンを更新
  * @param {Array} orderPairs - 注文ペアデータの配列
  */
 function updateOrderPairSymbolDropdown(orderPairs) {
   const dropdown = document.getElementById('order-pair-symbol-filter');
   if (!dropdown || !orderPairs || orderPairs.length === 0) return;
 
   // 現在の選択値を保存
   const currentValue = dropdown.value;
 
   // ユニークな銘柄リストを取得
   const uniqueSymbols = [...new Set(orderPairs.map(item => item.symbol))].sort();
 
   // ドロップダウンの選択肢を更新
   let options = '<option value="all">すべて表示</option>';
   uniqueSymbols.forEach(symbol => {
     options += `<option value="${symbol}">${symbol}</option>`;
   });
 
   dropdown.innerHTML = options;
 
   // 前回の選択値を復元（存在すれば）
   if (currentSymbolFilter === 'all' || uniqueSymbols.includes(currentSymbolFilter)) {
     dropdown.value = currentSymbolFilter;
   } else {
     currentSymbolFilter = 'all';
     dropdown.value = 'all';
   }
 }
 
 /**
  * 数値を読みやすい形式にフォーマットする
  * @param {number} num - フォーマットする数値
  * @returns {string} - フォーマットされた数値文字列
  */
 function formatNumber(num) {
   if (num === null || num === undefined) return '0';
 
   // 大きな数値の場合は小数点以下を省略
   if (Math.abs(num) >= 1000) {
     return Math.round(num).toLocaleString();
   }
 
   // 小さな数値の場合は小数点以下1桁まで表示
   return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
 }