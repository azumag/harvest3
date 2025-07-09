
document.addEventListener('DOMContentLoaded', function() {
  const POLLING_INTERVAL = 5000; // 5 seconds

  function getStatusClass(status) {
    switch (status) {
    case 'HEALTHY': return { bg: 'bg-success', text: 'text-white', icon: 'bi-check-circle-fill' };
    case 'WARNING': return { bg: 'bg-warning', text: 'text-dark', icon: 'bi-exclamation-triangle-fill' };
    case 'CRITICAL': return { bg: 'bg-danger', text: 'text-white', icon: 'bi-x-octagon-fill' };
    default: return { bg: 'bg-secondary', text: 'text-white', icon: 'bi-question-circle-fill' };
    }
  }

  async function fetchHealthData() {
    try {
      const response = await fetch('/api/system-health');
      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }
      const data = await response.json();
      updateDashboard(data);
    } catch (error) {
      console.error('Failed to fetch health data:', error);
      showErrorState(error.message);
    }
  }

  function updateDashboard(data) {
    // Overall Status
    const statusBanner = document.getElementById('overall-status-banner');
    const statusText = document.getElementById('overall-status-text');
    const statusClasses = getStatusClass(data.overallStatus);
    statusBanner.className = `alert ${statusClasses.bg} ${statusClasses.text}`;
    statusText.textContent = data.overallStatus;

    // Key Metrics
    document.getElementById('metric-discrepancies').textContent = data.keyMetrics.balanceDiscrepancies;
    document.getElementById('metric-untracked').textContent = data.keyMetrics.untrackedPositions;
    document.getElementById('metric-pending').textContent = data.keyMetrics.pendingOrders;
    document.getElementById('metric-strategies').textContent = data.keyMetrics.activeStrategies;

    // Component Status
    const componentContainer = document.getElementById('component-status-container');
    componentContainer.innerHTML = data.componentStatus.map(comp => {
      const compClasses = getStatusClass(comp.status);
      return `<div class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <i class="bi ${compClasses.icon} me-2"></i>
                            <strong>${comp.name}</strong>
                            <small class="text-muted ms-2 d-block d-md-inline">${comp.details}</small>
                        </div>
                        <span class="badge ${compClasses.bg} rounded-pill">${comp.status}</span>
                    </div>`;
    }).join('');

    // Recent Alerts
    const alertsList = document.getElementById('recent-alerts-list');
    if (data.recentAlerts.length > 0) {
      alertsList.innerHTML = data.recentAlerts.map(alert => {
        const alertClasses = getStatusClass(alert.level === 'WARN' ? 'WARNING' : 'INFO');
        return `<li class="list-group-item">
                            <span class="badge ${alertClasses.bg} me-2">${alert.level}</span>
                            <strong>${alert.time}:</strong> ${alert.message}
                        </li>`;
      }).join('');
    } else {
      alertsList.innerHTML = '<li class="list-group-item text-muted">No recent alerts.</li>';
    }
  }

  function showErrorState(errorMessage) {
    const statusBanner = document.getElementById('overall-status-banner');
    const statusText = document.getElementById('overall-status-text');
    statusBanner.className = 'alert alert-danger text-white';
    statusText.textContent = 'ERROR';
    document.getElementById('component-status-container').innerHTML =
            `<div class="list-group-item text-danger">Failed to load component status: ${errorMessage}</div>`;
  }

  // Initial load and start polling
  fetchHealthData();
  setInterval(fetchHealthData, POLLING_INTERVAL);
});
