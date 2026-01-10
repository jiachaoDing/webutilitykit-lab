export async function fetchHealth() {
    const resp = await fetch('/api/RivenTracker/health');
    return await resp.json();
  }
  
  export async function fetchHotWeapons(limit = 15, sortBy = 'price') {
    const resp = await fetch(`/api/RivenTracker/hot-weapons?limit=${limit}&sortBy=${sortBy}`);
    return await resp.json();
  }
  
  export async function fetchWeapons(q = '', limit = 1000) {
    const url = q ? `/api/RivenTracker/weapons?q=${encodeURIComponent(q)}` : `/api/RivenTracker/weapons?limit=${limit}`;
    const resp = await fetch(url);
    return await resp.json();
  }
  
  export async function fetchTrend(slug, range, mode) {
    const resp = await fetch(`/api/RivenTracker/bottom-trend?weapon=${slug}&range=${range}&mode=${mode}`);
    return await resp.json();
  }