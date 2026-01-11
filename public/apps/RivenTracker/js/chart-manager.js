import { aggregateData } from './utils.js';

export class ChartManager {
  constructor(canvasId) {
    this.ctx = document.getElementById(canvasId).getContext('2d');
    this.chart = null;
    this.lang = document.documentElement.lang || 'zh-CN';
  }

  t(key) {
    const i18n = {
      en: {
        weightedBottomPrice: 'Weighted Price (Platinum)',
        absoluteMinPrice: 'Absolute Min Price',
        activeSellers: 'Active Sellers In-Game',
        unitPrice: ' p',
        unitSellers: ' users'
      },
      'zh-CN': {
        weightedBottomPrice: '加权底价 (Platinum)',
        absoluteMinPrice: '绝对最小价',
        activeSellers: '游戏中卖家数',
        unitPrice: ' p',
        unitSellers: ' 人'
      }
    };
    return i18n[this.lang][key] || key;
  }

  render(trendData, chartMode, displayMode, isDark) {
    let data = trendData.data;
    const range = trendData.meta.range;
    const mode = trendData.meta.mode || 'raw';

    if (mode === 'aggregated' && !trendData.meta.aggregated) {
      data = aggregateData(data, range);
    }

    let datasets = [];
    if (chartMode === 'price') {
      datasets = [
        {
          label: this.t('weightedBottomPrice'),
          data: data.map(d => ({ x: luxon.DateTime.fromISO(d.ts).toJSDate(), y: d.bottom_price })),
          borderColor: '#6366f1',
          borderWidth: 3,
          backgroundColor: 'rgba(99, 102, 241, 0.05)',
          fill: true,
          tension: 0.4,
          pointRadius: mode === 'aggregated' ? 4 : 3,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#6366f1',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2
        },
        {
          label: this.t('absoluteMinPrice'),
          data: data.map(d => ({ x: luxon.DateTime.fromISO(d.ts).toJSDate(), y: d.min_price })),
          borderColor: isDark ? 'rgba(148, 163, 184, 0.4)' : 'rgba(148, 163, 184, 0.6)',
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
          tension: 0.4
        }
      ];
    } else {
      datasets = [
        {
          label: this.t('activeSellers'),
          data: data.map(d => ({ x: luxon.DateTime.fromISO(d.ts).toJSDate(), y: d.active_count ?? d.sample_count ?? 0 })),
          borderColor: '#10b981',
          borderWidth: 3,
          backgroundColor: 'rgba(16, 185, 129, 0.05)',
          fill: true,
          tension: 0.4,
          pointRadius: mode === 'aggregated' ? 4 : 3,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#10b981',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2
        }
      ];
    }

    if (this.chart && this.chart.data.datasets.length === datasets.length) {
      this.chart.data.datasets.forEach((ds, i) => {
        ds.data = datasets[i].data;
        ds.label = datasets[i].label;
        ds.borderColor = datasets[i].borderColor;
        ds.backgroundColor = datasets[i].backgroundColor;
        if (ds.pointHoverBackgroundColor) ds.pointHoverBackgroundColor = datasets[i].pointHoverBackgroundColor;
      });

      const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
      const textColor = isDark ? '#94a3b8' : '#64748b';

      this.chart.options.scales.x.ticks.color = textColor;
      this.chart.options.scales.y.ticks.color = textColor;
      this.chart.options.scales.y.grid.color = gridColor;
      
      // 同步更新横坐标单位逻辑
      const newUnit = mode === 'aggregated' 
        ? (range === '1h' ? 'hour' : 'day') 
        : (range === '24h' ? 'hour' : 'day');
      this.chart.options.scales.x.time.unit = newUnit;
      this.chart.options.scales.x.ticks.maxTicksLimit = mode === 'aggregated' ? (range === '1h' ? 12 : 8) : 8;

      this.chart.options.plugins.tooltip.backgroundColor = isDark ? '#1e293b' : '#fff';
      this.chart.options.plugins.tooltip.titleColor = isDark ? '#f1f5f9' : '#0f172a';
      this.chart.options.plugins.tooltip.bodyColor = isDark ? '#94a3b8' : '#64748b';
      this.chart.options.plugins.tooltip.borderColor = isDark ? '#334155' : '#e2e8f0';

      this.chart.update('none');
      this.resetZoom(range, displayMode);
      return;
    }

    if (this.chart) this.chart.destroy();

    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const now = luxon.DateTime.now();

    this.chart = new Chart(this.ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: mode === 'aggregated' 
                ? (range === '1h' ? 'hour' : 'day') 
                : (range === '24h' ? 'hour' : 'day'),
              displayFormats: { 
                hour: 'HH:mm', 
                day: 'MM-dd', 
                week: 'MM-dd',
                month: 'MM-dd'
              }
            },
            grid: { display: false },
            ticks: { 
              color: textColor, 
              font: { size: 10 }, 
              maxRotation: 0, 
              autoSkip: true, 
              maxTicksLimit: mode === 'aggregated' ? (range === '1h' ? 12 : 8) : 8 
            }
          },
          y: {
            beginAtZero: chartMode === 'sellers',
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10, family: 'monospace' }, callback: (value) => chartMode === 'price' ? value : Math.round(value) }
          }
        },
        plugins: {
          legend: { display: false },
          zoom: {
            pan: { enabled: true, mode: 'x', threshold: 10 },
            zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x' },
            limits: { x: { min: 'original', max: 'original' } }
          },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#fff',
            titleColor: isDark ? '#f1f5f9' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (context) => {
                const unit = chartMode === 'price' ? this.t('unitPrice') : this.t('unitSellers');
                return ` ${context.dataset.label.split(' (')[0]}: ${context.parsed.y}${unit}`;
              }
            }
          }
        }
      }
    });

    this.resetZoom(range, displayMode);
  }

  resetZoom(range, displayMode) {
    if (!this.chart) return;
    const now = luxon.DateTime.now();
    let initialMin;
    if (displayMode === 'raw') {
      initialMin = now.minus({ hours: 24 });
    } else {
      const rangeMap = { '1h': { hours: 24 }, '4h': { days: 7 }, '1d': { days: 30 } };
      initialMin = now.minus(rangeMap[range] || { days: 30 });
    }
    this.chart.zoomScale('x', { min: initialMin.toJSDate(), max: now.toJSDate() }, 'easeOutQuart');
  }
}
