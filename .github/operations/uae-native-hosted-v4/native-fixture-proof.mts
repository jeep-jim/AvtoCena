import './helpers/server-only-hook.mjs';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {isPriceOnRequestDubicarsOffer} from '../apps/web/lib/catalog/dubicars-owner-policy';
import {isSellerPricedOffer} from '../apps/web/lib/catalog/seller-price-contract';
import {readPreparedUaeSearch,readPreparedUaeDetail,searchOffers} from '../apps/web/lib/catalog/storage';
import assert from 'node:assert/strict';
const p=JSON.parse(readFileSync(process.env.EXPECTED_FIXTURE!,'utf8'));
const a=await readPreparedUaeSearch({market:'uae',page:1}),b=await readPreparedUaeSearch({market:'uae',page:2});
assert.equal(a?.total,53);
assert.equal(a?.items.length,24);
assert.equal(b?.items.length,24);
assert.ok([...a!.items,...b!.items].some(x=>x.id===p.seller.id));
assert.equal((await readPreparedUaeDetail(p.seller.id,p.generationId))?.sellerPriceRub,p.seller.rub);
assert.equal((await readPreparedUaeDetail(p.onRequest.id,p.generationId))?.sourcePrice,null);
assert.equal((await readPreparedUaeSearch({market:'uae',make:'Kia',model:'Sportage',yearFrom:2023},{countOnly:true}))?.total,26);
// Actual page-2 HTTP payload used by CatalogLoadMore. React client consumes
// transmitted JSON, not the producer's original sourceGroup-bearing projection.
const req=createRequire(import.meta.url),react=req('react');
if(!react.cache)react.cache=req('next/dist/compiled/react/cjs/react.react-server.production.js').cache;
const {GET}=await import('../apps/web/app/(public)/api/catalog/search/route');
const route=await GET(new Request('https://example.test/api/catalog/search?'+new URLSearchParams({
 market:'uae',preparedCut:p.generationId,marketPage:'1',page:'2',sort:'updatedAt',
})));
assert.equal(route.status,200);
const payload=await route.json();
assert.equal(payload.generationId,p.generationId);
assert.deepEqual(payload.items.map((r:any)=>r.id),b?.items.map(r=>r.id));
assert.equal(payload.items.filter(isSellerPricedOffer).length,11);
const requestRows=payload.items.filter(isPriceOnRequestDubicarsOffer);
assert.equal(requestRows.length,13,'same strict card gate must preserve all 13 on-request rows');
assert.ok(requestRows.every((row:any)=>row.sourceId==='dubicars_uae_exact'&&row.sourcePrice==null&&row.totalRub==null&&row.sellerPriceRub==null&&!row.operational));
assert.ok(payload.items.filter(isSellerPricedOffer).every((row:any)=>!row.sourceId));

const {resolveOfferDisplay}=await import('../apps/web/lib/catalog/offer-display-data');
const noAmount=await readPreparedUaeDetail(p.onRequest.id,p.generationId);
assert.ok(noAmount);
const display=await resolveOfferDisplay(noAmount);
assert.ok(isPriceOnRequestDubicarsOffer(display.raw),'ordinary detail uses same gate on public raw DTO');
assert.equal(display.visibleRub,0);
assert.equal(display.raw.totalRub??null,null);
assert.equal(display.raw.sellerPriceRub??null,null);
const seller=await readPreparedUaeDetail(p.seller.id,p.generationId);
assert.ok(seller);
const sellerDisplay=await resolveOfferDisplay(seller);
assert.equal(sellerDisplay.raw.sellerPriceRub,p.seller.rub);
assert.equal(sellerDisplay.raw.sourceId,undefined);
assert.equal(sellerDisplay.pricedOffer.images[0].url,p.seller.photo);

const georgia=await searchOffers({market:'georgia'});assert.equal(georgia.total,1);
process.env.AVTOCENA_UAE_REGCLOUD_RUNTIME='0';
assert.equal((await searchOffers({market:'uae'})).items[0]?.make,'Legacy');
console.log('fixture_native_proof_passed');
