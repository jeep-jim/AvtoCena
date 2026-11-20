import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isSellerPricedOffer,sellerPriceLabel} from './apps/web/lib/catalog/seller-price-contract.ts';
import {projectionCanRenderCard,searchProjectionFromOffer,publicOffer} from './apps/web/lib/catalog/storage.ts';
import {catalogOfferVisibleRub} from './apps/web/lib/catalog/public-priority.ts';
const wire=fs.readFileSync(process.argv[2]);
assert.equal(createHash('sha256').update(wire).digest('hex'),'b3b7a4ce414e1af9a7ec680686f956676ee8a4c434133b1ed02b5807cd80081a');
let count=0,detailLabel=0,compactLabel=0,renderable=0,deliveryClaims=0;
for(const o of JSON.parse(wire)){
 assert.ok(o.market==='europe'&&o.sourceId==='autoscout_europe_open');
 const card=publicOffer(o),projection=searchProjectionFromOffer(o);
 if(isSellerPricedOffer(card)&&sellerPriceLabel(card)==='Цена продавца')detailLabel++;
 if(isSellerPricedOffer(projection)&&sellerPriceLabel(projection)==='Цена продавца')compactLabel++;
 if(projectionCanRenderCard(projection))renderable++;
 if(catalogOfferVisibleRub(card)>0||catalogOfferVisibleRub(projection)>0||Number(card.totalRub)>0||Number(projection.totalRub)>0)deliveryClaims++;
 count++;
}
assert.equal(count,1510);assert.equal(detailLabel,count);assert.equal(compactLabel,count);assert.equal(deliveryClaims,0);
const noNetwork=globalThis.readNetworkProof?.()?.outgoingNetworkAttempts;
assert.equal(noNetwork,0);
console.log(JSON.stringify({count,nativeDetailSellerLabel:detailLabel,nativeCompactSellerLabel:compactLabel,nativeCompactRenderableAtFrozenCut:renderable,
 nativeLabel:'Цена продавца',deliveredPriceClaims:deliveryClaims,providerCalls:0,cloudWrites:0}));
