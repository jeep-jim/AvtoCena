const { readAllOffersForMaintenance } = await import('../apps/web/lib/catalog/storage.ts');
const { encarNonCashContractReason } = await import('../apps/web/lib/catalog/encar-sale-contract.ts');
const offers=(await readAllOffersForMaintenance()).filter((o)=>o?.status==='active'&&o.sourceId==='encar_direct');
const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const pos=(v)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:0};
const keys=/(advertisementtype|leaserenttype|leasetype|renttype|contracttype|leaserentinfo|monthlyfee|monthlyprice|rentfee|leasefee|residualmonth|remainingmonth|price|vehicleprice|sellprice|normalprice|cashprice|carprice)/i;
function pick(value,depth=0,out={}){
  if(value==null||depth>10||typeof value!=='object')return out;
  if(Array.isArray(value)){for(const item of value)pick(item,depth+1,out);return out;}
  for(const [key,child] of Object.entries(value)){
    if(keys.test(key)&&Object.keys(out).length<80){
      if(child==null||typeof child!=='object') out[key]=child;
      else if(Array.isArray(child)) out[key]=child.slice(0,5);
      else out[key]=Object.fromEntries(Object.entries(child).filter(([k,v])=>keys.test(k)&&v!=null&&typeof v!=='object').slice(0,20));
    }
    if(child&&typeof child==='object')pick(child,depth+1,out);
  }
  return out;
}
const rows=[];
for(const offer of offers){
  const source=pos(offer.sourcePrice);
  const sourceRub=pos(offer.calculationSnapshot?.sourcePriceRub);
  const total=pos(offer.totalRub);
  const ratio=sourceRub&&total?Math.round(total/sourceRub*100)/100:0;
  if(!(source<3_000_000 || ratio>=8))continue;
  rows.push({
    id:offer.id,make:offer.make,model:offer.model,trim:offer.trim,year:offer.year,mileageKm:offer.mileageKm,
    sourcePrice:source,sourceCurrency:offer.sourceCurrency,sourceRub,totalRub:total,ratio,
    sourceTitle:offer.sourceTitle||offer.operational?.sourceTitle,sourceUrl:offer.operational?.sourceUrl,
    nonCashReason:encarNonCashContractReason(offer.operational?.raw),
    relevantRaw:pick(offer.operational?.raw),
  });
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),encarActive:offers.length,flagged:rows.length,rows:rows.sort((a,b)=>b.ratio-a.ratio||a.sourcePrice-b.sourcePrice).slice(0,250)},null,2));
