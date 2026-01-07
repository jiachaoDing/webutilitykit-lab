import { RivenWeapon } from "../domain/types";

export interface WfmV2Versions {
  apiVersion: string;
  data: {
    collections: {
      rivens: string;
      [key: string]: string;
    };
  };
}

export interface RivenAttribute {
  slug: string;
  name: string;
  prefix: string;
  suffix: string;
}

export class WfmV2Client {
  private baseUrl = "https://api.warframe.market/v2";

  async getVersions(): Promise<WfmV2Versions> {
    const res = await fetch(`${this.baseUrl}/versions`, {
      headers: { 
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebUtilityKitLab/0.1.0"
      }
    });
    if (!res.ok) throw new Error(`WFM V2 versions error: ${res.status}`);
    return res.json() as Promise<WfmV2Versions>;
  }

  async getRivenWeapons(): Promise<RivenWeapon[]> {
    const res = await fetch(`${this.baseUrl}/riven/weapons`, {
      headers: { 
        "Accept": "application/json",
        "Language": "zh-hans",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebUtilityKitLab/0.1.0"
      }
    });
    if (!res.ok) throw new Error(`WFM V2 weapons error: ${res.status}`);
    const json: any = await res.json();
    
    return json.data.map((item: any) => ({
      slug: item.slug,
      name_en: item.i18n.en.name,
      name_zh: item.i18n["zh-hans"]?.name || null,
      icon: item.i18n.en.icon,
      thumb: item.i18n.en.thumb,
      group: item.group,
      rivenType: item.rivenType,
      disposition: item.disposition,
      req_mr: item.reqMasteryRank
    }));
  }

  async getRivenAttributes(): Promise<RivenAttribute[]> {
    const res = await fetch(`${this.baseUrl}/riven/attributes`, {
      headers: { 
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebUtilityKitLab/0.1.0"
      }
    });
    if (!res.ok) throw new Error(`WFM V2 attributes error: ${res.status}`);
    const json: any = await res.json();
    return json.data.map((item: any) => ({
      slug: item.slug,
      name: item.i18n.en.name,
      prefix: item.prefix,
      suffix: item.suffix
    }));
  }
}

