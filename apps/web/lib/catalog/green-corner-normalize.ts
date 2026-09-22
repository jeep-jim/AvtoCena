import type { VehicleOffer } from "./types";
import type { CurrencyRateSnapshot } from "./rates";
import { GREEN_CORNER_SOURCE, GREEN_CORNER_FEE_RUB } from "./green-corner-contract";
export function greenCornerFobPrice(row:any,now:string):number {
 const base=Number(row.priceInJapan), expiry=row.discountExpiresAt;
 if(expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry)<=Date.parse(now)))return base;
 const explicit=Number(row.discountPrice), percent=Number(row.discount);
 if(Number.isFinite(explicit)&&explicit>0&&explicit<base)return explicit;
 return Number.isFinite(percent)&&percent>0&&percent<100 ? Math.ceil(base*(1-percent/100)) : base;
}
export function normalizeGreenCorner(row: any, unitRate: CurrencyRateSnapshot, now = new Date().toISOString()): VehicleOffer {
 const sourcePrice=greenCornerFobPrice(row,now), year=Number(row.year), powerHp=Number(row.horsepower);
 if(!/^\d+$/.test(String(row.id)) || row.isSold!==false || row.location!=="japan" || !["auto","oneprice"].includes(row.subgroup)
  || row.priceInJapanCurrency!=="JPY" || !(sourcePrice>0) || !Number.isFinite(sourcePrice)
  || !Number.isInteger(year) || year<1950 || year>new Date(now).getUTCFullYear()+1
  || !String(row.company||"").trim() || !String(row.model||"").trim()) throw Error("green_invalid_listing");
 if(unitRate.currency!=="JPY" || !["cbr","cbr_live"].includes(unitRate.rateSource) || !(unitRate.effectiveRate>0)
  || !Number.isFinite(Date.parse(unitRate.rateDate)) || Math.abs(Date.parse(now)-Date.parse(unitRate.rateDate))>4*86400000) throw Error("green_invalid_currency_rate");
 const urls=[...new Set<string>((Array.isArray(row.media)?row.media:[]).filter((url:unknown)=>{
  try{const u=new URL(String(url));return u.protocol==="https:"&&u.hostname==="img.akebono.world"&&!u.port&&!u.username&&!u.password&&/\.(jpe?g|png|webp)$/i.test(u.pathname);}catch{return false;}
 }))];
 if(!urls.length)throw Error("green_missing_photos");
 const baseRub=Math.round(sourcePrice*unitRate.effectiveRate);
 return {
  id:`green-${row.id}`,sourceId:GREEN_CORNER_SOURCE,sourceOfferId:String(row.id),market:"japan",
  offerType:"fixed",priceMode:"fixed",status:"active",catalogKind:"listing",
  make:String(row.company).trim().replace(/MERCEDES\s*-\s*BENZ/i,"Mercedes-Benz"),model:String(row.model).trim(),trim:String(row.modelGrade||"").trim(),year,
  ...(Number(row.mileageNum)>=0&&row.mileageNum!=null?{mileageKm:Math.round(Number(row.mileageNum)*1000)}:{}),
  ...(Number(row.engineVolumeNum)>0?{engineCc:Number(row.engineVolumeNum)}:{}),
  ...(Number.isFinite(powerHp)&&powerHp>0?{powerHp,powerDataConfidence:"source_exact",powerDataSource:"Akebono"}:{}),
  color:row.color||undefined,
  sourcePrice,sourceCurrency:"JPY",catalogPricingMode:"seller",sellerPriceRub:baseRub+GREEN_CORNER_FEE_RUB,totalRub:null,calculationStatus:"needs_data",
  calculationSnapshot:{currencyRate:{...unitRate,sourcePrice,sourcePriceRub:sourcePrice*unitRate.effectiveRate},sourcePriceRub:baseRub,pricingConfidence:"unavailable"},
  images:urls.map((url,index)=>({id:`green-${row.id}-${index}`,url,objectKey:"",size:0,checksum:"",mimeType:/\.png$/i.test(url)?"image/png":/\.webp$/i.test(url)?"image/webp":"image/jpeg"})),
  firstSeenAt:now,updatedAt:now,
  operational:{sourceUrl:`https://akebono.world/green/lots/${row.id}`,sourcePublishedAt:row.createdAt,sourceVenueName:"Akebono · Зелёный угол"}
 };
}
