import type { VehicleOffer } from "./types";

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
  const other=bucket.filter(row=>catalogPowerBand(row)!=="low");
  const unknown=other.filter(row=>catalogPowerBand(row)==="unknown").length;
  // Owner explicitly excludes Japan from the 80/20 policy: keep every Drom
  // sold-result candidate regardless of power; sanctions are a separate flag.
  if(market==="japan"){
   selected.push(...bucket);
   report[market]={low:low.length,high:other.length-unknown,unknown,published:bucket.length,exempt:true,reason:"japan_owner_exemption"};
   continue;
  }
  if(bucket.length && !low.length)throw Error("catalog_power_mix_no_qualified_low_power:"+market);
  const allowance=Math.floor(low.length/4);
  // Keep the existing price/quality order within each band. Unknown power uses
  // the same 20% allowance as >160 hp, so it cannot inflate the low-power share.
  const keptOther=other.slice(0,allowance);
  const kept=new Set<T>([...low,...keptOther]);
  selected.push(...bucket.filter(row=>kept.has(row)));
  removed.push(...other.slice(allowance));
  report[market]={low:low.length,high:keptOther.filter(row=>catalogPowerBand(row)==="high").length,unknown:keptOther.filter(row=>catalogPowerBand(row)==="unknown").length,published:kept.size,held:other.length-keptOther.length,targetMet:true};
 }
 return {rows:selected,removed,report};
}
