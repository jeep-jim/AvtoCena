import {hasModificationSelection} from './modification-contract';
/** Only a calculated quote may participate in delivered-price ordering. */
export function calculatedCatalogPrice(row:any):number {
 if(hasModificationSelection(row))return 0;
 const amount=Number(row.savedCalculationPreview
  ? row.totalRub || row.savedCalculationPreview.totalRub
  : row.japanDeliveredPreview?.totalRub || (row.catalogPricingMode!=='seller'&&row.totalRub) || row.deliveredCalculationPreview?.totalRub);
 return Number.isFinite(amount)&&amount>0?amount:0;
}
