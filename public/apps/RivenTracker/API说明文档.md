
1. **外部依赖 API（warframe.market v2 / v1）**：你采集数据一定会用到
2. **你自己的 Web 服务 API（给前端用）**：你做产品必须有的查询接口

> 说明：warframe.market 的 API 没有“官方长期兼容承诺”，但你已经通过抓包确认这些接口正在被网站前端使用；本文档以你抓到的实际返回结构为准（字段按你的样例写死）。

---

# A. 外部依赖 API（warframe.market）

## A1. 获取 v2 API 与集合版本

### GET `https://api.warframe.market/v2/versions`

**用途**

* 获取当前 `apiVersion`
* 获取各 collection（items/rivens/liches…）的版本戳（Base64 编码的时间字符串）
* 用于：**决定是否需要同步字典数据**（如 riven weapons/attributes）

**请求**

* Method: `GET`
* Headers:

  * `Accept: application/json`

**响应 200（示例）**

```json
{
  "apiVersion": "0.22.7",
  "data": {
    "id": "694ec216f384e9a134cf4f48",
    "apps": {
      "ios": "0.0.1",
      "android": "0.0.1",
      "minIos": "",
      "minAndroid": ""
    },
    "collections": {
      "items": "MjAyNS0xMi0yNlQxNzoxMjo1NA==",
      "rivens": "MjAyNS0xMi0yM1QwMTozMzo1NQ==",
      "liches": "MjAyNC0xMS0yNVQyMDowODowMQ==",
      "sisters": "MjAyNS0wMy0yMFQwMDoxODo0OQ==",
      "missions": "MjAyNS0xMi0xMFQxNjo1Nzo1OA==",
      "npcs": "MjAyNS0xMi0xOVQwMzoxMzo1OQ==",
      "locations": "MjAyNS0xMi0yM1QwMTozMzo1NQ=="
    },
    "updatedAt": "2025-12-26T17:12:54Z"
  },
  "error": null
}
```

**字段说明**

* `apiVersion`：v2 API 版本号字符串
* `data.collections.<name>`：Base64(ISO时间字符串)，如你已解码：`MjAyNS0xMi0yM1QwMTozMzo1NQ==` → `2025-12-23T01:33:55`
* 你的同步策略：只要 `collections.rivens` 变化，就重新拉 riven weapons/attributes

---

## A2. 获取紫卡词条字典（Attributes）

### GET `https://api.warframe.market/v2/riven/attributes`

**用途**

* 紫卡词条 slug → 显示名、前后缀、单位等
* MVP 可先同步存库，不强依赖；后续做高级筛选/展示会用到

**请求**

* Method: `GET`
* Headers:

  * `Accept: application/json`

**响应 200（示例片段）**

```json
{
  "apiVersion": "0.22.7",
  "data": [
    {
      "id": "5c5ca81a96e8d2003834fe78",
      "slug": "punch_through",
      "gameRef": "WeaponPunctureDepthMod",
      "group": "default",
      "prefix": "Lexi",
      "suffix": "Nok",
      "i18n": {
        "en": {
          "name": "Punch Through",
          "icon": "riven_attribute/unknown.png",
          "thumb": "riven_attribute/unknown.thumb.png"
        }
      }
    }
  ]
}
```

**字段说明（常用）**

* `slug`：词条标识（和 v1 auctions 的 `item.attributes[].url_name` 对应）
* `prefix/suffix`：用于组合紫卡名字
* `unit`：如 `percent`（不一定每条都有）
* `i18n.en.name`：展示名

---

## A3. 获取紫卡武器字典（Weapons）

### GET `https://api.warframe.market/v2/riven/weapons`

**用途**

* 获取所有可产生紫卡的武器列表（搜索/展示用）
* 关键：`slug` **通常可直接作为** v1 auctions 搜索的 `weapon_url_name`

**请求**

* Method: `GET`
* Headers:

  * `Accept: application/json`

**响应 200（示例片段）**

```json
{
  "apiVersion": "0.22.7",
  "data": [
    {
      "id": "5c5ca81696e8d2003834fdcc",
      "slug": "kulstar",
      "gameRef": "/Lotus/Weapons/Grineer/Pistols/GrnTorpedoPistol/GrnTorpedoPistol",
      "group": "secondary",
      "rivenType": "pistol",
      "disposition": 1.3,
      "reqMasteryRank": 5,
      "i18n": {
        "en": {
          "name": "Kulstar",
          "icon": "items/images/en/kulstar.92736ca911a3b84f99bc9e50f24369f0.png",
          "thumb": "items/images/en/thumbs/kulstar.92736ca911a3b84f99bc9e50f24369f0.128x128.png"
        }
      }
    }
  ],
  "error": null
}
```

**字段说明（常用）**

* `slug`：武器 slug（用于你的搜索、也用于 v1 价格采样）
* `disposition`：紫卡倾向
* `i18n.en.name/icon/thumb`：UI 展示信息

---

## A4. 拍卖搜索（紫卡实时数据来源）

### GET `https://api.warframe.market/v1/auctions/search`

**用途**

* 获取某武器紫卡拍卖列表（你每 30 分钟采样一次的核心数据来源）
* 你要从里面过滤 `owner.status == "ingame"` 并取 `buyout_price` 前 5

**请求参数（Query）**

* `type`：固定 `riven`
* `weapon_url_name`：武器 slug（例：`magistar`）
* `sort_by`：建议 `price_asc`（你同学策略：只看底部）

  * 示例：`sort_by=price_asc`

**请求示例**

```
GET https://api.warframe.market/v1/auctions/search?type=riven&sort_by=price_asc&weapon_url_name=magistar
```

**请求 Headers（建议）**

* `Accept: application/json`
* （可选）`Language: zh-hans`
* （可选）`Platform: pc`（你响应里 `auction.platform` 是 `pc`，前端也可能通过 header 控制；如你抓包里看到有该 header，就按抓到的值带上）

**响应 200（你贴过的结构，示例片段）**

```json
{
  "payload": {
    "auctions": [
      {
        "visible": true,
        "starting_price": 350,
        "buyout_price": 350,
        "platform": "pc",
        "crossplay": true,
        "closed": false,
        "top_bid": null,
        "is_direct_sell": true,
        "id": "695d1bc7635d450009e65097",
        "owner": {
          "status": "offline",
          "platform": "pc",
          "ingame_name": "Serendipity-kidisi",
          "last_seen": "2026-01-06T14:52:10.899+00:00"
        },
        "item": {
          "type": "riven",
          "weapon_url_name": "magistar",
          "re_rolls": 57,
          "polarity": "madurai",
          "attributes": [
            { "value": 329.2, "positive": true, "url_name": "critical_chance" }
          ],
          "name": "critatron"
        },
        "private": false
      }
    ]
  }
}
```

**你需要用到的字段（MVP 必选）**

* 列表：`payload.auctions[]`
* 一口价：`auction.buyout_price`（可能为 null，需要判空）
* 卖家状态：`auction.owner.status`（你确认有 `"ingame"` / `"online"` / `"offline"`）
* 是否关闭：`auction.closed`
* 是否可见：`auction.visible`
* 武器：`auction.item.weapon_url_name`

**你产品的过滤口径（你已决定）**

* 只用 `owner.status == "ingame"`（排除 `"online"` 与 `"offline"`）
* 只取 `buyout_price != null`
* `visible == true && closed == false`

---

# B. 你自己的 Web 服务 API（给前端用）

下面是你产品最小闭环需要的 API。假设你的后端域名是：

* `https://your-domain.com`

所有响应默认：

* `Content-Type: application/json; charset=utf-8`

---

## B1. 武器搜索/列表（来自 v2/riven/weapons 的缓存）

### GET `/api/weapons`

**用途**

* 前端搜索框：按关键词返回武器候选
* 数据来自你后端同步的 `riven_weapon_dict`

**Query 参数**

* `q`（可选）：搜索关键词，匹配 `slug` 或 `name`
* `limit`（可选）：默认 20，最大 100

**请求示例**

```
GET /api/weapons?q=magi&limit=20
```

**响应 200（示例）**

```json
{
  "data": [
    {
      "slug": "magistar",
      "name_en": "Magistar",
      "icon": "items/images/en/magistar.xxx.png",
      "thumb": "items/images/en/thumbs/magistar.xxx.128x128.png",
      "group": "melee",
      "riven_type": "melee",
      "disposition": 1.05,
      "req_mr": 8
    }
  ]
}
```

---

## B2. 获取某武器的底价趋势（核心）

### GET `/api/riven/bottom-trend`

**用途**

* 返回 7/30/90 天的时间序列（30 分钟粒度或聚合粒度）
* 数据来自 `riven_bottom_tick`（你每 30 分钟写入）

**Query 参数**

* `weapon`（必填）：武器 slug，如 `magistar`
* `range`（可选）：`7d` / `30d` / `90d`，默认 `30d`
* `platform`（可选）：默认 `pc`

**请求示例**

```
GET /api/riven/bottom-trend?weapon=magistar&range=30d&platform=pc
```

**响应 200（示例）**

```json
{
  "meta": {
    "weapon": "magistar",
    "platform": "pc",
    "range": "30d",
    "interval_minutes": 30,
    "calculation": "ingame_only; top5_weighted_buyout; outlier_drop_p1_if_p1_lt_0.6_mean(p2,p3)",
    "last_updated_utc": "2026-01-06T15:30:00Z"
  },
  "data": [
    {
      "ts": "2026-01-06T15:00:00Z",
      "bottom_price": 352,
      "sample_count": 5,
      "min_price": 350,
      "p5_price": 370
    },
    {
      "ts": "2026-01-06T15:30:00Z",
      "bottom_price": 360,
      "sample_count": 4,
      "min_price": 350,
      "p5_price": 380
    }
  ]
}
```

**字段说明**

* `interval_minutes`: 30（你定的采样频率）
* `sample_count`: 实际参与计算的底部样本数（可能 <5）
* `min_price/p5_price`: 底部带宽（增强可信度）

---

## B3. 当前底价快照（可选，但很好用）

### GET `/api/riven/bottom-now`

**用途**

* 首页快速显示当前底价（不必加载整段趋势）
* 返回最近一个 tick

**Query 参数**

* `weapon`（必填）
* `platform`（可选，默认 pc）

**响应 200（示例）**

```json
{
  "data": {
    "ts": "2026-01-06T15:30:00Z",
    "weapon": "magistar",
    "platform": "pc",
    "bottom_price": 360,
    "sample_count": 4,
    "min_price": 350,
    "p5_price": 380
  }
}
```

---

## B4. 数据健康检查（用于前端显示“最后更新时间”）

### GET `/api/health`

**响应 200（示例）**

```json
{
  "ok": true,
  "last_tick_utc": "2026-01-06T15:30:00Z",
  "tracked_weapon_count": 100,
  "notes": "ingame-only sampling every 30 minutes"
}
```

---

## B5. 同步状态（可选，便于运维）

### GET `/api/sync/state`

**响应 200（示例）**

```json
{
  "data": {
    "api_v2_version": "0.22.7",
    "rivens_collection_version_b64": "MjAyNS0xMi0yM1QwMTozMzo1NQ==",
    "rivens_collection_version_decoded": "2025-12-23T01:33:55",
    "last_sync_utc": "2026-01-06T00:00:10Z"
  }
}
```

---

# C. 你实现时的“输入输出契约”小结（最关键）

## 你从外部拿到什么（输入）

* v2：武器字典（slug/name/icon/disposition）
* v1：拍卖列表（buyout_price + owner.status + closed/visible）

## 你输出给用户什么（输出）

* 每 30 分钟：每把武器一个 `tick`（bottom_price + sample_count + min/p5）
* 前端：趋势曲线接口（7/30/90 天）

---