import { createHash } from 'node:crypto';
import type { CatalogSourceAdapter, CatalogFetchResult, CatalogImage, VehicleOffer, SourceRunHealth } from './types';
import { namedTechnicalGroups } from './source-table-capture';

const BASE='https://www.drom.ru';
const SOURCE='drom_japan_stat';
const clean=(v:unknown)=>String(v??'').replace(/\s+/g,' ').trim();
const number=(v:unknown)=>Number(clean(v).replace(/[^0-9]/g,'')) || undefined;
function lotUrl(value:unknown) {
 const u=new URL(String(value),BASE);
 if(u.origin!==BASE || !/^\/world\/japan\/[a-z0-9_-]+\/[a-z0-9_-]+\/\d+\/$/.test(u.pathname))throw Error('drom_invalid_lot_url');
 return u;
}
export function dromModule(html:string,name:string):any {
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=html.match(new RegExp(`<script[^>]*data-drom-module=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`,'i'));
 if(!match)throw Error('drom_module_missing');
 return JSON.parse(match[1]);
}
async function markup(url:string) {
 const r=await fetch(url,{signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(`drom_http_${r.status}`);
 const bytes=await r.arrayBuffer();
 if(bytes.byteLength>5*1024*1024)throw Error('drom_page_too_large');
 const charset=r.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1] || 'windows-1251';
 return new TextDecoder(charset).decode(bytes);
}
function photo(url:unknown):CatalogImage[] {
 if(!url)return [];
 const u=new URL(String(url));
 if(u.protocol!=='https:' || u.hostname!=='s.auto.drom.ru' || !u.pathname.includes('/japan_auction_images/'))return [];
 return [{id:'',url:u.toString(),objectKey:'',checksum:'',size:0,mimeType:'image/jpeg'}];
}
export function dromDetail(html:string,url:string):VehicleOffer {
 const u=lotUrl(url),data=dromModule(html,'auction-statistics-lot'),lot=data.lot;
 if(String(lot?.lotId)!==u.pathname.split('/').at(-2))throw Error('drom_detail_id_conflict');
 const schemas=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>JSON.parse(m[1]));
 const cars=schemas.filter(x=>x['@type']==='Car');
 if(cars.length!==1)throw Error('drom_car_schema_ambiguous');
 const car=cars[0],make=clean(car.brand?.name),model=clean(car.name).replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+`,'i'),'');
 const description=clean(car.description),date=description.match(/Дата аукциона:\s*(\d{2})\.(\d{2})\.(\d{4})/);
 const lotNumber=description.match(/Лот\s+(\d+):/)?.[1];
 const yen=(Array.isArray(car.offers)?car.offers:[car.offers]).filter((o:any)=>o?.priceCurrency==='JPY');
 const price=Number(lot.priceYen),year=Number(car.productionDate);
 if(clean(car.bodyType)!==clean(lot.frameMark))throw Error('drom_chassis_identity_conflict');
 if(!make || !model || !lotNumber || !date || !lot.auctionName || !lot.frameMark || !Number.isInteger(year) || year<2010
  || !(price>0&&price<1e9) || yen.length!==1 || Number(yen[0].price)!==price || !html.includes('Продан за'))throw Error('drom_sold_identity_missing');
 const auctionDate=`${date[3]}-${date[2]}-${date[1]}`;
 if(new Date(auctionDate+'T00:00:00Z').toISOString().slice(0,10)!==auctionDate || Date.parse(auctionDate)>Date.now()+86400000)throw Error('drom_invalid_date');
 const images=photo(lot.image?.original || lot.image?.src2x || lot.image?.src);
 const schemaImage=typeof car.image==='string'?car.image:car.image?.url;
 const fingerprint=(v:string)=>new URL(v).pathname.match(/([a-f0-9]{40})\.jpg$/)?.[1];
 if(!images.length || !schemaImage || !fingerprint(images[0].url) || fingerprint(images[0].url)!==fingerprint(schemaImage))throw Error('drom_image_identity_conflict');
 const now=new Date().toISOString(),sourceOfferId=String(lot.lotId);
 const ev=(status:string,value?:unknown)=>({status,value,source:url,rawValues:value==null?[]:[value]});
 // Auction displacement is nominal; fuel and certified power are not supplied.
 // Preserve source labels for manual selection without inventing exact inputs.
 return {id:createHash('sha256').update(`${SOURCE}:${sourceOfferId}`).digest('hex').slice(0,24),sourceId:SOURCE,sourceOfferId,market:'japan',offerType:'auction',status:'active',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'published_result',priceMode:'fixed',sourceTitle:clean(car.name),make,model,year,trim:clean(lot.equipment)||undefined,generation:clean(lot.frameMark),mileageKm:number(lot.mileage),transmission:clean(lot.transmission),color:clean(lot.color),powertrainKind:'unknown',sourcePrice:price,sourceCurrency:'JPY',auctionName:clean(lot.auctionName),auctionDate,lotNumber,auctionGrade:clean(lot.auctionEvaluation),images,calculationStatus:'needs_data',firstSeenAt:now,updatedAt:now,totalRub:null,
 operational:{sourceUrl:url,sourceVenueName:clean(lot.auctionName),sourcePublishedAt:auctionDate,modelCode:clean(lot.frameMark),exactDetail:true,detailIdentityVerified:true,fieldIdentityVerified:true,photoIdentityVerified:true,galleryVerified:true,
 semanticEvidence:{year:ev('exact',year),engineCc:ev('ambiguous',lot.engineVolume),powerHp:ev(lot.enginePower?'ambiguous':'missing',lot.enginePower),fuel:ev('missing'),powertrainKind:ev('missing')},
 sourceSpecifications:{version:1,sourceId:SOURCE,sourceOfferId,specificationId:sourceOfferId,sourceUrl:url,capturedAt:now,groups:namedTechnicalGroups({Год:year,Кузов:lot.frameMark,Комплектация:lot.equipment,'Объём на аукционе':lot.engineVolume,'Мощность на странице':lot.enginePower,Пробег:lot.mileage,КПП:lot.transmission,Цвет:lot.color,Аукцион:lot.auctionName,Оценка:lot.auctionEvaluation},'Параметры лота')},specificationCollection:{status:'received',kind:'listing_fields'},
 raw:{finalPriceJpy:price,modelCode:lot.frameMark,nominalEngineCc:number(lot.engineVolume),listingBoundImages:true,photoIdentityVerified:true,recoveryExactSourceUrl:true,recoveryExactPhotoIdentity:true,dromLotId:sourceOfferId,sourcePriceField:'lot.priceYen; schema Offer JPY; Продан за'}}};
}
export class DromJapanAdapter implements CatalogSourceAdapter {
 sourceId=SOURCE; market='japan' as const; accessMode='public_html' as const;
 async fetchPage(cursor?:string|null):Promise<CatalogFetchResult>{
  const page=Math.max(1,Number(cursor)||1);if(!Number.isInteger(page)||page>1000)throw Error('drom_invalid_page');
  const url=`${BASE}/world/japan/${page===1?'':`page${page}/`}?yearFrom=2010`;
  const d=dromModule(await markup(url),'auction-statistics');
  if(!Array.isArray(d.lots) || Number(d.pagination?.page)!==page)throw Error('drom_pagination_invalid');
  // Fetch only links belonging to listed lots. Detail records own all fields.
  const items:VehicleOffer[]=[];let next=0,stopped=false;
  const rejectionReasons:Record<string,number>={};
  await Promise.all(Array.from({length:Math.min(4,d.lots.length)},async()=>{
   try {while(next<d.lots.length && !stopped){
    const row=d.lots[next++],u=lotUrl(row.url);
    if(String(row.lotId)!==u.pathname.split('/').at(-2))throw Error('drom_list_id_conflict');
    const html=await markup(u.toString()); // Access/network failure retries the same page.
    try {items.push(dromDetail(html,u.toString()));}
    catch(e){const reason=String((e as Error).message);rejectionReasons[reason]=(rejectionReasons[reason]||0)+1;}
   }} catch(e){stopped=true;throw e;}
  }));
  const total=Number(d.pagination.total),size=Number(d.pagination.itemsPerPage);
  if(!Number.isFinite(total)||!(size>0))throw Error('drom_pagination_missing');
  return {items,diagnostics:{listingRows:d.lots.length,rejectedRows:d.lots.length-items.length,rejectionReasons},nextCursor:d.lots.length&&page*size<total?String(page+1):null,count:total};
 }
 normalizeOffer(raw:unknown):VehicleOffer|null{return (raw as VehicleOffer)?.sourceId===SOURCE?raw as VehicleOffer:null;}
 async fetchImages(offer:VehicleOffer){return offer.images;}
 mapStatus(){return 'active' as const;}
 async healthCheck():Promise<SourceRunHealth>{try{const p=await this.fetchPage();return {ok:p.items.length>0,message:`Drom lots=${p.items.length}`,checkedAt:new Date().toISOString()};}catch(e){return {ok:false,checkedAt:new Date().toISOString(),message:String(e)};}}
}
export const dromJapanSource=new DromJapanAdapter();
