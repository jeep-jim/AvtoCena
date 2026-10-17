import { AutoScoutHqAdapter } from "./autoscout-hq-source";
import type { CatalogFetchResult, VehicleOffer } from "./types";

const AUTOSCOUT_MIN_YEAR = 2020;

export class AutoScoutCurrentAdapter extends AutoScoutHqAdapter {
  protected override minimumRegistrationYear = AUTOSCOUT_MIN_YEAR;

  override async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = await super.fetchPage(cursor);
    const items = page.items.filter((item: any) => Number(item?.year || 0) >= AUTOSCOUT_MIN_YEAR);
    return {
      ...page,
      items,
      count: items.length,
      health: page.health ? {
        ...page.health,
        message: `${page.health.message}; collector year>=${AUTOSCOUT_MIN_YEAR} accepted=${items.length}`,
      } : page.health,
    };
  }

  override normalizeOffer(raw: unknown): VehicleOffer | null {
    if (Number((raw as any)?.year || 0) < AUTOSCOUT_MIN_YEAR) return null;
    return super.normalizeOffer(raw);
  }
}

export const autoscoutEuropeCurrentSource = new AutoScoutCurrentAdapter();
