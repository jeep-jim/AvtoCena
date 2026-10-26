import {datedCatalogPagePath} from "./dated-pages";
import {publicationWithdrawn} from "./publication-policy";
import { readDataJson } from "../data";
import { protectCatalogCardPhotos } from "./photo-proxy-policy";
import type { PublicVehicleOffer } from "./types";
import type { CatalogFacets } from "./storage";

export const CATALOG_OVERVIEW_PATH = "catalog/public/overview.json";
export const catalogOverviewGenerationPath = (generationId: string) => `catalog/generations/${generationId}/indexes/overview.json`;

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
  policyDate?: string;
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
  policyDate = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10),
): CatalogOverview {
  if (!generationId || facets.generationId !== generationId) {
    throw new Error(`catalog_overview_generation_mismatch:${generationId}:${facets.generationId}`);
  }
  return {
    version: 1,
    publicPolicyVersion: 2,
    generationId,
    builtAt: new Date().toISOString(),
    policyDate,
    facets,
    markets,
  };
}

let overviewCache: { generationId: string; policyDate: string; expiresAt: number; promise: Promise<CatalogOverview | null> } | null = null;
export function resetCatalogOverviewCache() { overviewCache = null; }

export async function readCatalogOverview(knownGenerationId?: string): Promise<CatalogOverview | null> {
  // Share the same short-lived generation pointer as search/home. Reading it
  // directly here bypassed coalescing and made every /cars visit wait for S3.
  const generationId = knownGenerationId || await (await import("./storage")).catalogGenerationId();
  if (!generationId) return null;
  const policyDate=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  if (overviewCache?.generationId === generationId && overviewCache.policyDate===policyDate && overviewCache.expiresAt > Date.now()) return overviewCache.promise;
  const entry = { generationId, policyDate, expiresAt: Date.now() + 60_000, promise: Promise.resolve<CatalogOverview | null>(null) };
  entry.promise = (async () => {
    let immutable = await readDataJson<CatalogOverview>(catalogOverviewGenerationPath(generationId), EMPTY_OVERVIEW);
    if(immutable.policyDate!==policyDate){
      const dated=await readDataJson<CatalogOverview>(datedCatalogPagePath(catalogOverviewGenerationPath(generationId),policyDate),EMPTY_OVERVIEW);
      if(dated.policyDate===policyDate&&catalogOverviewMatchesGeneration(dated,generationId))immutable=dated;
    }
    if (immutable.policyDate===policyDate && catalogOverviewMatchesGeneration(immutable, generationId)) return immutable;
    // Compatibility with generations published before the atomic overview.
    const overview = await readDataJson<CatalogOverview>(CATALOG_OVERVIEW_PATH, EMPTY_OVERVIEW);
    return overview.policyDate===policyDate && catalogOverviewMatchesGeneration(overview, generationId) ? overview : null;
  })().then(value => {
    if (!value && overviewCache === entry) overviewCache = null;
    // Publication workers need not have AUTH_SECRET. Sign stored card URLs in
    // the web process for both the homepage and the unfiltered catalog landing.
    return value ? {...value, markets: Object.fromEntries(Object.entries(value.markets).map(([market, summary]) =>
      [market, market === "japan" ? {...summary,total:0,items:[]} : {...summary, items: summary.items.filter(item=>!publicationWithdrawn(item)).map(protectCatalogCardPhotos)}]))} : null;
  }, error => {
    if (overviewCache === entry) overviewCache = null;
    throw error;
  });
  overviewCache = entry;
  return entry.promise;
}

// Source count proves completeness before display-policy filtering. Visible
// count may be smaller without requiring a full catalog read on every visit.
export function catalogOverviewMarketComplete(summary: CatalogOverviewMarket | undefined, sourceCount: number, limit: number) {
  if (!summary || !Number.isInteger(summary.total) || summary.total < 0 || summary.total > sourceCount) return false;
  if ((summary.sourceTotal ?? summary.total) !== sourceCount) return false;
  if (sourceCount > 0 && summary.total === 0) return false;
  return summary.items.length >= Math.min(limit, summary.total);
}
