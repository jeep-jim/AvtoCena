import './helpers/server-only-hook.mjs';
import assert from 'node:assert/strict';
import {readCatalogMarketPage} from '../apps/web/lib/catalog/market-page.ts';
import {readCatalogNavigationFacets,searchOffers} from '../apps/web/lib/catalog/storage.ts';
const f=await readCatalogNavigationFacets('china');assert.ok(f.makes.includes('Toyota'));
for(const market of ['china','georgia']){
 const pages=await readCatalogMarketPage({market});assert.deepEqual(pages.items.map(x=>x.make).sort(),['Suzuki','Toyota']);
 const q=await readCatalogMarketPage({market,make:'Toyota',city:'Уссурийск'});assert.deepEqual(q.items.map(x=>x.make),['Toyota']);
}
console.log('brand_native_fixture_two_markets_verified');
