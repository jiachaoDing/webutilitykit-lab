import { getThumbUrl } from './utils.js';

export const UI = {
  // 确保能准确获取语言，增加回退逻辑
  lang: document.documentElement.lang || 'zh-CN',

  elements: {
    searchInput: document.getElementById('searchInput'),
    searchResults: document.getElementById('searchResults'),
    searchLoader: document.getElementById('searchLoader'),
    chartLoading: document.getElementById('chartLoading'),
    chartEmpty: document.getElementById('chartEmpty'),
    currentWeaponName: document.getElementById('currentWeaponName'),
    weaponSubtext: document.getElementById('weaponSubtext'),
    weaponIcon: document.getElementById('weaponIcon'),
    weaponActions: document.getElementById('weaponActions'),
    copyNameBtn: document.getElementById('copyNameBtn'),
    wfmLink: document.getElementById('wfmLink'),
    rangeSelect: document.getElementById('rangeSelect'),
    trackedCount: document.getElementById('trackedCount'),
    lastUpdate: document.getElementById('lastUpdate'),
    recentContainer: document.getElementById('recentContainer'),
    recentList: document.getElementById('recentList'),
    hotList: document.getElementById('hotList'),
    avgPrice: document.getElementById('avgPrice'),
    priceChange: document.getElementById('priceChange'),
    activeOrders: document.getElementById('activeOrders'),
    modePriceBtn: document.getElementById('modePrice'),
    modeSellersBtn: document.getElementById('modeSellers'),
    displayModeRawBtn: document.getElementById('displayModeRaw'),
    displayModeAggregatedBtn: document.getElementById('displayModeAggregated'),
    resetZoomBtn: document.getElementById('resetZoomBtn'),
    trendTableBody: document.getElementById('trendTableBody'),
    dataTableContainer: document.getElementById('dataTableContainer'),
    hotWeaponsModal: document.getElementById('hotWeaponsModal'),
    hotWeaponsModalContent: document.getElementById('hotWeaponsModalContent'),
    themeToggle: document.getElementById('themeToggle'),
    rangeHint: document.getElementById('rangeHint')
  },

  i18n: {
    en: {
      noData: 'No sampling data available',
      noMatch: 'No matching weapons found',
      insufficient: 'Under 10 sellers',
      never: 'Never',
      sustained: 'Steady',
      sellers: 'sellers',
      weighted: 'Weighted',
      disposition: 'Disp',
      rangeHints: {
        '24h': 'Displays last 24h raw data',
        '1h': 'Displays last 24h aggregated data',
        '4h': 'Displays last 7 days data',
        '1d': 'Displays last 30 days data'
      }
    },
    'zh-CN': {
      noData: '暂无采样数据',
      noMatch: '未找到匹配武器',
      insufficient: '不足10人',
      never: '从未',
      sustained: '持平',
      sellers: '卖家',
      weighted: '加权',
      disposition: '倾向',
      rangeHints: {
        '24h': '显示最近 24 小时原始采样',
        '1h': '显示最近 24 小时聚合数据',
        '4h': '显示最近 7 天聚合数据',
        '1d': '显示最近 30 天聚合数据'
      }
    }
  },

  // 统一翻译方法
  t(key) {
    const dict = this.i18n[this.lang] || this.i18n['zh-CN'];
    return dict[key] || key;
  },

  getThumbUrl(thumb) {
    return getThumbUrl(thumb);
  },

  updateHealth(data) {
    this.elements.trackedCount.textContent = data.tracked_weapon_count;
    this.elements.lastUpdate.textContent = data.last_tick_utc ? luxon.DateTime.fromISO(data.last_tick_utc).toRelative({ locale: this.lang === 'en' ? 'en' : 'zh' }) : this.t('never');
  },

  renderHotWeapons(weapons, currentWeapon, onSelect) {
    if (!weapons || weapons.length === 0) {
      this.elements.hotList.innerHTML = `<div class="text-xs text-slate-400 italic py-2">${this.t('noData')}</div>`;
      return;
    }

    this.elements.hotList.innerHTML = weapons.map((w, index) => {
      const displayName = this.lang === 'en' ? w.name_en : (w.name_zh || w.name_en);
      const isSelected = currentWeapon && currentWeapon.slug === w.slug;
      const weaponData = JSON.stringify(w).replace(/'/g, "&apos;");
      return `
        <div data-weapon='${weaponData}' class="weapon-item group flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700 relative overflow-hidden ${isSelected ? 'weapon-selected' : ''}">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-violet-500 ${isSelected ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 transition-opacity"></div>
          <div class="flex-shrink-0 w-5 h-5 flex items-center justify-center text-[9px] font-black ${isSelected ? 'text-violet-500' : 'text-slate-300'} group-hover:text-violet-500 transition-colors">
            ${index + 1}
          </div>
          <div class="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 flex-shrink-0">
            <img src="${getThumbUrl(w.thumb)}" class="w-full h-full object-contain" />
          </div>
          <div class="flex-grow min-w-0">
            <div class="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">${displayName}</div>
            <div class="flex items-center gap-2">
              <span class="text-[9px] text-violet-500 font-mono font-bold">${w.bottom_price || w.min_price} p</span>
              <span class="text-[9px] text-slate-400 font-mono">${w.active_count} ${this.t('sellers')}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.elements.hotList.querySelectorAll('.weapon-item').forEach(el => {
      el.onclick = () => onSelect(JSON.parse(el.dataset.weapon));
    });
  },

  renderRecent(recent, currentWeapon, onSelect) {
    if (recent.length === 0) {
      this.elements.recentContainer.classList.add('hidden');
      return;
    }
    this.elements.recentContainer.classList.remove('hidden');
    this.elements.recentList.innerHTML = recent.map(w => {
      const displayName = this.lang === 'en' ? w.name_en : (w.name_zh || w.name_en);
      const isSelected = currentWeapon && currentWeapon.slug === w.slug;
      const weaponData = JSON.stringify(w).replace(/'/g, "&apos;");
      return `
        <div data-weapon='${weaponData}' class="recent-item group flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700 ${isSelected ? 'weapon-selected' : ''}">
          <div class="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 flex-shrink-0">
            <img src="${getThumbUrl(w.thumb)}" class="w-full h-full object-contain" />
          </div>
          <div class="flex-grow min-w-0">
            <div class="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">${displayName}</div>
            <div class="text-[9px] text-slate-500 uppercase truncate">${w.group}</div>
          </div>
          <svg class="w-3.5 h-3.5 ${isSelected ? 'text-violet-500 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100'} transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
        </div>
      `;
    }).join('');

    this.elements.recentList.querySelectorAll('.recent-item').forEach(el => {
      el.onclick = () => onSelect(JSON.parse(el.dataset.weapon));
    });
  },

  renderSearchResults(weapons, onSelect) {
    this.elements.searchResults.innerHTML = '';
    if (weapons.length === 0) {
      this.elements.searchResults.innerHTML = `<div class="p-4 text-sm text-slate-500 italic text-center">${this.t('noMatch')}</div>`;
    } else {
      weapons.forEach(w => {
        const displayName = this.lang === 'en' ? w.name_en : (w.name_zh || w.name_en);
        const div = document.createElement('div');
        div.className = 'group p-2 hover:bg-violet-50 dark:hover:bg-violet-500/10 cursor-pointer rounded-xl transition-all flex items-center gap-3 border border-transparent hover:border-violet-200 dark:hover:border-violet-500/20';
        div.innerHTML = `
          <div class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 flex-shrink-0 group-hover:scale-110 transition-transform">
            <img src="${getThumbUrl(w.thumb)}" class="w-full h-full object-contain" />
          </div>
          <div class="flex-grow min-w-0">
            <div class="text-xs font-bold text-slate-900 dark:text-white group-hover:text-violet-500 transition-colors truncate">${displayName}</div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[9px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase font-bold tracking-tight">${w.group}</span>
            </div>
          </div>
        `;
        div.onclick = () => onSelect(w);
        this.elements.searchResults.appendChild(div);
      });
    }
    this.elements.searchResults.classList.remove('hidden');
  },

  updateWeaponHeader(weapon) {
    this.elements.currentWeaponName.textContent = this.lang === 'en' ? weapon.name_en : (weapon.name_zh || weapon.name_en);
    
    // 直接使用原始的 rivenType，仅处理首字母大写
    const rawType = weapon.rivenType || 'Unknown';
    const typeLabel = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
    
    const dict = this.i18n[this.lang] || this.i18n['zh-CN'];
    const dispLabel = dict.disposition || 'Disp';

    this.elements.weaponSubtext.textContent = `${typeLabel} | ${dispLabel}: ${weapon.disposition}`;
    this.elements.weaponIcon.innerHTML = `<img src="${getThumbUrl(weapon.thumb)}" class="w-full h-full object-contain p-1" />`;
    this.elements.weaponIcon.classList.remove('bg-slate-100', 'dark:bg-slate-800');
    this.elements.weaponIcon.classList.add('bg-white', 'dark:bg-slate-900');
    this.elements.copyNameBtn.classList.remove('hidden');
    this.elements.weaponActions.classList.remove('hidden');
    const wfmMarketLang = this.lang === 'en' ? 'en' : 'zh-hans';
    this.elements.wfmLink.href = `https://warframe.market/${wfmMarketLang}/auctions/search?type=riven&sort_by=price_asc&weapon_url_name=${weapon.slug}`;
  },

  updateStats(trendData) {
    if (!trendData.data || trendData.data.length === 0) return;
    const prices = trendData.data.map(d => d.bottom_price);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    this.elements.avgPrice.textContent = `${avg} p`;
    
    const lastPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 2] || lastPrice;
    const diff = lastPrice - prevPrice;
    const percent = ((diff / prevPrice) * 100).toFixed(1);
    
    if (diff > 0) {
      this.elements.priceChange.textContent = `+${diff} (+${percent}%)`;
      this.elements.priceChange.className = 'text-lg font-mono font-bold text-emerald-500';
    } else if (diff < 0) {
      this.elements.priceChange.textContent = `${diff} (${percent}%)`;
      this.elements.priceChange.className = 'text-lg font-mono font-bold text-rose-500';
    } else {
      this.elements.priceChange.textContent = this.t('sustained');
      this.elements.priceChange.className = 'text-lg font-mono font-bold text-slate-400';
    }

    const latestSample = trendData.data[trendData.data.length - 1];
    this.elements.activeOrders.textContent = latestSample.active_count || latestSample.sample_count || '--';
  },

  updateRangeHint(range) {
    if (!this.elements.rangeHint) return;
    const dict = this.i18n[this.lang] || this.i18n['zh-CN'];
    const hint = (dict.rangeHints && dict.rangeHints[range]) || '';
    this.elements.rangeHint.textContent = hint;
  },

  renderTable(data) {
    if (!data || data.length === 0) {
      this.elements.dataTableContainer.classList.add('hidden');
      return;
    }
    this.elements.dataTableContainer.classList.remove('hidden');
    const recentData = [...data].reverse().slice(0, 10);
    this.elements.trendTableBody.innerHTML = recentData.map(d => `
      <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
        <td class="px-4 py-3 font-mono text-[10px]">${luxon.DateTime.fromISO(d.ts).toFormat('MM-dd HH:mm')}</td>
        <td class="px-4 py-3 text-right font-bold text-violet-500">${d.bottom_price || '--'}</td>
        <td class="px-4 py-3 text-right">${d.min_price || '--'}</td>
        <td class="px-4 py-3 text-right">${d.p5_price || '--'}</td>
        <td class="px-4 py-3 text-right font-mono text-slate-500">
          ${(d.active_count !== undefined && d.active_count !== null && d.active_count < 10) ? `<span class="text-[9px] text-slate-400 italic">${this.t('insufficient')}</span>` : (d.p10_price || '--')}
        </td>
      </tr>
    `).join('');
  }
};
