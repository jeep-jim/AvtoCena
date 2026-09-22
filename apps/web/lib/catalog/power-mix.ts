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
export function selectCatalogPowerMix<T extends Partial<VehicleOffer>>(rows: readonly T[], options: { retainedIds?: ReadonlySet<string> } = {}) {
 const groups=new Map<string,T[]>();
 for(const row of rows){const market=String(row.market||"");const bucket=groups.get(market)||[];bucket.push(row);groups.set(market,bucket);}
 const selected:T[]=[],removed:T[]=[],report:Record<string,unknown>={};
 for(const [market,bucket] of groups){
  const low=bucket.filter(row=>catalogPowerBand(row)==="low");
  const sellerUnknown: T[] = [];
  const sellerUnknownSet=new Set(sellerUnknown);
  const other=bucket.filter(row=>catalogPowerBand(row)!=="low" && !sellerUnknownSet.has(row));
  const unknown=other.filter(row=>catalogPowerBand(row)==="unknown").length;
  // Owner explicitly excludes Japan from the 80/20 policy: keep every verified auction
  // sold-result candidate regardless of power; sanctions are a separate flag.
  if(market==="japan"){
   selected.push(...bucket);
   report[market]={low:low.length,high:other.length-unknown,unknown:unknown+sellerUnknown.length,published:bucket.length,exempt:true,reason:"japan_owner_exemption"};
   continue;
  }
  const retainedOther=other.filter(row=>options.retainedIds?.has(String(row.id)));
  if(market !== "china" && bucket.length && !low.length && !sellerUnknown.length && !retainedOther.length)throw Error("catalog_power_mix_no_qualified_low_power:"+market);
  const allowance=Math.floor(low.length/4);
  // Europe: fill the limited extra pool with the least expensive verified
  // delivered totals first. Seller-only prices are not comparable to totals.
  // Unknown power consumes the same 20% allowance as high power.
  // Only already-published rows can be grandfathered while verified low-power stock grows.
  if(market==="europe")other.sort((a,b)=>(catalogOfferVisibleRub(a)||Infinity)-(catalogOfferVisibleRub(b)||Infinity));
  // An existing car must not vanish merely because its previously unknown power was recovered.
  // Retained cars consume the allowance first; new high-power admissions wait for room.
  const retainedSet=new Set(retainedOther);
  const newOther=other.filter(row=>!retainedSet.has(row));
  const newAllowance=Math.max(0,allowance-retainedOther.length);
  const keptOther=[...retainedOther,...newOther.slice(0,newAllowance)];
  const kept=new Set<T>([...low,...keptOther,...sellerUnknown]);
  selected.push(...bucket.filter(row=>kept.has(row)));
  removed.push(...newOther.slice(newAllowance));
  report[market]={low:low.length,high:keptOther.filter(row=>catalogPowerBand(row)==="high").length,unknown:keptOther.filter(row=>catalogPowerBand(row)==="unknown").length+sellerUnknown.length,sellerUnknownExempt:sellerUnknown.length,retainedAboveAllowance:Math.max(0,retainedOther.length-allowance),published:kept.size,held:other.length-keptOther.length,targetMet:kept.size > 0 && low.length / kept.size >= 0.8};
 }
 return {rows:selected,removed,report};
}
