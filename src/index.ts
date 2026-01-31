import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { timing } from "hono/timing";
import rivenTrackerApp from "./apps/RivenTracker/routes";
import { handleScheduled } from "./apps/RivenTracker/jobs";
import { RivenCoordinatorDO } from "./apps/RivenTracker/RivenCoordinatorDO";
import { WeaponRepo } from "./apps/RivenTracker/repos/WeaponRepo";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  KV: KVNamespace;
  RIVEN_COORDINATOR: DurableObjectNamespace;
  APP_NAME: string;
  APP_VERSION: string;
  HOT_BATCH_SIZE_ODD: string;
  HOT_BATCH_SIZE_EVEN: string;
  COLD_BATCH_SIZE: string;
}

interface WeaponListItem {
  slug: string;
  updated_at?: string;
  last_seen?: string;
}

interface WeaponListResponse {
  data?: WeaponListItem[];
}

// 生成 Sitemap XML
async function handleSitemap(request: Request, env: Env): Promise<Response> {
  const baseUrl = 'https://lab.webutilitykit.com';
  const today = new Date().toISOString().split('T')[0];
  
  // 静态页面
  const staticUrls = [
    `  <url>
    <loc>${baseUrl}/apps/RivenTracker/en/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>`,
    `  <url>
    <loc>${baseUrl}/apps/RivenTracker/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>`
  ];
  
  // 优化：优先从 KV 获取武器名单，避免查 D1
  let weaponUrls: string[] = [];
  try {
    // 读取 DO 预存到 KV 的名单
    const [hotListRaw, coldListRaw] = await Promise.all([
      env.KV.get("riven:list:hot"),
      env.KV.get("riven:list:cold")
    ]);

    let slugs: string[] = [];
    if (hotListRaw && coldListRaw) {
      // 如果 KV 有数据，直接组合
      slugs = [...JSON.parse(hotListRaw), ...JSON.parse(coldListRaw)];
    } else {
      // 兜底：如果 KV 还没初始化，才查 D1
      console.log('Sitemap cache miss, falling back to D1');
      const weaponRepo = new WeaponRepo(env.DB);
      slugs = await weaponRepo.getAllSlugs();
    }
    
    weaponUrls = slugs.flatMap((slug) => {
      return [
        `  <url>
    <loc>${baseUrl}/apps/RivenTracker/en/weapon/${slug}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`,
        `  <url>
    <loc>${baseUrl}/apps/RivenTracker/weapon/${slug}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`
      ];
    });
  } catch (e) {
    console.error('Failed to get weapons for sitemap:', e);
  }
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls.join('\n')}
${weaponUrls.join('\n')}
</urlset>`;
  
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

const api = new Hono<{ Bindings: Env }>();

// CORS（主要给跨域调试/未来前后端分离场景用；如不需要可再收紧）
api.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

api.use('*', logger())
api.use('*', timing())

// 公共平台级 API
api.get("/api/_/health", (c) => {
  return c.json({ status: "ok", time: new Date().toISOString() });
});

api.get("/api/_/version", (c) => {
  return c.json({ name: c.env.APP_NAME, version: c.env.APP_VERSION });
});

// 示例 App API 路由分发
api.all("/api/_template/*", (c) => {
  return c.json({ message: "Hello from _template API!" });
});

// Riven Tracker API
api.route("/api/RivenTracker", rivenTrackerApp);

api.notFound((c) => {
  return c.json({ error: "API route not found" }, 404);
});

api.onError((err, c) => {
  // 避免把内部堆栈暴露给客户端
  console.error("API error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. 处理 API 路由
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    // 2. 处理 Sitemap
    if (url.pathname === '/sitemap-riven.xml') {
      return handleSitemap(request, env);
    }

    // 3. 处理 Riven Tracker 武器详情页 SEO 路由
    const weaponPathMatch = url.pathname.match(/\/apps\/RivenTracker\/(en\/)?weapon\/([^\/]+)\/?$/);
    if (weaponPathMatch) {
      const isEnglish = !!weaponPathMatch[1]; // 有 'en/' 就是英文
      const weaponSlug = weaponPathMatch[2];
      
      // 获取对应的 HTML 文件
      const htmlPath = isEnglish 
        ? '/apps/RivenTracker/en/index.html'
        : '/apps/RivenTracker/index.html';
      
      // 简化资源请求，只传递必要的 URL，避免原始请求的 Header 干扰（如缓存、编码等）
      const assetResponse = await env.ASSETS.fetch(new URL(htmlPath, url.origin));
      
      if (!assetResponse.ok) {
        console.error(`Failed to fetch template: ${htmlPath}, status: ${assetResponse.status}`);
        return env.ASSETS.fetch(request); // 回退到默认处理
      }

      let html = await assetResponse.text();
      
      // 格式化武器名称
      const weaponName = weaponSlug
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      
      // 确保资源路径是绝对路径（防止在深层路由下失效）
      // 无论是在 /en/ 还是根路径下，静态资源（js/css/images）都统一放在 /apps/RivenTracker/ 目录下
      const resourceRoot = '/apps/RivenTracker/';
      html = html.replace(/(href|src)="(\.\/|\.\.\/)([^"]+)"/g, (match, attr, prefix, path) => {
        // 如果是 en/ 目录下的相对引用 ../，或者是当前目录的 ./，都统一指向资源根目录
        // 比如 ./js/app.js -> /apps/RivenTracker/js/app.js
        // 比如 ../js/app.js -> /apps/RivenTracker/js/app.js
        return `${attr}="${resourceRoot}${path}"`;
      });
      
      if (isEnglish) {
        html = html.replace(
          /<title>.*?<\/title>/,
          `<title>${weaponName} Riven Price - Warframe Riven Tracker | WebUtilityKit</title>`
        );
        html = html.replace(
          /<meta name="description" content=".*?" \/>/,
          `<meta name="description" content="Check ${weaponName} riven mod price history and current market value. Track bottom prices and market trends for ${weaponName} rivens in Warframe." />`
        );
        html = html.replace(
          /<link rel="canonical" href=".*?" \/>/,
          `<link rel="canonical" href="https://lab.webutilitykit.com/apps/RivenTracker/en/weapon/${weaponSlug}/" />`
        );
      } else {
        html = html.replace(
          /<title>.*?<\/title>/,
          `<title>${weaponName}紫卡价格 - Warframe紫卡查询 | WebUtilityKit</title>`
        );
        html = html.replace(
          /<meta name="description" content=".*?" \/>/,
          `<meta name="description" content="查询${weaponName}紫卡价格历史和市场走势。追踪${weaponName}紫卡底价变化，获取Warframe Market实时数据。" />`
        );
        html = html.replace(
          /<link rel="canonical" href=".*?" \/>/,
          `<link rel="canonical" href="https://lab.webutilitykit.com/apps/RivenTracker/weapon/${weaponSlug}/" />`
        );
      }
      
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
        }
      });
    }

    // 4. 默认回退到静态资源托管 (Workers Static Assets)
    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  },
};

export { RivenCoordinatorDO };
