import { UI } from './ui.js';
import { fetchHealth, fetchHotWeapons, fetchWeapons, fetchTrend } from './api.js';
import { ChartManager } from './chart-manager.js';

class App {
  constructor() {
    this.state = {
      currentWeapon: null,
      chartMode: 'price',
      displayMode: 'aggregated',
      lastTrendData: null,
      weaponsCache: null,
      searchTimeout: null,
      isDark: this.initTheme()
    };
    this.chartManager = new ChartManager('trendChart');
    this.init();
  }

  async init() {
    this.bindEvents();
    this.updateDisplayModeUI();
    this.renderRecent();
    UI.updateRangeHint(UI.elements.rangeSelect.value);

    // 解析 URL 参数中的 weapon 参数
    this.checkUrlParams();

    // 异步加载初始化数据
    this.loadHealth();
    this.loadHotWeapons();
    this.preloadWeapons();
  }

  bindEvents() {
    // 搜索
    UI.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
    UI.elements.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        UI.elements.searchInput.value = '';
        UI.elements.searchResults.classList.add('hidden');
      }
    });

    // 图表模式切换
    UI.elements.modePriceBtn.onclick = () => this.switchChartMode('price');
    UI.elements.modeSellersBtn.onclick = () => this.switchChartMode('sellers');
    UI.elements.displayModeRawBtn.onclick = () => this.switchDisplayMode('raw');
    UI.elements.displayModeAggregatedBtn.onclick = () => this.switchDisplayMode('aggregated');
    UI.elements.resetZoomBtn.onclick = () => this.chartManager.resetZoom(UI.elements.rangeSelect.value, this.state.displayMode);
    UI.elements.rangeSelect.onchange = () => {
      UI.updateRangeHint(UI.elements.rangeSelect.value);
      this.loadTrend();
    };
    UI.elements.themeToggle.onclick = () => this.toggleTheme();

    // 全局函数挂载（用于 HTML 中 onclick）
    window.toggleSection = (id, chevronId) => {
      const el = document.getElementById(id);
      const chevron = document.getElementById(chevronId);
      const isHidden = el.classList.toggle('hidden');
      chevron.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
    };
    
    window.showHotWeaponsModal = () => this.showHotWeaponsModal();
    window.closeHotWeaponsModal = (e) => this.closeHotWeaponsModal(e);
    UI.elements.copyNameBtn.onclick = () => this.copyWeaponName();
    
    // 语言切换函数
    window.switchLanguage = (lang) => {
      const pathMatch = window.location.pathname.match(/\/weapon\/([^\/]+)\/?$/);
      if (pathMatch && pathMatch[1]) {
        // 在武器详情页，切换时保留武器 slug
        const weaponSlug = pathMatch[1];
        if (lang === 'en') {
          window.location.href = `/apps/RivenTracker/en/weapon/${weaponSlug}/`;
        } else {
          window.location.href = `/apps/RivenTracker/weapon/${weaponSlug}/`;
        }
      } else {
        // 在首页，直接切换
        if (lang === 'en') {
          window.location.href = '/apps/RivenTracker/en/';
        } else {
          window.location.href = '/apps/RivenTracker/';
        }
      }
    };
    
    // 监听浏览器前进/后退按钮
    window.addEventListener('popstate', (e) => {
      const pathMatch = window.location.pathname.match(/\/weapon\/([^\/]+)\/?$/);
      if (pathMatch && pathMatch[1]) {
        this.selectWeaponBySlug(pathMatch[1]);
      } else {
        // 返回首页，清空当前武器
        this.state.currentWeapon = null;
        UI.resetWeaponDisplay();
      }
    });
  }

  initTheme() {
    const saved = localStorage.getItem('riven_tracker_theme');
    const isDark = saved ? saved === 'dark' : document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', isDark);
    return isDark;
  }

  toggleTheme() {
    this.state.isDark = !this.state.isDark;
    document.documentElement.classList.toggle('dark', this.state.isDark);
    localStorage.setItem('riven_tracker_theme', this.state.isDark ? 'dark' : 'light');
    
    if (this.state.lastTrendData) {
      this.chartManager.render(this.state.lastTrendData, this.state.chartMode, this.state.displayMode, this.state.isDark);
    }
  }

  async loadHealth() {
    try {
      const data = await fetchHealth();
      UI.updateHealth(data);
    } catch (e) {}
  }

  async loadHotWeapons() {
    try {
      const { data } = await fetchHotWeapons(15, 'price');
      this.state.hotWeaponsData = (data || []).filter(w => !w.slug.toLowerCase().includes('dex-nikana')).slice(0, 10);
      UI.renderHotWeapons(this.state.hotWeaponsData, this.state.currentWeapon, (w) => this.selectWeapon(w));
    } catch (e) {
      UI.elements.hotList.innerHTML = '<div class="text-xs text-rose-400 italic">榜单加载失败</div>';
    }
  }

  async preloadWeapons() {
    try {
      const { data } = await fetchWeapons('', 1000);
      this.state.weaponsCache = data;
    } catch (e) {}
  }

  handleSearch(q) {
    q = q.trim().toLowerCase();
    clearTimeout(this.state.searchTimeout);
    if (q.length < 1) {
      UI.elements.searchResults.classList.add('hidden');
      return;
    }

    if (this.state.weaponsCache) {
      const filtered = this.state.weaponsCache.filter(w => 
        w.slug.toLowerCase().includes(q) || 
        w.name_en.toLowerCase().includes(q) || 
        (w.name_zh && w.name_zh.toLowerCase().includes(q))
      ).slice(0, 15);
      UI.renderSearchResults(filtered, (w) => this.selectWeapon(w));
      return;
    }

    this.state.searchTimeout = setTimeout(async () => {
      UI.elements.searchLoader.classList.remove('hidden');
      try {
        const { data } = await fetchWeapons(q);
        UI.renderSearchResults(data, (w) => this.selectWeapon(w));
      } finally {
        UI.elements.searchLoader.classList.add('hidden');
      }
    }, 300);
  }

  selectWeapon(weapon) {
    this.state.currentWeapon = weapon;
    this.state.displayMode = 'aggregated';
    this.updateDisplayModeUI();
    
    UI.elements.searchResults.classList.add('hidden');
    UI.elements.searchInput.value = '';
    UI.updateWeaponHeader(weapon);
    
    // 更新 URL 为路径格式（SEO友好）
    this.updateUrlAndMeta(weapon);
    
    this.saveRecent(weapon);
    this.renderRecent();
    UI.renderHotWeapons(this.state.hotWeaponsData, weapon, (w) => this.selectWeapon(w));
    this.loadTrend();
  }

  // 更新 URL 和页面 Meta 信息（用于SEO）
  updateUrlAndMeta(weapon) {
    // 根据当前语言选择路径前缀
    const isEnglish = document.documentElement.lang === 'en';
    const basePath = isEnglish ? '/apps/RivenTracker/en' : '/apps/RivenTracker';
    const newPath = `${basePath}/weapon/${weapon.slug}/`;
    
    // 使用 history.pushState 更新 URL（不刷新页面）
    if (window.location.pathname !== newPath) {
      window.history.pushState({ weapon: weapon.slug }, '', newPath);
    }
    
    // 更新页面标题
    const weaponName = weapon.name || weapon.slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    if (isEnglish) {
      document.title = `${weaponName} Riven Price - Warframe Riven Tracker | WebUtilityKit`;
      
      // 更新 meta description
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        metaDesc.content = `Check ${weaponName} riven mod price history and current market value. Track bottom prices and market trends for ${weaponName} rivens in Warframe.`;
      }
    } else {
      document.title = `${weaponName}紫卡价格 - Warframe紫卡查询 | WebUtilityKit`;
      
      // 更新 meta description
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        metaDesc.content = `查询${weaponName}紫卡价格历史和市场走势。追踪${weaponName}紫卡底价变化，获取Warframe Market实时数据。`;
      }
    }
    
    // 更新 canonical link
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.href = `https://lab.webutilitykit.com${newPath}`;
    }
  }

  async loadTrend() {
    if (!this.state.currentWeapon) return;
    UI.elements.chartLoading.classList.remove('hidden');
    UI.elements.chartEmpty.classList.add('hidden');
    try {
      const range = UI.elements.rangeSelect.value;
      const data = await fetchTrend(this.state.currentWeapon.slug, range, this.state.displayMode);
      this.state.lastTrendData = data;
      this.chartManager.render(data, this.state.chartMode, this.state.displayMode, this.state.isDark);
      UI.updateStats(data);
      UI.renderTable(data.data);
    } catch (e) {
      console.error(e);
    } finally {
      UI.elements.chartLoading.classList.add('hidden');
    }
  }

  switchChartMode(mode) {
    if (this.state.chartMode === mode) return;
    this.state.chartMode = mode;
    this.updateModeUI();
    if (this.state.lastTrendData) {
      this.chartManager.render(this.state.lastTrendData, mode, this.state.displayMode, this.state.isDark);
    }
  }

  switchDisplayMode(mode) {
    if (this.state.displayMode === mode) return;
    this.state.displayMode = mode;
    this.updateDisplayModeUI();
    if (this.state.currentWeapon) this.loadTrend();
  }

  updateModeUI() {
    const activeClass = 'bg-white dark:bg-slate-900 shadow-sm text-violet-500';
    const inactiveClass = 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300';
    UI.elements.modePriceBtn.className = `px-2.5 py-1 rounded-md text-[9px] font-bold transition-all ${this.state.chartMode === 'price' ? activeClass : inactiveClass}`;
    UI.elements.modeSellersBtn.className = `px-2.5 py-1 rounded-md text-[9px] font-bold transition-all ${this.state.chartMode === 'sellers' ? activeClass : inactiveClass}`;
  }

  updateDisplayModeUI() {
    const activeClass = 'bg-white dark:bg-slate-900 shadow-sm text-violet-500';
    const inactiveClass = 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300';
    UI.elements.displayModeRawBtn.className = `px-2 py-1 rounded-md text-[9px] font-bold transition-all ${this.state.displayMode === 'raw' ? activeClass : inactiveClass}`;
    UI.elements.displayModeAggregatedBtn.className = `px-2 py-1 rounded-md text-[9px] font-bold transition-all ${this.state.displayMode === 'aggregated' ? activeClass : inactiveClass}`;
    
    // 更新下拉框选项
    const options = UI.elements.rangeSelect.querySelectorAll('option');
    options.forEach(opt => {
      const mode = opt.getAttribute('data-mode');
      if (this.state.displayMode === 'raw') {
        opt.style.display = mode === 'aggregated' ? 'none' : 'block';
      } else {
        opt.style.display = mode === 'aggregated' ? 'block' : 'none';
      }
    });
    UI.elements.rangeSelect.value = this.state.displayMode === 'aggregated' ? '1h' : '24h';
  }

  saveRecent(weapon) {
    let recent = this.getRecent();
    recent = [weapon, ...recent.filter(w => w.slug !== weapon.slug)].slice(0, 5);
    localStorage.setItem('riven_tracker_recent_v1', JSON.stringify(recent));
  }

  getRecent() {
    try { return JSON.parse(localStorage.getItem('riven_tracker_recent_v1') || '[]'); } catch (e) { return []; }
  }

  renderRecent() {
    UI.renderRecent(this.getRecent(), this.state.currentWeapon, (w) => this.selectWeapon(w));
  }

  copyWeaponName() {
    if (!this.state.currentWeapon) return;
    navigator.clipboard.writeText(this.state.currentWeapon.name_en).then(() => {
      const btn = UI.elements.copyNameBtn;
      const original = btn.innerHTML;
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => btn.innerHTML = original, 2000);
    });
  }

  async showHotWeaponsModal() {
    UI.elements.hotWeaponsModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    const loadingHtml = `<div class="col-span-full flex items-center justify-center py-12"><div class="loading-spinner scale-150"></div></div>`;
    UI.elements.hotWeaponsModalContent.innerHTML = loadingHtml;
    
    try {
      const { data } = await fetchHotWeapons(50, 'price');
      UI.elements.hotWeaponsModalContent.innerHTML = data.map((w, index) => {
        const displayName = UI.lang === 'en' ? w.name_en : (w.name_zh || w.name_en);
        const rankClass = index === 0 ? 'from-amber-500 to-yellow-500' : index === 1 ? 'from-slate-400 to-slate-500' : index === 2 ? 'from-orange-600 to-amber-700' : 'from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800';
        const weaponData = JSON.stringify(w).replace(/'/g, "&apos;");
        return `
          <div data-weapon='${weaponData}' class="modal-item group flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all border border-transparent hover:border-violet-200 dark:hover:border-violet-500/20">
            <div class="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${rankClass} flex items-center justify-center font-black text-sm text-white shadow-sm">${index + 1}</div>
            <div class="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 p-1.5 flex-shrink-0"><img src="${UI.getThumbUrl(w.thumb)}" class="w-full h-full object-contain" /></div>
            <div class="flex-grow min-w-0"><div class="text-sm font-bold truncate">${displayName}</div><div class="text-[10px] text-slate-500 uppercase">${w.group}</div></div>
            <div class="text-right"><div class="text-sm font-mono font-bold text-violet-500">${w.bottom_price || w.min_price} p</div><div class="text-[10px] text-slate-400">${w.active_count} ${UI.t('sellers')}</div></div>
          </div>
        `;
      }).join('');
      
      UI.elements.hotWeaponsModalContent.querySelectorAll('.modal-item').forEach(el => {
        el.onclick = () => {
          this.selectWeapon(JSON.parse(el.dataset.weapon));
          this.closeHotWeaponsModal();
        };
      });
    } catch (e) {
      console.error("[App] showHotWeaponsModal failed:", e);
      const errorMsg = UI.lang === 'en' ? 'Load failed, please try again' : '加载失败，请稍后重试';
      UI.elements.hotWeaponsModalContent.innerHTML = `<div class="col-span-full text-center text-rose-400 py-12">${errorMsg}</div>`;
    }
  }

  closeHotWeaponsModal(e) {
    if (e && e.target !== e.currentTarget) return;
    UI.elements.hotWeaponsModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // 检查 URL 参数，支持 ?weapon=xxx 和 /weapon/xxx/ 两种格式
  async checkUrlParams() {
    // 优先检查路径式 URL: /weapon/xxx/
    const pathMatch = window.location.pathname.match(/\/weapon\/([^\/]+)\/?$/);
    let weaponSlug = null;
    
    if (pathMatch) {
      weaponSlug = pathMatch[1];
    } else {
      // 回退到查询参数: ?weapon=xxx
      const urlParams = new URLSearchParams(window.location.search);
      weaponSlug = urlParams.get('weapon');
    }

    if (weaponSlug) {
      // 等待武器数据加载完成后尝试选择武器
      await this.selectWeaponBySlug(weaponSlug);
    }
  }

  // 根据 weapon slug 选择武器
  async selectWeaponBySlug(slug) {
    // 如果武器缓存还没有加载，等待加载完成
    if (!this.state.weaponsCache) {
      try {
        const { data } = await fetchWeapons('', 1000);
        this.state.weaponsCache = data;
      } catch (e) {
        console.error('Failed to load weapons cache:', e);
        return;
      }
    }

    // 在缓存中查找对应的武器
    const weapon = this.state.weaponsCache.find(w => w.slug === slug);
    if (weapon) {
      this.selectWeapon(weapon);
    } else {
      console.warn(`Weapon with slug "${slug}" not found`);
    }
  }
}

new App();