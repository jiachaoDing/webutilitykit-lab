export function getThumbUrl(thumb) {
    if (!thumb) return '';
    return thumb.startsWith('http') ? thumb : `https://warframe.market/static/assets/${thumb}`;
  }
  
  export function aggregateData(data, range) {
    if (!data || data.length === 0) return [];
  
    const intervalMs = {
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    }[range] || (24 * 60 * 60 * 1000);
  
    const grouped = {};
    data.forEach(item => {
      const timestamp = new Date(item.ts).getTime();
      const intervalStart = Math.floor(timestamp / intervalMs) * intervalMs;
      const key = intervalStart;
  
      if (!grouped[key]) {
        grouped[key] = {
          timestamps: [],
          bottom_prices: [],
          min_prices: [],
          active_counts: [],
          sample_counts: []
        };
      }
  
      grouped[key].timestamps.push(timestamp);
      if (item.bottom_price !== null && item.bottom_price !== undefined) grouped[key].bottom_prices.push(item.bottom_price);
      if (item.min_price !== null && item.min_price !== undefined) grouped[key].min_prices.push(item.min_price);
      if (item.active_count !== null && item.active_count !== undefined) grouped[key].active_counts.push(item.active_count);
      if (item.sample_count !== null && item.sample_count !== undefined) grouped[key].sample_counts.push(item.sample_count);
    });
  
    return Object.keys(grouped).map(key => {
      const group = grouped[key];
      const intervalStart = parseInt(key);
      return {
        ts: new Date(intervalStart).toISOString(),
        bottom_price: group.bottom_prices.length > 0 ? Math.round(group.bottom_prices.reduce((a, b) => a + b, 0) / group.bottom_prices.length) : null,
        min_price: group.min_prices.length > 0 ? Math.round(group.min_prices.reduce((a, b) => a + b, 0) / group.min_prices.length) : null,
        active_count: group.active_counts.length > 0 ? Math.round(group.active_counts.reduce((a, b) => a + b, 0) / group.active_counts.length) : null,
        sample_count: group.sample_counts.length > 0 ? Math.round(group.sample_counts.reduce((a, b) => a + b, 0) / group.sample_counts.length) : null,
        aggregated_count: group.timestamps.length
      };
    }).sort((a, b) => new Date(a.ts) - new Date(b.ts));
  }