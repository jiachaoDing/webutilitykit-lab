import { WfmAuction } from "./types";

export interface CalculationResult {
  bottom_price: number | null;
  sample_count: number;
  active_count: number;
  min_price: number | null;
  p5_price: number | null;
  p10_price: number | null;
  status: 'ok' | 'no_data';
}

export class BottomPriceCalculator {
  static calculate(auctions: WfmAuction[]): CalculationResult {
    // 1. Filter In-game and Buyout
    const allInGame = auctions
      .filter(a => a.visible && !a.closed && a.owner.status === 'ingame' && a.buyout_price !== null)
      .map(a => a.buyout_price as number)
      .sort((a, b) => a - b);

    const activeCount = allInGame.length;

    if (activeCount === 0) {
      return { bottom_price: null, sample_count: 0, active_count: 0, min_price: null, p5_price: null, p10_price: null, status: 'no_data' };
    }

    // 2. Take Top 5 for price calculation
    const finalPrices = allInGame.slice(0, 5);
    const sampleCount = finalPrices.length;
    
    const minPrice = finalPrices[0];
    const p5Price = finalPrices[finalPrices.length - 1];
    const p10Price = allInGame.length >= 10 ? allInGame[9] : allInGame[allInGame.length - 1];

    // 3. Simple Average Calculation (Arithmetic mean of top 5)
    const bottomPrice = finalPrices.reduce((sum, p) => sum + p, 0) / sampleCount;

    return {
      bottom_price: Math.round(bottomPrice),
      sample_count: sampleCount,
      active_count: activeCount,
      min_price: minPrice,
      p5_price: p5Price,
      p10_price: p10Price,
      status: 'ok'
    };
  }
}

