import {normalizeGreenCorner} from '../../apps/web/lib/catalog/green-corner-normalize.ts';
import {catalogInventoryAgeDecision,catalogHeavyVehicleExcluded} from '../../apps/web/lib/catalog/inventory-admission.ts';
import {assertGreenPublication} from './akebono-green-source.mjs';

// A completed source scan is mandatory. A photo-less new lot is quarantined,
// not a reason to freeze prices and availability for every other vehicle.
export function prepareGreenRefresh(source, previousItems, terms, rate, now) {
 const previous=new Map(previousItems.map(row=>[row.id,row]));
 const items=[], missingPhotos=[], reusedPhotos=[];
 let outsideInventoryPolicy=0;
 for(const row of source.items){
  const old=previous.get(`green-${row.id}`);
  let fresh;
  try {fresh=normalizeGreenCorner({...row,...terms},rate,now);}
  catch(error){
   if(error.message!=='green_missing_photos')throw error;
   if(!old){missingPhotos.push(String(row.id));continue;}
   // Reuse images only from this exact already-published lot. Normalization
   // still validates the complete current listing, price, terms and image host.
   fresh=normalizeGreenCorner({...row,...terms,media:old.images.map(image=>image.url)},rate,now);
   reusedPhotos.push(String(row.id));
  }
  if(old && (old.sourceId!==fresh.sourceId || old.sourceOfferId!==fresh.sourceOfferId
    || old.make!==fresh.make || old.model!==fresh.model || old.year!==fresh.year))throw Error('green_existing_identity_changed');
  // Routine refresh is price/availability only. Preserve technical facts,
  // provenance, images and manual values for existing identities.
  const offer=old?{...old,sourcePrice:fresh.sourcePrice,sourceCurrency:fresh.sourceCurrency,
   sellerPriceRub:fresh.sellerPriceRub,greenCornerInvoice:fresh.greenCornerInvoice,
   calculationSnapshot:fresh.calculationSnapshot,totalRub:null,calculationStatus:'needs_data',
   catalogPricingMode:'seller',status:'active',updatedAt:now}:fresh;
  if(!catalogInventoryAgeDecision(offer).eligible||catalogHeavyVehicleExcluded(offer)){outsideInventoryPolicy++;continue;}
  items.push(offer);
 }
 items.sort((a,b)=>b.year-a.year||a.id.localeCompare(b.id));
 assertGreenPublication(previousItems.length,items.length,source.total);
 return {items,missingPhotos,reusedPhotos,outsideInventoryPolicy};
}
