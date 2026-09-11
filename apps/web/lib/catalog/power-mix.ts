import type { VehicleOffer } from "./types";
import { catalogOfferVisibleRub } from "./public-priority";

/** Unknown power is never evidence for the <=160 hp pool. */
export function catalogPowerBand(offer: Partial<VehicleOffer>) {
 const certified=Number(offer.utilizationPowerKw);
 const kind=String(offer.powertrainKind||"").toLowerCase();
 const fuel=String(offer.fuel||"").toLowerCase();
 const alternative=["electric","series_hybrid","other_hybrid"].includes(kind)||/electric|hybrid|phev|hev|bev|электро|гибрид/.test(fuel);
 const power=Number.isFinite(certified)&&certified>0 ? certified*1.35962 : alternative ? 0 : Number(offer.powerHp);
 if(!Number.isFinite(power)||power<=0||power>2500)return "unknown";
 return power<=160.01 ? "low" : "high";
}

/** Public assortment only: callers retain the complete source inventory. */
export function selectCatalogPowerMix<T extends Partial<VehicleOffer>>(rows: readonly T[]) {
 const groups=new Map<string,T[]>();
 for(const row of rows){const market=String(row.market||"");const bucket=groups.get(market)||[];bucket.push(row);groups.set(market,bucket);}
 const selected:T[]=[],removed:T[]=[],report:Record<string,unknown>={};
 for(const [market,bucket] of groups){
  const low=bucket.filter(row=>catalogPowerBand(row)==="low");
  const sellerUnknown=bucket.filter(row=>catalogPowerBand(row)==="unknown" && row.catalogPricingMode==="seller");
  const sellerUnknownSet=new Set(sellerUnknown);
  const other=bucket.filter(row=>catalogPowerBand(row)!=="low" && !sellerUnknownSet.has(row));
  const unknown=other.filter(row=>catalogPowerBand(row)==="unknown").length;
  // Owner explicitly excludes Japan from the 80/20 policy: keep every Drom
  // sold-result candidate regardless of power; sanctions are a separate flag.
  if(market==="japan"){
   selected.push(...bucket);
   report[market]={low:low.length,high:other.length-unknown,unknown:unknown+sellerUnknown.length,published:bucket.length,exempt:true,reason:"japan_owner_exemption"};
   continue;
  }
  if(bucket.length && !low.length && !sellerUnknown.length)throw Error("catalog_power_mix_no_qualified_low_power:"+market);
  const allowance=Math.floor(low.length/4);
  // Europe: fill the limited extra pool with the least expensive verified
  // delivered totals first. Seller-only prices are not comparable to totals.
  // Seller inventory with unknown power remains available for parameter entry.
  // It is not evidence for either the low-power or high-power assortment.
  if(market==="europe")other.sort((a,b)=>(catalogOfferVisibleRub(a)||Infinity)-(catalogOfferVisibleRub(b)||Infinity));
  const keptOther=other.slice(0,allowance);
  const kept=new Set<T>([...low,...keptOther,...sellerUnknown]);
  selected.push(...bucket.filter(row=>kept.has(row)));
  removed.push(...other.slice(allowance));
  report[market]={low:low.length,high:keptOther.filter(row=>catalogPowerBand(row)==="high").length,unknown:keptOther.filter(row=>catalogPowerBand(row)==="unknown").length+sellerUnknown.length,sellerUnknownExempt:sellerUnknown.length,published:kept.size,held:other.length-keptOther.length,targetMet:true};
 }
 return {rows:selected,removed,report};
}
