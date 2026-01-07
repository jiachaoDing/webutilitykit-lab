import { WfmAuction } from "../domain/types";

export class WfmV1Client {
  private baseUrl = "https://api.warframe.market/v1";

  async searchAuctions(weaponSlug: string): Promise<WfmAuction[]> {
    const params = new URLSearchParams({
      type: "riven",
      weapon_url_name: weaponSlug,
      sort_by: "price_asc"
    });

    const res = await fetch(`${this.baseUrl}/auctions/search?${params.toString()}`, {
      headers: {
        "Accept": "application/json",
        "Platform": "pc"
      }
    });

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

