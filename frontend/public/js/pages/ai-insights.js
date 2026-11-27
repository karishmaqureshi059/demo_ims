import * as api from '../api.js';
import { icon } from '../components/icons.js';
import { showToast } from '../components/toast.js';
import { lineChart, barChart, formatMetricValue, destroyAllCharts } from '../components/charts.js';
import { escapeHtml } from '../utils.js';

let activeChart = null;
let activeCategoryChart = null;
let currentDays = 30;
let selectedProductId = null;
let activeTab = 'restock';

export function mount(container, ctx) {
  const role = ctx.user?.role || 'owner';

  container.innerHTML = `
    <div class="stack-md" style="gap:24px;">
      <!-- Header -->
      <div class="page-head" style="flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
            <h1 style="margin:0;">AI Inventory Insights</h1>
            <span class="badge badge-accent" id="ai-role-pill" style="font-weight:700; font-size:11px; padding:3px 10px;">
              ${escapeHtml(getRoleDescription(role))}
            </span>
          </div>
          <p style="margin:0; color:var(--text-muted);">
            Predictive demand forecasting, smart stockout alerts, and automated restocking recommendations powered by actual sales history.
          </p>
        </div>
        <div class="page-actions" style="display:flex; align-items:center; gap:10px;">
          <button type="button" class="btn btn-outline btn-sm" id="btn-refresh-ai">
            ${icon('refresh', 15)}
            <span>Refresh</span>
          </button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-trigger-ai-alerts">
            ${icon('sparkles', 15)}
            <span>Scan Stock & Evaluate Alerts</span>
          </button>
        </div>
      </div>

      <!-- Top KPI Summary Cards -->
      <div id="ai-kpis" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px;">
        ${'<div class="card"><div class="skeleton" style="height:76px;"></div></div>'.repeat(4)}
      </div>

      <!-- Interactive Demand Forecast Chart -->
      <div class="card" style="padding:22px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:14px; margin-bottom:18px;">
          <div>
            <h2 style="font-size:18px; font-weight:700; margin:0 0 4px 0;">AI Demand Forecast & Historical Trajectory</h2>
            <p style="font-size:13px; color:var(--text-muted); margin:0;">
              Examine daily historical demand patterns and projected future sales curves.
            </p>
          </div>
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <div style="min-width:240px;">
              <select class="input" id="ai-product-selector" style="font-size:13px; height:38px; padding:4px 10px;">
                <option value="">Loading catalogue...</option>
              </select>
            </div>
            <div class="filter-tabs" role="group" aria-label="Forecast timeframe">
              <button type="button" class="filter-tab ${currentDays === 7 ? 'active' : ''}" data-horizon="7">7 Days</button>
              <button type="button" class="filter-tab ${currentDays === 30 ? 'active' : ''}" data-horizon="30">30 Days</button>
              <button type="button" class="filter-tab ${currentDays === 90 ? 'active' : ''}" data-horizon="90">90 Days</button>
            </div>
          </div>
        </div>

        <!-- Chart Content Area -->
        <div id="ai-chart-container">
          <div class="skeleton" style="height:280px; border-radius:12px;"></div>
        </div>

        <!-- Product Metrics Summary Pills -->
        <div id="ai-product-pills" style="margin-top:16px; display:none; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px;"></div>
      </div>

      <!-- Navigation Tabs for Deep-Dive Sections -->
      <div>
        <div class="filter-tabs" id="ai-section-tabs" role="tablist" style="margin-bottom:16px; display:inline-flex; flex-wrap:wrap;">
          <button type="button" class="filter-tab active" data-tab="restock">
            ${icon('truck', 15)} <span>Restocking Recommendations</span>
          </button>
          <button type="button" class="filter-tab" data-tab="stockout">
            ${icon('alertTriangle', 15)} <span>Stockout Risks & Alerts</span>
          </button>
          <button type="button" class="filter-tab" data-tab="high-demand">
            ${icon('trendingUp', 15)} <span>High-Demand & Slow-Moving</span>
          </button>
          <button type="button" class="filter-tab" data-tab="all-forecasts">
            ${icon('layers', 15)} <span>All Product Forecasts</span>
          </button>
          <button type="button" class="filter-tab" data-tab="categories">
            ${icon('analytics', 15)} <span>Monthly Category Demand</span>
          </button>
        </div>

        <!-- Tab Content Panels -->
        <div id="ai-tab-panel" class="card" style="padding:22px;">
          <div class="skeleton" style="height:220px; border-radius:8px;"></div>
        </div>
      </div>
    </div>
  `;

  let destroyed = false;
  let cachedInsights = null;

  function cleanup() {
    destroyed = true;
    destroyAllCharts();
  }

  // Bind top action buttons
  container.querySelector('#btn-refresh-ai')?.addEventListener('click', () => loadAll(true));
  container.querySelector('#btn-trigger-ai-alerts')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `${icon('refresh', 15)} <span>Evaluating...</span>`;
    try {
      const res = await api.triggerAiAlerts();
      showToast(res.message || 'Stock alerts re-evaluated.', 'success');
      await loadAll(false);
    } catch (err) {
      showToast(err.message || 'Failed to trigger alerts.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('sparkles', 15)} <span>Scan Stock & Evaluate Alerts</span>`;
    }
  });

  // Bind horizon buttons
  container.querySelectorAll('[data-horizon]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-horizon]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentDays = Number(btn.dataset.horizon);
      if (selectedProductId) {
        renderProductForecast(selectedProductId);
      }
    });
  });

  // Bind section tabs
  container.querySelectorAll('#ai-section-tabs [data-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      container.querySelectorAll('#ai-section-tabs [data-tab]').forEach((b) => b.classList.remove('active'));
      tabBtn.classList.add('active');
      activeTab = tabBtn.dataset.tab;
      renderTabContent();
    });
  });

  // Load complete insights from backend
  async function loadAll(showToastAlert = false) {
    if (destroyed) return;
    try {
      const insights = await api.getAiInsights();
      if (destroyed) return;
      cachedInsights = insights;

      renderKpis(insights.kpis);
      populateProductSelector(insights.allForecasts);
      renderTabContent();

      if (showToastAlert) {
        showToast('AI forecasting models refreshed with latest PostgreSQL data.', 'info');
      }
    } catch (error) {
      if (destroyed) return;
      console.error('Failed to load AI insights:', error);
      container.querySelector('#ai-kpis').innerHTML = `
        <div class="banner banner-danger" style="grid-column: 1 / -1;">
          ${icon('alertCircle', 18)}
          <span><strong>Failed to load AI insights:</strong> ${escapeHtml(error.message)}</span>
        </div>`;
    }
  }

  function renderKpis(kpis) {
    if (!kpis) return;
    const kpisEl = container.querySelector('#ai-kpis');
    if (!kpisEl) return;

    kpisEl.innerHTML = `
      <div class="card" style="display:flex; align-items:center; gap:16px; padding:18px 20px;">
        <div class="kpi-icon" style="background:rgba(8,145,178,0.12); color:#0891b2; width:46px; height:46px; border-radius:12px; display:grid; place-items:center;">
          ${icon('trendingUp', 22)}
        </div>
        <div>
          <div class="subtle" style="font-size:12px; text-transform:uppercase; letter-spacing:0.04em; font-weight:600;">30-Day Projected Demand</div>
          <div class="kpi-value" style="font-size:24px; font-weight:800; margin-top:2px;">
            ${kpis.total30dProjectedDemandUnits.toLocaleString()} <span style="font-size:13px; font-weight:500; color:var(--text-muted);">units</span>
          </div>
          <div style="font-size:12px; color:var(--text-subtle);">Est. Value: ₹${kpis.total30dProjectedDemandValue.toLocaleString()}</div>
        </div>
      </div>

      <div class="card" style="display:flex; align-items:center; gap:16px; padding:18px 20px;">
        <div class="kpi-icon" style="background:rgba(239,68,68,0.12); color:#ef4444; width:46px; height:46px; border-radius:12px; display:grid; place-items:center;">
          ${icon('alertTriangle', 22)}
        </div>
        <div>
          <div class="subtle" style="font-size:12px; text-transform:uppercase; letter-spacing:0.04em; font-weight:600;">Critical Stockout Risks</div>
          <div class="kpi-value" style="font-size:24px; font-weight:800; margin-top:2px; color:#ef4444;">
            ${kpis.criticalStockoutsCount} <span style="font-size:13px; font-weight:500; color:var(--text-muted);">products</span>
          </div>
          <div style="font-size:12px; color:var(--text-subtle);">${kpis.warningStockCount} warning below min level</div>
        </div>
      </div>

      <div class="card" style="display:flex; align-items:center; gap:16px; padding:18px 20px;">
        <div class="kpi-icon" style="background:rgba(34,197,94,0.12); color:#22c55e; width:46px; height:46px; border-radius:12px; display:grid; place-items:center;">
          ${icon('award', 22)}
        </div>
        <div>
          <div class="subtle" style="font-size:12px; text-transform:uppercase; letter-spacing:0.04em; font-weight:600;">High-Demand Items</div>
          <div class="kpi-value" style="font-size:24px; font-weight:800; margin-top:2px;">
            ${cachedInsights?.topHighDemand?.length || 0} <span style="font-size:13px; font-weight:500; color:var(--text-muted);">trending</span>
          </div>
          <div style="font-size:12px; color:var(--text-subtle);">${kpis.sufficientDataCount} total with active models</div>
        </div>
      </div>

      <div class="card" style="display:flex; align-items:center; gap:16px; padding:18px 20px;">
        <div class="kpi-icon" style="background:rgba(245,158,11,0.12); color:#f59e0b; width:46px; height:46px; border-radius:12px; display:grid; place-items:center;">
          ${icon('truck', 22)}
        </div>
        <div>
          <div class="subtle" style="font-size:12px; text-transform:uppercase; letter-spacing:0.04em; font-weight:600;">Reorder Recommendations</div>
          <div class="kpi-value" style="font-size:24px; font-weight:800; margin-top:2px; color:#f59e0b;">
            ${kpis.restockRecommendationsCount} <span style="font-size:13px; font-weight:500; color:var(--text-muted);">items</span>
          </div>
          <div style="font-size:12px; color:var(--text-subtle);">Lead times factored in</div>
        </div>
      </div>
    `;
  }

  function populateProductSelector(allForecasts) {
    const select = container.querySelector('#ai-product-selector');
    if (!select || !allForecasts) return;

    // Sort products: sufficient data first, then alphabetical
    const sorted = [...allForecasts].sort((a, b) => {
      if (a.hasSufficientData && !b.hasSufficientData) return -1;
      if (!a.hasSufficientData && b.hasSufficientData) return 1;
      return a.productName.localeCompare(b.productName);
    });

    select.innerHTML = sorted.map((p) => {
      const suffix = p.hasSufficientData ? `(${p.trendLabel} · ${p.currentStock} in stock)` : `(Insufficient data)`;
      return `<option value="${escapeHtml(p.productId)}">${escapeHtml(p.productName)} — ${escapeHtml(suffix)}</option>`;
    }).join('');

    if (!selectedProductId && sorted.length > 0) {
      selectedProductId = sorted[0].productId;
      select.value = selectedProductId;
    }

    select.onchange = (e) => {
      selectedProductId = e.target.value;
      renderProductForecast(selectedProductId);
    };

    if (selectedProductId) {
      renderProductForecast(selectedProductId);
    }
  }

  async function renderProductForecast(productId) {
    const chartContainer = container.querySelector('#ai-chart-container');
    const pillsContainer = container.querySelector('#ai-product-pills');
    if (!chartContainer) return;

    chartContainer.innerHTML = '<div class="skeleton" style="height:280px; border-radius:12px;"></div>';
    pillsContainer.style.display = 'none';

    try {
      const details = await api.getAiProductForecast(productId);
      if (destroyed) return;

      const { summary, chartData } = details;

      // REQUIREMENT: If historical data is insufficient, clearly display message and do not generate fake predictions
      if (!summary.hasSufficientData || !chartData.hasSufficientData) {
        chartContainer.innerHTML = `
          <div style="padding:48px 24px; text-align:center; background:var(--surface-2); border-radius:12px; border:1px dashed var(--border); margin:10px 0;">
            <div style="margin-bottom:12px; color:var(--text-subtle);">${icon('info', 32)}</div>
            <h3 style="margin:0 0 8px 0; font-size:17px; font-weight:700;">Insufficient data for accurate forecasting.</h3>
            <p style="color:var(--text-muted); max-width:540px; margin:0 auto 16px auto; font-size:13.5px; line-height:1.5;">
              Product <strong>${escapeHtml(summary.productName)}</strong> currently has ${summary.transactionCount} completed sales transaction(s).
              The AI forecasting engine requires at least 2 historical sales transactions to detect sales patterns and predict demand without generating fake predictions.
            </p>
            <div style="display:inline-flex; align-items:center; gap:8px; padding:6px 14px; background:var(--surface); border-radius:20px; font-size:12px; color:var(--text-subtle);">
              <span>Current Stock: <strong>${summary.currentStock} units</strong></span> · 
              <span>Min Level: <strong>${summary.minLevel} units</strong></span> · 
              <span>Status: <strong style="color:${summary.stockStatus === 'CRITICAL' ? '#ef4444' : summary.stockStatus === 'WARNING' ? '#f59e0b' : '#22c55e'}">${summary.stockStatus}</strong></span>
            </div>
          </div>
        `;
        pillsContainer.style.display = 'none';
        return;
      }

      // Sufficient Data -> Render Interactive Chart
      chartContainer.innerHTML = `
        <div class="chart-box" style="height:320px; position:relative;">
          <canvas id="ai-main-chart" role="img" aria-label="AI Demand Forecast"></canvas>
        </div>
      `;

      const canvas = container.querySelector('#ai-main-chart');
      const forecastSeries = currentDays === 7 ? chartData.forecast7d
        : currentDays === 90 ? chartData.forecast90d
        : chartData.forecast30d;

      // Prepare Chart.js labels & datasets
      const histLabels = chartData.historical.map((h) => h.date.slice(5)); // MM-DD
      const forecastLabels = forecastSeries.map((f) => f.date.slice(5));
      const allLabels = [...histLabels, ...forecastLabels];

      // Historical data padded with null for forecast days
      const histPoints = [
        ...chartData.historical.map((h) => h.quantity),
        ...forecastSeries.map(() => null),
      ];

      // Forecast points padded with null for historical days (bridging at the last historical point)
      const lastHistVal = chartData.historical[chartData.historical.length - 1]?.quantity || 0;
      const forecastPoints = [
        ...chartData.historical.slice(0, -1).map(() => null),
        lastHistVal,
        ...forecastSeries.map((f) => f.predicted),
      ];

      const upperBoundPoints = [
        ...chartData.historical.slice(0, -1).map(() => null),
        lastHistVal,
        ...forecastSeries.map((f) => f.upperBound),
      ];

      if (activeChart) {
        activeChart.destroy();
        activeChart = null;
      }

      activeChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: allLabels,
          datasets: [
            {
              label: 'Historical Actual Sales',
              data: histPoints,
              borderColor: '#0891b2',
              backgroundColor: 'rgba(8, 145, 178, 0.12)',
              fill: true,
              borderWidth: 2.2,
              pointRadius: 2.5,
              tension: 0.3,
            },
            {
              label: `AI Projected Demand (${currentDays}d)`,
              data: forecastPoints,
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34, 197, 94, 0.12)',
              fill: false,
              borderWidth: 2.2,
              borderDash: [5, 4],
              pointRadius: 2,
              tension: 0.35,
            },
            {
              label: 'Upper Confidence Limit (+25%)',
              data: upperBoundPoints,
              borderColor: 'rgba(148, 163, 184, 0.4)',
              borderWidth: 1,
              borderDash: [2, 2],
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { boxWidth: 10, padding: 14, font: { size: 12 } },
            },
            tooltip: {
              padding: 10,
              cornerRadius: 6,
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 12, font: { size: 11 } },
            },
            y: {
              beginAtZero: true,
              ticks: { maxTicksLimit: 6, font: { size: 11 } },
            },
          },
        },
      });

      // Render product metric pills below chart
      pillsContainer.style.display = 'grid';
      pillsContainer.innerHTML = `
        <div class="card" style="padding:12px 14px; background:var(--surface-2);">
          <div style="font-size:11.5px; color:var(--text-muted);">Sales Velocity</div>
          <div style="font-size:16px; font-weight:700; color:var(--text); margin-top:2px;">
            ${summary.averageDailySales} <span style="font-size:11px; font-weight:400; color:var(--text-subtle);">units/day</span>
          </div>
        </div>

        <div class="card" style="padding:12px 14px; background:var(--surface-2);">
          <div style="font-size:11.5px; color:var(--text-muted);">Demand Trend</div>
          <div style="font-size:15px; font-weight:700; margin-top:2px; color:${summary.trend === 'increasing' ? '#22c55e' : summary.trend === 'decreasing' ? '#ef4444' : 'var(--text)'};">
            ${summary.trend === 'increasing' ? '↗ Increasing' : summary.trend === 'decreasing' ? '↘ Decreasing' : '→ Steady'}
            <span style="font-size:11px; font-weight:500;">(${summary.trendPercentage > 0 ? '+' : ''}${summary.trendPercentage}%)</span>
          </div>
        </div>

        <div class="card" style="padding:12px 14px; background:var(--surface-2);">
          <div style="font-size:11.5px; color:var(--text-muted);">${currentDays}-Day Expected Demand</div>
          <div style="font-size:16px; font-weight:700; color:var(--text); margin-top:2px;">
            ${currentDays === 7 ? summary.forecast7d : currentDays === 90 ? summary.forecast90d : summary.forecast30d} <span style="font-size:11px; font-weight:400; color:var(--text-subtle);">units</span>
          </div>
        </div>

        <div class="card" style="padding:12px 14px; background:var(--surface-2);">
          <div style="font-size:11.5px; color:var(--text-muted);">Days Remaining</div>
          <div style="font-size:16px; font-weight:700; margin-top:2px; color:${summary.daysRemaining <= 3 ? '#ef4444' : summary.daysRemaining <= 7 ? '#f59e0b' : '#22c55e'};">
            ${summary.daysRemaining === 0 ? '0 (Out of stock)' : `${summary.daysRemaining} days`}
          </div>
        </div>

        <div class="card" style="padding:12px 14px; background:var(--surface-2);">
          <div style="font-size:11.5px; color:var(--text-muted);">Estimated Stockout</div>
          <div style="font-size:14px; font-weight:700; color:var(--text); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(summary.estimatedStockoutDate)}
          </div>
        </div>
      `;
    } catch (err) {
      if (destroyed) return;
      chartContainer.innerHTML = `
        <div class="banner banner-danger">${icon('alertCircle', 16)} <span>Failed to fetch forecast: ${escapeHtml(err.message)}</span></div>`;
    }
  }

  function renderTabContent() {
    const panel = container.querySelector('#ai-tab-panel');
    if (!panel || !cachedInsights) return;

    if (activeTab === 'restock') {
      renderRestockingTab(panel, cachedInsights.restockingRecommendations);
    } else if (activeTab === 'stockout') {
      renderStockoutTab(panel, cachedInsights.atRiskOfStockout);
    } else if (activeTab === 'high-demand') {
      renderDemandGroupsTab(panel, cachedInsights.topHighDemand, cachedInsights.slowMoving);
    } else if (activeTab === 'all-forecasts') {
      renderAllForecastsTab(panel, cachedInsights.allForecasts);
    } else if (activeTab === 'categories') {
      renderCategoryForecastTab(panel, cachedInsights.monthlyDemandPredictions);
    }
  }

  // TAB 1: Restocking Recommendations
  function renderRestockingTab(panel, recommendations) {
    if (!recommendations || recommendations.length === 0) {
      panel.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:var(--text-muted);">
          ${icon('checkCircle', 28, 'text-success')}
          <h3 style="margin:10px 0 4px 0;">All Products Sufficiently Stocked</h3>
          <p style="margin:0; font-size:13px;">No immediate reorders required based on current sales velocity and lead times.</p>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin:0 0 4px 0; font-size:16px;">AI Restocking Recommendations (${recommendations.length})</h3>
          <p style="margin:0; font-size:12.5px; color:var(--text-muted);">
            Recommended reorder quantities and suggested order dates calculated from sales velocity, lead time, and safety stock.
          </p>
        </div>
        <div style="font-size:12.5px; color:var(--text-subtle);">
          Total estimated reorder investment: <strong>₹${recommendations.reduce((sum, r) => sum + r.estimatedCost, 0).toLocaleString()}</strong>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Current Stock</th>
              <th>Daily Sales</th>
              <th>Days Left</th>
              <th>Status</th>
              <th>Recommended Reorder</th>
              <th>Suggested Date</th>
              <th>Est. Cost</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${recommendations.map((r) => `
              <tr>
                <td>
                  <strong>${escapeHtml(r.name)}</strong>
                  <div style="font-size:11px; color:var(--text-subtle);">${escapeHtml(r.sku)}</div>
                </td>
                <td>${escapeHtml(r.category)}</td>
                <td><strong>${r.currentStock}</strong></td>
                <td>${r.dailySales} /day</td>
                <td>
                  <span style="font-weight:700; color:${r.daysRemaining <= 3 ? '#ef4444' : r.daysRemaining <= 7 ? '#f59e0b' : 'inherit'}">
                    ${r.daysRemaining === 0 ? 'Out of stock' : `${r.daysRemaining} days`}
                  </span>
                </td>
                <td>
                  <span class="badge ${r.stockStatus === 'CRITICAL' ? 'badge-danger' : 'badge-warning'}">
                    ${r.stockStatus}
                  </span>
                </td>
                <td><strong style="color:var(--accent-text);">${r.recommendedReorderQty} units</strong></td>
                <td><span style="font-weight:600;">${escapeHtml(r.suggestedReorderDate)}</span></td>
                <td>₹${r.estimatedCost.toLocaleString()}</td>
                <td style="text-align:right;">
                  <a href="#/purchase" class="btn btn-outline btn-sm" style="padding:3px 10px; font-size:12px;">
                    ${icon('purchase', 13)} <span>Create PO</span>
                  </a>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // TAB 2: Stockout Risks & Alerts
  function renderStockoutTab(panel, atRisk) {
    if (!atRisk || atRisk.length === 0) {
      panel.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:var(--text-muted);">
          ${icon('checkCircle', 28, 'text-success')}
          <h3 style="margin:10px 0 4px 0;">No Products At Risk</h3>
          <p style="margin:0; font-size:13px;">All products currently exceed minimum stock thresholds.</p>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div style="margin-bottom:16px;">
        <h3 style="margin:0 0 4px 0; font-size:16px;">Products at Risk of Stockout (${atRisk.length})</h3>
        <p style="margin:0; font-size:12.5px; color:var(--text-muted);">
          Items that have reached zero stock or are projected to exhaust their inventory within the next 7 days.
        </p>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Current Stock</th>
              <th>Min Level</th>
              <th>Daily Velocity</th>
              <th>Days Remaining</th>
              <th>Stockout Date</th>
              <th>Status</th>
              <th>Model State</th>
            </tr>
          </thead>
          <tbody>
            ${atRisk.map((p) => `
              <tr style="${p.stockStatus === 'CRITICAL' ? 'background:rgba(239,68,68,0.04);' : ''}">
                <td>
                  <strong>${escapeHtml(p.name)}</strong>
                  <div style="font-size:11px; color:var(--text-subtle);">${escapeHtml(p.sku)} · ${escapeHtml(p.category)}</div>
                </td>
                <td><strong style="color:${p.currentStock === 0 ? '#ef4444' : 'inherit'};">${p.currentStock}</strong></td>
                <td>${p.minLevel}</td>
                <td>${p.dailySales} /day</td>
                <td>
                  <strong style="color:${p.daysRemaining <= 3 ? '#ef4444' : '#f59e0b'};">
                    ${p.daysRemaining === 0 ? '0 (Out of stock)' : `${p.daysRemaining} days`}
                  </strong>
                </td>
                <td>${escapeHtml(p.estimatedStockoutDate)}</td>
                <td>
                  <span class="badge ${p.stockStatus === 'CRITICAL' ? 'badge-danger' : 'badge-warning'}">
                    ${p.stockStatus}
                  </span>
                </td>
                <td>
                  <span style="font-size:12px; color:var(--text-muted);">
                    ${p.hasSufficientData ? 'Active Forecast' : 'Stock Threshold Alert'}
                  </span>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // TAB 3: High-Demand & Slow-Moving Products
  function renderDemandGroupsTab(panel, highDemand, slowMoving) {
    panel.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:24px;">
        <!-- High-Demand -->
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <div style="color:#22c55e;">${icon('trendingUp', 20)}</div>
            <h3 style="margin:0; font-size:16px;">Top 5 High-Demand Products</h3>
          </div>
          <p style="margin:0 0 14px 0; font-size:12.5px; color:var(--text-muted);">
            Products moving with the highest sales frequency and strongest forward momentum.
          </p>
          <div class="table-wrap">
            <table class="data-table" style="font-size:13px;">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Daily Sales</th>
                  <th>30d Forecast</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                ${(highDemand || []).length === 0
                  ? '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No high-demand items detected yet.</td></tr>'
                  : highDemand.map((p) => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(p.name)}</strong>
                        <div style="font-size:11px; color:var(--text-subtle);">${escapeHtml(p.category)}</div>
                      </td>
                      <td><strong>${p.dailySales}</strong>/day</td>
                      <td>${p.forecast30d} units</td>
                      <td>
                        <span class="badge ${p.trend === 'increasing' ? 'badge-success' : 'badge-accent'}">
                          ${p.trend === 'increasing' ? '↗ High Surge' : '→ Steady'}
                        </span>
                      </td>
                    </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Slow-Moving -->
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <div style="color:#f59e0b;">${icon('clock', 20)}</div>
            <h3 style="margin:0; font-size:16px;">Slow-Moving Products</h3>
          </div>
          <p style="margin:0 0 14px 0; font-size:12.5px; color:var(--text-muted);">
            Items with significant inventory tied up relative to their current sales velocity.
          </p>
          <div class="table-wrap">
            <table class="data-table" style="font-size:13px;">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Current Stock</th>
                  <th>Daily Sales</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${(slowMoving || []).length === 0
                  ? '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No slow-moving items found.</td></tr>'
                  : slowMoving.map((p) => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(p.name)}</strong>
                        <div style="font-size:11px; color:var(--text-subtle);">${escapeHtml(p.category)}</div>
                      </td>
                      <td><strong>${p.currentStock}</strong> units</td>
                      <td>${p.dailySales} /day</td>
                      <td><span class="badge badge-warning">Low Turnover</span></td>
                    </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // TAB 4: All Product Forecasts
  function renderAllForecastsTab(panel, allForecasts) {
    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
        <div>
          <h3 style="margin:0 0 4px 0; font-size:16px;">All Product Demand Forecasts (${allForecasts.length})</h3>
          <p style="margin:0; font-size:12.5px; color:var(--text-muted);">
            7, 30, and 90-day demand estimates calculated from historical sales transactions.
          </p>
        </div>
        <div>
          <input type="text" id="ai-catalog-filter" class="input" placeholder="Filter by product or category..." style="width:240px; height:34px; font-size:12.5px;">
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table" id="ai-all-forecasts-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Current Stock</th>
              <th>Avg Daily Sales</th>
              <th>Trend</th>
              <th>7d Demand</th>
              <th>30d Demand</th>
              <th>90d Demand</th>
              <th>Stock Status</th>
            </tr>
          </thead>
          <tbody>
            ${allForecasts.map((p) => `
              <tr data-name="${escapeHtml(p.productName.toLowerCase())}" data-category="${escapeHtml(p.category.toLowerCase())}">
                <td>
                  <strong>${escapeHtml(p.productName)}</strong>
                  <div style="font-size:11px; color:var(--text-subtle);">${escapeHtml(p.sku)}</div>
                </td>
                <td>${escapeHtml(p.category)}</td>
                <td><strong>${p.currentStock}</strong></td>
                <td>${p.hasSufficientData ? `${p.averageDailySales} /day` : '<span style="color:var(--text-subtle);">—</span>'}</td>
                <td>
                  ${p.hasSufficientData
                    ? `<span style="font-weight:600; color:${p.trend === 'increasing' ? '#22c55e' : p.trend === 'decreasing' ? '#ef4444' : 'inherit'}">${escapeHtml(p.trendLabel)}</span>`
                    : '<span style="color:var(--text-subtle); font-size:12px;">Insufficient Data</span>'}
                </td>
                <td><strong>${p.hasSufficientData ? `${p.forecast7d} u` : '—'}</strong></td>
                <td><strong>${p.hasSufficientData ? `${p.forecast30d} u` : '—'}</strong></td>
                <td><strong>${p.hasSufficientData ? `${p.forecast90d} u` : '—'}</strong></td>
                <td>
                  <span class="badge ${p.stockStatus === 'CRITICAL' ? 'badge-danger' : p.stockStatus === 'WARNING' ? 'badge-warning' : 'badge-success'}">
                    ${p.stockStatus}
                  </span>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Filter functionality
    const filterInput = panel.querySelector('#ai-catalog-filter');
    filterInput?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      panel.querySelectorAll('#ai-all-forecasts-table tbody tr').forEach((row) => {
        const name = row.dataset.name || '';
        const cat = row.dataset.category || '';
        const match = !q || name.includes(q) || cat.includes(q);
        row.style.display = match ? '' : 'none';
      });
    });
  }

  // TAB 5: Monthly Category Demand
  function renderCategoryForecastTab(panel, categoryPredictions) {
    panel.innerHTML = `
      <div style="margin-bottom:16px;">
        <h3 style="margin:0 0 4px 0; font-size:16px;">Monthly Demand Forecast by Category</h3>
        <p style="margin:0; font-size:12.5px; color:var(--text-muted);">
          Aggregated demand expectations across merchandise categories for next 30 and 90 days.
        </p>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:24px; align-items:flex-start;">
        <div class="chart-box" style="height:280px; position:relative;">
          <canvas id="ai-category-chart" role="img" aria-label="Category Demand"></canvas>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Products Active</th>
                <th>Current Stock</th>
                <th>30d Expected Demand</th>
                <th>90d Expected Demand</th>
              </tr>
            </thead>
            <tbody>
              ${(categoryPredictions || []).length === 0
                ? '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No category demand data available.</td></tr>'
                : categoryPredictions.map((c) => `
                  <tr>
                    <td><strong>${escapeHtml(c.category)}</strong></td>
                    <td>${c.productsCount} items</td>
                    <td>${c.currentStock}</td>
                    <td><strong style="color:#0891b2;">${c.forecast30d} units</strong></td>
                    <td><strong>${c.forecast90d} units</strong></td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const catCanvas = panel.querySelector('#ai-category-chart');
    if (catCanvas && categoryPredictions && categoryPredictions.length > 0) {
      if (activeCategoryChart) {
        activeCategoryChart.destroy();
        activeCategoryChart = null;
      }
      activeCategoryChart = new Chart(catCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: categoryPredictions.map((c) => c.category),
          datasets: [
            {
              label: '30-Day Demand',
              data: categoryPredictions.map((c) => c.forecast30d),
              backgroundColor: '#0891b2',
              borderRadius: 6,
            },
            {
              label: 'Current In-Stock',
              data: categoryPredictions.map((c) => c.currentStock),
              backgroundColor: '#94a3b8',
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } },
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true },
          },
        },
      });
    }
  }

  function getRoleDescription(r) {
    const map = {
      owner: 'Owner — Full Access to all Forecasts & Insights',
      product: 'Product Manager — Demand Predictions & Catalogue Trends',
      stock: 'Stock Manager — Stock Alerts & Restocking Signals',
      purchase: 'Purchase Manager — Reorder Recommendations & Lead Times',
      sales: 'Sales Manager — Sales Trends & Demand Momentum',
      orders: 'Order Manager — Stockout Risks Affecting Fulfilment',
    };
    return map[r] || 'Full AI Access';
  }

  // Initial load
  loadAll(false);

  return cleanup;
}
