// Append-only compact indexes for the active immutable generation.
import {backfillCatalogMarketLandings} from '../apps/web/lib/catalog/storage.ts';
console.log('MARKET_LANDINGS', JSON.stringify(await backfillCatalogMarketLandings()));
