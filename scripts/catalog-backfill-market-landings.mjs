// Append-only compact indexes for the active immutable generation.
import {backfillCatalogMarketLandings} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
const writer=await getJsonStorage().readJson('catalog/import-lock.json',null);
if(Date.parse(writer?.lockedUntil||'')>Date.now()){
 console.log('MARKET_LANDINGS',JSON.stringify({skipped:true,reason:'active_catalog_writer'}));
 process.exit(0);
}
console.log('MARKET_LANDINGS', JSON.stringify(await backfillCatalogMarketLandings()));
