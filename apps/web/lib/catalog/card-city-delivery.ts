import { quoteCityDelivery } from "./city-delivery";

export type DeliveryPricingBasis = { subtotalRub: number; deliveryRub: number; percents: number[] };
/** Enough to replay delivery and each rounded percentage without exposing a full ledger. */
export function deliveryPricingBasis(snapshot: any): DeliveryPricingBasis | undefined {
 const lines = snapshot?.breakdown;
 if (!Array.isArray(lines)) return snapshot?.deliveryPricingBasis;
 const subtotalRub = lines.filter((line:any)=>line.amountType !== "percent" && line.id !== "exchange-reserve")
  .reduce((sum:number,line:any)=>sum + Number(line.amountRub || 0),0) - Number(snapshot.sourcePriceAdjustment?.adjustmentRub || 0);
 const deliveryRub = lines.filter((line:any)=>line.id === "rf-delivery").reduce((sum:number,line:any)=>sum + Number(line.amountRub || 0),0);
 const percents = (snapshot.marketConfig?.percentExpenses || []).map((expense:any)=>Math.max(0,Number(expense.percent) || 0));
 return {subtotalRub,deliveryRub,percents};
}

export function priceCardForCity(offer: any, city: string) {
 const quote = quoteCityDelivery(city, offer.market);
 const preview = Number(offer.japanDeliveredPreview?.totalRub) > 0 ? offer.japanDeliveredPreview : null;
 const totalRub = Number(preview?.totalRub ?? offer.totalRub);
 const basis = preview?.deliveryPricingBasis || deliveryPricingBasis(offer.calculationSnapshot);
 if (!(totalRub > 0) || (!preview && offer.catalogPricingMode === "seller")) return {offer,quote,included:false};
 if (!basis) return {offer,quote,included:false};
 const nextDelivery = quote.status === "estimated" ? quote.amountRub : 0;
 const difference = nextDelivery - basis.deliveryRub;
 const delta = difference + basis.percents.reduce((sum:number,percent:number)=>sum
  + Math.round((basis.subtotalRub + difference)*percent/100) - Math.round(basis.subtotalRub*percent/100),0);
 const priced = {...offer,totalRub:totalRub+delta,
  previousTotalRub:Number(offer.previousTotalRub)>0 ? Number(offer.previousTotalRub)+delta : offer.previousTotalRub};
 if (preview) priced.japanDeliveredPreview = {...preview,totalRub:totalRub+delta};
 return {offer:priced,quote,included:quote.status === "estimated"};
}
