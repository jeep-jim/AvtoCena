import { Che168DealerAdapter } from "./che168-dealer-source";
import type { CatalogFetchResult } from "./types";

class ResilientChe168DealerAdapter extends Che168DealerAdapter {
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    let scanCursor = Math.max(1, Number(cursor || 1));
    let lastError = "che168_dealer_all_candidates_empty";

    // A single dealer can close or temporarily return an empty page. That must
    // not terminate the whole China market scan, so continue through the pool.
    for (let attempt = 0; attempt < 12; attempt++, scanCursor++) {
      try {
        const result = await super.fetchPage(String(scanCursor));
        return { ...result, nextCursor: String(scanCursor + 1), finished: false };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(`che168_dealer_pool_zero_from_${cursor || 1}:${lastError}`);
  }
}

export const che168DealerResilientSource = new ResilientChe168DealerAdapter();
