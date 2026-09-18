import { readDataJson } from "../data";
import type { PublicVehicleOffer } from "./types";
import type { CatalogFacets } from "./storage";

export const CATALOG_OVERVIEW_PATH = "catalog/public/overview.json";

export type CatalogOverviewMarket = {
  total: number;
  sourceTotal?: number;
  items: PublicVehicleOffer[];
};

export type CatalogOverview = {
  version: 1;
  publicPolicyVersion: 2;
  generationId: string;
  builtAt: string;
  facets: CatalogFacets;
  markets: Record<string, CatalogOverviewMarket>;
};

const EMPTY_FACETS: CatalogFacets = {
  generationId: "",
  makes: [],
  models: [],
  markets: [],
  bodyTypes: [],
  fuels: [],
  transmissions: [],
  drives: [],
};

const EMPTY_OVERVIEW: CatalogOverview = {
  version: 1,
  publicPolicyVersion: 2,
  generationId: "",
  builtAt: "",
  facets: EMPTY_FACETS,
  markets: {},
};

export function catalogOverviewMatchesGeneration(overview: CatalogOverview | null | undefined, generationId: string) {
  return Boolean(
    overview
      && overview.version === 1
      && overview.publicPolicyVersion === 2
      && generationId
      && overview.generationId === generationId
      && overview.facets?.generationId === generationId,
  );
}

export function buildCatalogOverviewPayload(
  generationId: string,
  facets: CatalogFacets,
  markets: Record<string, CatalogOverviewMarket>,
): CatalogOverview {
  if (!generationId || facets.generationId !== generationId) {
    throw new Error(`catalog_overview_generation_mismatch:${generationId}:${facets.generationId}`);
  }
  return {
    version: 1,
    publicPolicyVersion: 2,
    generationId,
    builtAt: new Date().toISOString(),
    facets,
    markets,
  };
}

export async function readCatalogOverview(): Promise<CatalogOverview | null> {
  const [overview, manifest] = await Promise.all([
    readDataJson<CatalogOverview>(CATALOG_OVERVIEW_PATH, EMPTY_OVERVIEW),
    readDataJson<{ generationId: string }>("catalog/manifest.json", { generationId: "" }),
  ]);
  return catalogOverviewMatchesGeneration(overview, manifest.generationId) ? overview : null;
}

// Source count proves completeness before display-policy filtering. Visible
// count may be smaller without requiring a full catalog read on every visit.
export function catalogOverviewMarketComplete(summary: CatalogOverviewMarket | undefined, sourceCount: number, limit: number) {
  if (!summary || !Number.isInteger(summary.total) || summary.total < 0 || summary.total > sourceCount) return false;
  if ((summary.sourceTotal ?? summary.total) !== sourceCount) return false;
  if (sourceCount > 0 && summary.total === 0) return false;
  return summary.items.length >= Math.min(limit, summary.total);
}
