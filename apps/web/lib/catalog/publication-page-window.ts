import type {JsonStorage} from '../data';
import {datedCatalogPagePath} from './dated-pages';
import {validEditorialOverviewSnapshot,type EditorialOverviewSnapshot} from './editorial-overview-snapshot';

type Card = {id?: unknown; market?: unknown};
type Summary = {sourceTotal?: number; total: number; items: Card[]};
type Overview = {
  version: number; publicPolicyVersion: number; generationId: string; policyDate?: string;
  facets: {generationId: string}; markets: Record<string, Summary>; dailyLandingsVersion?: number;
};
type Landing = Summary & {
  version: number; generationId: string; policyDate?: string; market: string;
  facets: {generationId: string};
};
export type CatalogPageWindowProof = {generationId: string; policyDate: string; days: string[]};
const policyDay = (now: Date) => new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);

/** Recheck after other publication verification and immediately before manifest CAS. */
export function assertCatalogPageWindowCurrent(proof: CatalogPageWindowProof, now = new Date()) {
  const days = Array.from({length: 3}, (_, offset) => policyDay(new Date(now.getTime() + offset * 86400000)));
  if (proof.policyDate !== days[0] || JSON.stringify(proof.days) !== JSON.stringify(days)) {
    throw Error('catalog_page_window_date_changed');
  }
}

/** Derivatives only. The caller owns the publication/repair lease and manifest. */
export async function stageCatalogPageWindow<Row extends Card>({
  storage, generationId, markets, rows, rowsByMarket, buildLanding, buildOverview,
  landingPath, overviewPath, buildEditorial, editorialPath, assertContext, now = () => new Date(),
}: {
  storage: Pick<JsonStorage, 'readJsonWithMeta' | 'readJson' | 'writeJson'>;
  generationId: string; markets: readonly string[]; rows: Row[]; rowsByMarket: ReadonlyMap<string, Row[]>;
  buildLanding: (generationId: string, market: string, rows: Row[], now: Date) => Promise<Landing>;
  buildOverview: (generationId: string, rows: Row[], now: Date) => Promise<Overview>;
  landingPath: (generationId: string, market: string) => string;
  overviewPath: (generationId: string) => string;
  buildEditorial?: (generationId:string,rows:Row[],now:Date)=>Promise<EditorialOverviewSnapshot>;
  editorialPath?: (generationId:string)=>string;
  assertContext: () => Promise<void>; now?: () => Date;
}): Promise<{proof: CatalogPageWindowProof; overview: Overview}> {
  if (!generationId || !/^[a-zA-Z0-9_-]+$/.test(generationId) || !markets.length
      || new Set(markets).size !== markets.length) throw Error('catalog_page_window_scope_invalid');
  if(!!buildEditorial!==!!editorialPath)throw Error('catalog_page_window_editorial_builder_required');
  const captured = now(), days = Array.from({length: 3}, (_, offset) => policyDay(new Date(captured.getTime() + offset * 86400000)));
  const proof = {generationId, policyDate: days[0], days};
  const prefix = `catalog/generations/${generationId}/indexes/`;
  const scoped = (path: string) => {
    if (!path.startsWith(prefix) || path.includes('..')) throw Error('catalog_page_window_unscoped_write');
    return path;
  };
  const check = async () => {
    assertCatalogPageWindowCurrent(proof, now());
    await assertContext();
    assertCatalogPageWindowCurrent(proof, now());
  };
  const validSummary = (summary: Summary | undefined, market: string, sourceTotal: number, limit: number) =>
    summary && Number.isInteger(summary.total) && summary.total >= 0 && summary.total <= sourceTotal
      && summary.sourceTotal === sourceTotal && Array.isArray(summary.items)
      && summary.items.length === Math.min(summary.total, limit)
      && summary.items.every(item => item?.market === market && typeof item.id === 'string'
        && item.id.trim().length > 0 && item.id === item.id.trim())
      && new Set(summary.items.map(item => item.id)).size === summary.items.length;
  const writeVerified = async (path: string, value: unknown) => {
    scoped(path);
    const previous = await storage.readJsonWithMeta(path, null);
    if (previous.found && !previous.etag) throw Error('catalog_page_window_etag_required');
    await check();
    await storage.writeJson(path, value, previous.found ? {ifMatch: previous.etag} : {ifNoneMatch: '*'});
    // A successful PUT is not a readiness proof if another writer replaced it.
    const stored = await storage.readJson(path, null);
    if (JSON.stringify(stored) !== JSON.stringify(value)) throw Error('catalog_page_window_readback_mismatch');
  };
  await check();
  let currentOverview: Overview | undefined;
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(captured.getTime() + offset * 86400000), day = days[offset];
    const dated = (path: string) => offset ? datedCatalogPagePath(path, day) : path;
    for (const market of markets) {
      const source = rowsByMarket.get(market) || [];
      const landing = await buildLanding(generationId, market, source, date);
      if (landing.version !== 1 || landing.generationId !== generationId || landing.facets?.generationId !== generationId
          || landing.market !== market || landing.policyDate !== day || !validSummary(landing, market, source.length, 192)) {
        throw Error('catalog_page_window_landing_invalid');
      }
      await writeVerified(dated(landingPath(generationId, market)), landing);
    }
    const overview = await buildOverview(generationId, rows, date);
    if (overview.version !== 1 || overview.publicPolicyVersion !== 2 || overview.generationId !== generationId
        || overview.facets?.generationId !== generationId || overview.policyDate !== day
        || markets.some(market => !validSummary(overview.markets?.[market], market, rowsByMarket.get(market)?.length || 0, 24))) {
      throw Error('catalog_page_window_overview_invalid');
    }
    if(buildEditorial&&editorialPath){
      const editorial=await buildEditorial(generationId,rows,date);
      if(!validEditorialOverviewSnapshot(editorial,overview,editorial.editorialRevision,day))throw Error('catalog_page_window_editorial_invalid');
      await writeVerified(dated(editorialPath(generationId)),editorial);
    }
    // Every derivative for this date was conditionally written and read back first.
    overview.dailyLandingsVersion = 1;
    await writeVerified(dated(overviewPath(generationId)), overview);
    if (!offset) currentOverview = overview;
    await check();
  }
  return {proof, overview: currentOverview!};
}
