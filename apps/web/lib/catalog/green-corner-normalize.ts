import { withGreenCornerFuel } from "./green-corner-fuel";
import type { VehicleOffer } from "./types";
import type { CurrencyRateSnapshot } from "./rates";
import { GREEN_CORNER_SOURCE } from "./green-corner-contract";
export function greenCornerFobPrice(row:any,now:string):number {
 const base=Number(row.priceInJapan), expiry=row.discountExpiresAt;
 if(expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry)<=Date.parse(now)))return base;
 const explicit=Number(row.discountPrice), percent=Number(row.discount);
 if(Number.isFinite(explicit)&&explicit>0&&explicit<base)return explicit;
 return Number.isFinite(percent)&&percent>0&&percent<100 ? Math.ceil(base*(1-percent/100)) : base;
}
export function normalizeGreenCorner(row: any, unitRate: CurrencyRateSnapshot, now = new Date().toISOString()): VehicleOffer {
 const sourcePrice=greenCornerFobPrice(row,now)+Number(row.cifFreightJpy), year=Number(row.year), powerHp=Number(row.horsepower);
 if(!/^\d+$/.test(String(row.id)) || row.isSold!==false || row.location!=="japan" || !["auto","oneprice"].includes(row.subgroup)
  || !Number.isFinite(row.cifFreightJpy) || row.cifFreightJpy<0
  || row.priceInJapanCurrency!=="JPY" || !(sourcePrice>0) || !Number.isFinite(sourcePrice)
  || !Number.isInteger(year) || year<1950 || year>new Date(now).getUTCFullYear()+1
  || !String(row.company||"").trim() || !String(row.model||"").trim()) throw Error("green_invalid_listing");
 if(unitRate.currency!=="JPY" || !["cbr","cbr_live"].includes(unitRate.rateSource) || !(unitRate.effectiveRate>0)
  || !Number.isFinite(Date.parse(unitRate.rateDate)) || Math.abs(Date.parse(now)-Date.parse(unitRate.rateDate))>4*86400000) throw Error("green_invalid_currency_rate");
 const urls=[...new Set<string>((Array.isArray(row.media)?row.media:[]).filter((url:unknown)=>{
  try{const u=new URL(String(url));return u.protocol==="https:"&&u.hostname==="img.akebono.world"&&!u.port&&!u.username&&!u.password&&/\.(jpe?g|png|webp)$/i.test(u.pathname);}catch{return false;}
 }))];
 if(!urls.length)throw Error("green_missing_photos");
 const quote=row.paymentQuote;
 if(!(quote?.sell>0) || !(quote?.nominal>0) || !Number.isFinite(Date.parse(quote.fetchedAt)))throw Error("green_invalid_payment_quote");
 const paymentRate={...unitRate,effectiveRate:quote.sell/quote.nominal,cbrRate:quote.sell,nominal:quote.nominal,rateSource:"atb_akebono" as const,rateDate:quote.fetchedAt,fetchedAt:quote.fetchedAt};
 const baseRub=Math.round(sourcePrice*paymentRate.effectiveRate);
 const text=(value:unknown)=>typeof value==="string"&&value.trim()?value.trim():undefined;
 const productionDate=text(row.dateOfManufacture);
 const validDate=productionDate && /^\d{4}-\d{2}-\d{2}$/.test(productionDate) && Number.isFinite(Date.parse(productionDate))
  && new Date(productionDate).toISOString().slice(0,10)===productionDate && productionDate.slice(0,4)===String(year) ? productionDate : undefined;
 const sourceUrl=`https://akebono.world/green/lots/${row.id}`;
 const details=[
  ["Дата выпуска",text(row.dateOfManufacture)], ["Коробка передач (код источника)",text(row.transmission)],
  ["Привод",text(row.driveType)], ["Цвет",text(row.color)], ["Код кузова",text(row.frame)],
  ["Код модели",text(row.modelType)], ["Оценка",text(row.scores)], ["Оснащение (коды источника)",text(row.equipment)],
  ["Экспортный сертификат",typeof row.hasExportCertificate==="boolean"?(row.hasExportCertificate?"Есть":"Нет"):undefined]
 ].flatMap(([name,value])=>value?[{name:name!,value}]:[]);

 return withGreenCornerFuel({
  id:`green-${row.id}`,sourceId:GREEN_CORNER_SOURCE,sourceOfferId:String(row.id),market:"japan",
  offerType:"fixed",priceMode:"fixed",status:"active",catalogKind:"listing",
  make:String(row.company).trim().replace(/MERCEDES\s*-\s*BENZ/i,"Mercedes-Benz"),model:String(row.model).trim(),trim:String(row.modelGrade||"").trim(),year,
  ...(Number(row.mileageNum)>=0&&row.mileageNum!=null?{mileageKm:Math.round(Number(row.mileageNum)*1000)}:{}),
  ...(Number(row.engineVolumeNum)>0?{engineCc:Number(row.engineVolumeNum)}:{}),
  ...(Number.isFinite(powerHp)&&powerHp>0?{powerHp,powerDataConfidence:"source_exact",powerDataSource:"Akebono"}:{}),
  fuel:text(row.fuel),
  color:text(row.color), productionDate:validDate,
  transmission:text(row.transmission), drive:({FF:"fwd",FR:"rwd",FULLTIME4WD:"awd",PARTTIME4WD:"awd"} as Record<string,string>)[row.driveType], auctionGrade:text(row.scores),
  greenCornerInvoice:{basis:"CIF",freightJpy:row.cifFreightJpy,capturedAt:now,paymentQuote:row.paymentQuote},
  sourcePrice,sourceCurrency:"JPY",catalogPricingMode:"seller",sellerPriceRub:baseRub,totalRub:null,calculationStatus:"needs_data",
  calculationSnapshot:{currencyRate:{...paymentRate,sourcePrice,sourcePriceRub:sourcePrice*paymentRate.effectiveRate},sourcePriceRub:baseRub,pricingConfidence:"unavailable"},
  images:urls.map((url,index)=>({id:`green-${row.id}-${index}`,url,objectKey:"",size:0,checksum:"",mimeType:/\.png$/i.test(url)?"image/png":/\.webp$/i.test(url)?"image/webp":"image/jpeg"})),
  firstSeenAt:now,updatedAt:now,
  operational:{sourceUrl,sourcePublishedAt:row.createdAt,sourceVenueName:"Akebono · Зелёный угол",
   modelCode:text(row.modelType)||text(row.frame),
   sourceSpecifications:{version:1,sourceId:GREEN_CORNER_SOURCE,sourceOfferId:String(row.id),specificationId:`green-${row.id}`,sourceUrl,capturedAt:now,groups:[{name:"Характеристики Akebono",items:details}]}}

 });
}
