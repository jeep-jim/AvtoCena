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

/** Owner policy 2026-10-06: 80/20 is showcase priority, never an inventory cap.
 * Keep the compatibility options for existing publishers; neither old public
 * membership nor a minimum count may exclude a newly admitted car by power.
 */
export function selectCatalogPowerMix<T extends Partial<VehicleOffer>>(rows: readonly T[], _options: { retainedIds?: ReadonlySet<string>; minimumCountByMarket?: Readonly<Record<string, number>> } = {}) {
 const report:Record<string,any>={};
 for(const row of rows){
  const market=String(row.market||"");
  const stats=report[market] ||= {mode:"priority_only",low:0,high:0,unknown:0,published:0,held:0,unknownPowerExempt:0,sellerUnknownExempt:0,retainedAboveAllowance:0,replacedByLowPower:0};
  const band=catalogPowerBand(row);
  stats[band]++;stats.published++;
  if(band==="unknown"){
   stats.unknownPowerExempt++;
   if(row.catalogPricingMode==="seller")stats.sellerUnknownExempt++;
  }
 }
 for(const [market,stats] of Object.entries(report)){
  stats.targetMet=stats.low+stats.high>0 && stats.low/(stats.low+stats.high)>=0.8;
  if(market==="japan"){stats.exempt=true;stats.reason="japan_owner_exemption";}
 }
 // Existing ranking and showcase diversity decide presentation, not admission.
 return {rows:[...rows],removed:[] as T[],report};
}
