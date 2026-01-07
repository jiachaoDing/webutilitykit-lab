import { WfmAuction } from "../domain/types";

export class WfmV1Client {
  private baseUrl = "https://api.warframe.market/v1";

  async searchAuctions(weaponSlug: string, options?: { timeoutMs?: number }): Promise<WfmAuction[]> {
    const params = new URLSearchParams({
      type: "riven",
      weapon_url_name: weaponSlug,
      sort_by: "price_asc"
    });

    const timeoutMs = Math.max(1000, options?.timeoutMs ?? 8000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/auctions/search?${params.toString()}`, {
        headers: {
          "Accept": "application/json",
          "Platform": "pc",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebUtilityKitLab/0.1.0"
        },
        signal: controller.signal,
      });
    } catch (e: any) {
      // 超时
      if (e?.name === "AbortError") {
        throw new Error("WFM_TIMEOUT");
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("WFM_LIMIT_REACHED");
      }
      throw new Error(`WFM V1 search error: ${res.status}`);
    }

    const json: any = await res.json();
    return json.payload.auctions as WfmAuction[];
  }
}

