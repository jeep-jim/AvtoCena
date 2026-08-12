const { readAllOffersForMaintenance } = await import('../apps/web/lib/catalog/storage.ts');
const { isEncarNonCashContractOffer, encarNonCashContractReason } = await import('../apps/web/lib/catalog/encar-sale-contract.ts');
const offers = await readAllOffersForMaintenance();
const rows = offers.filter((o) => String(o.sourceOfferId||'')==='42435312' || String(o.id||'')==='2e1f322c549ec2a8b467740d' || (/Palisade/i.test(`${o.make||''} ${o.model||''} ${o.trim||''}`) && Number(o.mileageKm||0)===17780));
const output = rows.map((o) => ({
 id:o.id, market:o.market, sourceId:o.sourceId, sourceOfferId:o.sourceOfferId, status:o.status,
 make:o.make, model:o.model, trim:o.trim, year:o.year, mileageKm:o.mileageKm,
 sourcePrice:o.sourcePrice, sourceCurrency:o.sourceCurrency, totalRub:o.totalRub,
 calculationStatus:o.calculationStatus, sourceUrl:o.operational?.sourceUrl,
 nonCashGuard:isEncarNonCashContractOffer(o), nonCashReason:encarNonCashContractReason(o.operational?.raw),
 rawAdvertisementType:o.operational?.raw?.detail?.advertisement?.advertisementType || o.operational?.raw?.advertisement?.advertisementType || o.operational?.raw?.advertisementType,
 rawPrice:o.operational?.raw?.detail?.advertisement?.price || o.operational?.raw?.advertisement?.price || o.operational?.raw?.Price,
}));
console.log(JSON.stringify({checkedAt:new Date().toISOString(), allOffers:offers.length, matches:output.length, rows:output},null,2));
