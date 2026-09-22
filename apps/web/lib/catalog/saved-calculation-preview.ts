import type { VehicleOffer } from "./types";
export type SavedCalculationPreview = {
 version:string; totalRub:number; deliveryCity:string;
 parameters:Partial<VehicleOffer>; currencyRate?:any; utilizationPowerKw?:number;
};
export function savedCalculationPreviewRub(preview:SavedCalculationPreview|undefined):number {
 return preview && Number.isFinite(preview.totalRub) && preview.totalRub>0 ? preview.totalRub : 0;
}
/** A manager's saved scenario is a display overlay, never imported source evidence. */
export function offerWithSavedPreview(offer:any) {
 const preview:SavedCalculationPreview|undefined=offer.savedCalculationPreview;
 if(!preview || !savedCalculationPreviewRub(preview))return offer;
 return {...offer,...preview.parameters,power30MinKwByMotor:undefined,utilizationPowerKw:preview.utilizationPowerKw,totalRub:preview.totalRub,
  previousTotalRub:null,priceDeltaRub:null,japanDeliveredPreview:undefined,
  modificationSelection:undefined,powerDataConfidence:"verified",powerDataSource:"manager_saved",
  calculationSnapshot:{currencyRate:preview.currencyRate},savedCalculationPreview:preview};
}
