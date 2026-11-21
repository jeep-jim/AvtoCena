// Exact installed-revision adapters. Do not import this into the live application.
import assert from 'node:assert/strict';
import {catalogOfferWithinRetention} from '../../../apps/web/lib/catalog/refresh-policy.ts';
import {sourceInventoryInScope} from '../../../apps/web/lib/catalog/source-inventory-scope.ts';
import {classifyCatalogV2Offer} from '../../../apps/web/lib/catalog/catalog-v2-policy.ts';
import {prepareSellerInventory} from '../../../apps/web/lib/catalog/prepare-seller-inventory.ts';
import {isSellerPricedOffer} from '../../../apps/web/lib/catalog/seller-price-contract.ts';
import {isPriceOnRequestDubicarsOffer} from '../../../apps/web/lib/catalog/dubicars-owner-policy.ts';
import {calculatedCatalogPrice} from '../../../apps/web/lib/catalog/calculated-price.ts';
import {matchingEditorial,editorialHidden,applyCatalogEditorial,withCatalogEditorialSnapshot} from '../../../apps/web/lib/catalog/editorial.ts';
import {searchProjectionFromOffer,projectionCanRenderCard} from '../../../apps/web/lib/catalog/storage.ts';
import {EXPECTED,CBR_21_NOV} from './qualify.mjs';
export function makeExactUaePorts({
 editorial,withPinnedNativeInputs,exactEditorialPhotoReady,exactRetainedBuyerProof
}:any){
 assert.equal(typeof withPinnedNativeInputs,'function','uae_native_read_only_price_port');
 assert.equal(typeof exactEditorialPhotoReady,'function','uae_native_authorized_editorial_gallery');
 assert.equal(typeof exactRetainedBuyerProof,'function','uae_native_current_projection_and_quote');
 return {
  releaseSha:EXPECTED.release,calculationVersion:EXPECTED.calc,
  withinRetention:catalogOfferWithinRetention,editorialHidden,applyEditorial:applyCatalogEditorial,editorialEntry:matchingEditorial,
  exactEditorialPhotoReady,exactRetainedBuyerProof,inScope:sourceInventoryInScope,
  isSeller:isSellerPricedOffer,isRequest:isPriceOnRequestDubicarsOffer,deliveredRub:calculatedCatalogPrice,
  nativeProjection:searchProjectionFromOffer,
  siteEligible:(o:any)=>classifyCatalogV2Offer(o).eligible&&projectionCanRenderCard(searchProjectionFromOffer(o)),
  async prepareSeller(row:any,fx:any){
    assert.ok(fx.rates.AED.cbrRate===CBR_21_NOV.AED&&fx.rates.AED.rateDate===CBR_21_NOV.rateDate,
      'uae_native_official_dated_rates_required');
    return withPinnedNativeInputs(fx,()=>withCatalogEditorialSnapshot(editorial.index,
      ()=>prepareSellerInventory(row,{preservePublishedPrice:false})));
  },
 };
}
