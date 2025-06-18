/**
 * 未売却ポジション管理 JavaScript
 * 買い注文が約定済みだが、まだ売却していないポジションを表示
 */

let filledPositionsData = [];
let filteredData = [];

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', function() {
    loadFilledPositions();
    setupAutoRefresh();
});

// データ読み込み
async function loadFilledPositions() {
    try {
        const response = await fetch('/api/filled-positions');
        const data = await response.json();
        
        if (response.ok) {
            filledPositionsData = data.positions || [];
            filteredData = [...filledPositionsData];
            
            updateStatistics(data.stats);
            updatePositionsTable();
            populateFilters();
            updateLastUpdated(data.timestamp);
        } else {
            console.error('Error loading filled positions:', data.error);
            showError('未売却ポジションデータの読み込みに失敗しました: ' + data.error);
        }
    } catch (error) {
        console.error('Error loading filled positions:', error);
        showError('未売却ポジションデータの読み込みに失敗しました: ' + error.message);
    }
}

// 統計情報の更新
function updateStatistics(stats) {
    document.getElementById('total-filled-positions').textContent = stats.totalFilledPositions || 0;
    
    const totalPnL = stats.totalUnrealizedPnL || 0;
    const pnlElement = document.getElementById('total-unrealized-pnl');
    pnlElement.textContent = formatCurrency(totalPnL);
    pnlElement.className = totalPnL >= 0 ? 'text-success' : 'text-danger';
    
    const avgTime = stats.averageHoldingTime || 0;
    document.getElementById('average-holding-time').textContent = formatHours(avgTime);
}

// ポジションテーブルの更新
function updatePositionsTable() {
    const tbody = document.getElementById('positions-tbody');
    
    if (filteredData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center text-muted">
                    未売却ポジションが見つかりません
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filteredData.map(position => {
        const pnl = position.unrealizedPnL || 0;
        const pnlPercent = position.unrealizedPnLPercent || 0;
        const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';
        const sideClass = position.side === 'buy' ? 'text-primary' : 'text-warning';
        
        // 約定済みポジションの場合は保有時間を使用、そうでなければ経過時間を計算
        console.log('Debug position:', position.symbol, 'holdingTimeHours:', position.holdingTimeHours, 'createdAt:', position.createdAt, 'closedAt:', position.closedAt);
        const holdingTime = position.holdingTimeHours || 
                           (position.createdAt && position.closedAt ? 
                            (new Date(position.closedAt) - new Date(position.createdAt)) / (1000 * 60 * 60) : 
                            (Date.now() - position.timestamp) / (1000 * 60 * 60));
        console.log('Debug calculated holdingTime:', holdingTime);
        
        return `
            <tr>
                <td>${position.exchange}</td>
                <td><strong>${position.symbol}</strong></td>
                <td><span class="badge bg-secondary">${position.strategy}</span></td>
                <td><span class="badge bg-${position.side === 'buy' ? 'primary' : 'warning'}">${position.side.toUpperCase()}</span></td>
                <td>${formatNumber(position.amount)}</td>
                <td>¥${formatNumber(position.entryPrice)}</td>
                <td>¥${formatNumber(position.currentPrice)}</td>
                <td class="${pnlClass}"><strong>¥${formatNumber(pnl)}</strong></td>
                <td class="${pnlClass}"><strong>${formatPercent(pnlPercent)}%</strong></td>
                <td>${formatHours(holdingTime)}</td>
                <td>${formatDateTime(position.closedAt || position.timestamp)}</td>
            </tr>
        `;
    }).join('');
}

// フィルター用のドロップダウンを設定
function populateFilters() {
    const exchanges = [...new Set(filledPositionsData.map(p => p.exchange))];
    const symbols = [...new Set(filledPositionsData.map(p => p.symbol))];
    const strategies = [...new Set(filledPositionsData.map(p => p.strategy))];
    
    populateSelect('exchange-filter', exchanges);
    populateSelect('symbol-filter', symbols);
    populateSelect('strategy-filter', strategies);
}

function populateSelect(selectId, options) {
    const select = document.getElementById(selectId);
    const currentValue = select.value;
    
    // 現在の選択以外をクリア
    select.innerHTML = '<option value="">' + select.options[0].text + '</option>';
    
    options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        select.appendChild(optionElement);
    });
    
    // 前の選択値を復元
    select.value = currentValue;
}

// フィルター適用
function applyFilters() {
    const exchangeFilter = document.getElementById('exchange-filter').value;
    const symbolFilter = document.getElementById('symbol-filter').value;
    const strategyFilter = document.getElementById('strategy-filter').value;
    
    filteredData = filledPositionsData.filter(position => {
        return (!exchangeFilter || position.exchange === exchangeFilter) &&
               (!symbolFilter || position.symbol === symbolFilter) &&
               (!strategyFilter || position.strategy === strategyFilter);
    });
    
    updatePositionsTable();
    
    // フィルター後の統計情報を更新
    const filteredStats = {
        totalFilledPositions: filteredData.length,
        totalUnrealizedPnL: filteredData.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0),
        averageHoldingTime: filteredData.length > 0 ? 
            filteredData.reduce((sum, p) => sum + ((Date.now() - p.timestamp) / (1000 * 60 * 60)), 0) / filteredData.length : 0
    };
    updateStatistics(filteredStats);
}

// データ更新
function refreshData() {
    loadFilledPositions();
}

// 自動更新の設定
function setupAutoRefresh() {
    setInterval(refreshData, 30000); // 30秒ごとに自動更新
}

// 最終更新時刻の表示
function updateLastUpdated(timestamp) {
    const element = document.getElementById('last-updated');
    element.textContent = formatDateTime(timestamp);
}

// エラー表示
function showError(message) {
    const tbody = document.getElementById('positions-tbody');
    tbody.innerHTML = `
        <tr>
            <td colspan="11" class="text-center text-danger">
                <i class="fas fa-exclamation-triangle"></i> ${message}
            </td>
        </tr>
    `;
}

// ユーティリティ関数
function formatCurrency(value) {
    return `¥${formatNumber(value)}`;
}

function formatNumber(value) {
    if (typeof value !== 'number') return '-';
    return value.toLocaleString('ja-JP', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
    });
}

function formatPercent(value) {
    if (typeof value !== 'number') return '-';
    return value.toFixed(2);
}

function formatHours(hours) {
    if (typeof hours !== 'number') return '-';
    
    if (hours < 1) {
        return `${Math.round(hours * 60)}分`;
    } else if (hours < 24) {
        return `${hours.toFixed(1)}時間`;
    } else {
        const days = Math.floor(hours / 24);
        const remainingHours = Math.round(hours % 24);
        return `${days}日${remainingHours}時間`;
    }
}

function formatDateTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}