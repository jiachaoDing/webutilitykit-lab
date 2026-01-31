# Riven Tracker SEO 实施指南

## 目标
让用户搜索特定武器紫卡价格时（如 "dual toxocyst riven price"），能找到你的网站。

## 已实施的优化

### 1. URL 结构优化

**支持两种 URL 格式：**

| 格式 | 示例 | 用途 |
|------|------|------|
| 查询参数 | `?weapon=dual_toxocyst` | 兼容旧链接 |
| 路径格式（SEO推荐） | `/weapon/dual-toxocyst/` | 搜索引擎友好 |

**实施文件：**
- `functions/apps/RivenTracker/weapon.ts` - Cloudflare Function 处理路由
- `public/apps/RivenTracker/js/app.js` - 前端路由和 Meta 更新

### 2. 动态 Meta 标签

当用户访问 `/weapon/dual-toxocyst/` 时，页面会动态生成：

```html
<title>Dual Toxocyst Riven Price - Warframe Riven Tracker | WebUtilityKit</title>
<meta name="description" content="Check Dual Toxocyst riven mod price history...">
<meta name="keywords" content="Dual Toxocyst riven price, dual_toxocyst riven mod...">
<link rel="canonical" href="https://lab.webutilitykit.com/apps/RivenTracker/en/weapon/dual_toxocyst/">
```

### 3. Sitemap 自动生成

**访问地址：** `https://lab.webutilitykit.com/sitemap-riven.xml`

包含：
- 首页（中英文）
- 所有武器详情页 URL
- 每页的更新时间和优先级

### 4. 前端功能

**选择武器时自动：**
1. 更新 URL 为路径格式（不刷新页面）
2. 更新页面标题和 Meta 描述
3. 更新 Canonical URL
4. 支持浏览器前进/后退按钮

## 部署步骤

### 1. 部署 Cloudflare Functions

```bash
# 安装依赖（如果需要）
npm install

# 部署到 Cloudflare
npx wrangler deploy
```

### 2. 提交 Sitemap 到 Google

1. 访问 [Google Search Console](https://search.google.com/search-console)
2. 添加你的网站属性（`lab.webutilitykit.com`）
3. 进入 "Sitemaps" 菜单
4. 提交：`sitemap-riven.xml`

### 3. 验证索引状态

在 Google Search Console 中使用 "URL Inspection" 工具检查：
- `https://lab.webutilitykit.com/apps/RivenTracker/en/weapon/dual_toxocyst/`
- 确认页面被正确抓取和索引

## 获取武器列表的 API

如果你需要从 D1 数据库获取武器列表生成 Sitemap，可以使用以下 SQL：

```sql
SELECT DISTINCT weapon_slug, MAX(updated_at) as last_update
FROM riven_prices 
GROUP BY weapon_slug;
```

## 推荐的武器关键词

针对以下热门武器优化 SEO：

| 武器 | 关键词示例 |
|------|-----------|
| Kuva Bramma | "kuva bramma riven price", "bramma riven market" |
| Rubico Prime | "rubico prime riven price", "rubico riven mod" |
| Nikana Prime | "nikana prime riven", "nikana riven price" |
| Kuva Zarr | "kuva zarr riven price", "zarr riven market" |
| Redeemer Prime | "redeemer prime riven", "redeemer riven price" |

## 进阶优化建议

### 1. 预渲染/SSR
对于更好的SEO，可以考虑：
- 使用 Cloudflare Workers 进行服务端渲染
- 或者生成静态页面部署到 Pages

### 2. 富媒体搜索结果
添加结构化数据获取富媒体展示：
```json
{
  "@type": "Product",
  "name": "Dual Toxocyst Riven Mod",
  "offers": {
    "@type": "AggregateOffer",
    "lowPrice": "100",
    "highPrice": "5000",
    "priceCurrency": "PLAT"
  }
}
```

### 3. 内链建设
在首页添加热门武器列表，每个武器链接到对应的详情页：
```html
<a href="/apps/RivenTracker/en/weapon/kuva_bramma/">Kuva Bramma Riven Price</a>
```

### 4. 社交媒体优化
创建分享图片（Open Graph）：
- 尺寸：1200×630 像素
- 路径：`/apps/RivenTracker/images/og-image.png`

## 监控 SEO 效果

使用以下工具监控：
- Google Search Console - 查看点击量和排名
- Google Analytics - 跟踪流量来源
- Ahrefs/SEMrush（可选）- 监控关键词排名

## 故障排除

### 问题：武器页面返回 404
**解决：** 确保 Functions 目录正确部署
```bash
npx wrangler pages deploy .
```

### 问题：Sitemap 不包含所有武器
**解决：** 检查 D1 数据库连接或更新默认武器列表

### 问题：Google 不索引详情页
**解决：**
1. 检查 robots.txt 是否允许
2. 使用 Search Console 手动提交 URL
3. 确保页面加载速度 < 3 秒

## 更新记录

- 2025-01-31: 初始实施 - 动态URL、Sitemap、Cloudflare Functions
