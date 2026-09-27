import {extractSource,readSource,sourceUrl} from './source';
import {sourceIdentity} from './sources';
import {DetailReadCache} from '../catalog/detail-read-cache';
import {canonicalSourceFuel} from '../catalog/powertrain-safety';
export type SourceDraft=ReturnType<typeof extractSource> & {message?:string;notes?:string[];facts?:{label:string;value:string}[];capturedAt?:string};
const cache=new DetailReadCache<SourceDraft>({maxEntries:100,maxBytes:2_000_000,ttlMs:60_000,concurrency:4});
let pendingLoads=0;
const positive=(x:unknown)=>Number.isFinite(Number(x))&&Number(x)>0?String(x):'';
function fromRow(row:any,url:string,market:string):SourceDraft {
 const draft:Record<string,string>={};for(const key of ['year','engineCc','powerHp','powerKw'])if(positive(row[key]))draft[key]=positive(row[key]);
 if(/^\d{4}-?\d{2}/.test(row.productionDate||'')){const date=String(row.productionDate).replace(/-/g,'');draft.year=date.slice(0,4);draft.productionMonth=String(Number(date.slice(4,6)));}
 const fuel=canonicalSourceFuel(row.fuel);if(fuel)draft.fuel=fuel;
 return {title:[row.make,row.model,row.trim].filter(Boolean).join(' ')||row.title||'',make:row.make||'',model:row.model||'',market,price:positive(row.price??row.sourcePrice),currency:row.currency||row.sourceCurrency||'',draft,url,images:[...new Map([...(row.images||[])].reverse().map((x:any)=>[/dubicars\.com\//.test(typeof x==='string'?x:x.url)?String(typeof x==='string'?x:x.url).split('/').at(-1):String(typeof x==='string'?x:x.url),typeof x==='string'?x:x.url])).values()].reverse().filter(x=>typeof x==='string') as string[],facts:[['Пробег, км',row.mileageKm],['Коробка передач',row.transmission],['Привод',row.drive]].filter(([,v])=>v).map(([label,value])=>({label:String(label),value:String(value)})),notes:[]};
}
export async function extractKnownSource(html:string,url:string):Promise<SourceDraft>{
 const base:SourceDraft=extractSource(html,url),identity=sourceIdentity(url);
 if(identity?.ids[0]==='dubicars_uae_exact'){
  const {parseDubicarsCurrentListing}=await import('../catalog/dubicars-current-source');const row=parseDubicarsCurrentListing(html,url);
  if(row){const data=fromRow(row,url,'uae');if(row.semanticEvidence?.engineCc.status==='ambiguous')data.notes!.push(`Источник указывает объём: ${row.semanticEvidence.engineCc.rawValues.join(', ')}. Уточните точный объём в см³.`);return data;}
 }
 if(identity?.ids[0]==='autoscout_europe_open'){
  const script=html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  const d=script?JSON.parse(script)?.props?.pageProps?.listingDetails:null;
  if(d?.id===identity.id){const v=d.vehicle||{};const {parseAutoScoutDetailGallery}=await import('../catalog/autoscout-hq-source');
   const data=fromRow({make:v.make,model:v.model,trim:v.modelVersionInput,price:d.prices?.public?.onRequestOnly?undefined:d.prices?.public?.priceRaw,currency:/€/.test(d.prices?.public?.price||'')?'EUR':'',engineCc:v.rawDisplacementInCCM,powerHp:v.rawPowerInHp,powerKw:v.rawPowerInKw,fuel:v.fuelCategory?.formatted,mileageKm:v.mileageInKmRaw,transmission:v.transmissionType,drive:v.driveTrain,images:parseAutoScoutDetailGallery(html,identity.id)},url,'europe');
   if(v.firstRegistrationDate)data.notes!.push(`Первая регистрация: ${v.firstRegistrationDate}. Уточните год и месяц выпуска — это не всегда одна дата.`);return data;
  }
 }
 if(identity?.ids[0]==='proauctions_japan_stat'){
  const {parseProAuctionsDetailEvidence}=await import('../catalog/proauctions-detail-evidence');const row=parseProAuctionsDetailEvidence(html,url);const s=row.specifications;
  const data=fromRow({title:row.identity.name,year:row.identity.year,price:row.price.saleConfirmed?row.price.amountJpy:undefined,currency:'JPY',fuel:s.powertrain==='hybrid'?'hybrid':s.fuel,powerHp:s.powertrain==='combustion'?s.reportedCombustionPowerHp:undefined,images:row.imageUrls,mileageKm:s.mileageKm,transmission:s.transmission},url,'japan');
  if(s.reportedEngineCc)data.notes!.push(`Объём по аукциону: ${s.reportedEngineCc} см³; возможное округление. Уточните по документам.`);return data;
 }
 return base;
}
async function savedSource(url:string):Promise<SourceDraft|null>{
 const identity=sourceIdentity(url);if(!identity)return null;
 const {getOfferFromCurrentShard,stableOfferId}=await import('../catalog/storage');
 for(const source of identity.ids){const offer=await getOfferFromCurrentShard(stableOfferId(source,identity.id)).catch(()=>null);
  if(!offer||offer.sourceId!==source||String(offer.sourceOfferId)!==identity.id||offer.market!==identity.market||offer.status!=='active')continue;
  // Use the admitted, identity-bound snapshot, never scan or rebuild a market.
  const data=fromRow(offer,url,identity.market);data.capturedAt=offer.updatedAt;
  data.message=`Использованы сохранённые данные АвтоЦены от ${new Date(offer.updatedAt).toLocaleDateString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}. Проверьте актуальность цены в объявлении.`;return data;
 }return null;
}
export async function loadSource(value:string):Promise<SourceDraft>{
 const url=sourceUrl(value).href;
 if(pendingLoads>=8)throw Error('Сейчас загружается много объявлений. Повторите через несколько секунд.');
 pendingLoads++;
 try{return await cache.get(url,async()=>{
  const identity=sourceIdentity(url);const signal=AbortSignal.timeout(18000);
  try{
   let data:SourceDraft;
   if(identity?.ids[0]==='kcar_korea_open'){
    const page=await readSource(`https://api.kcar.com/bc/car-info-detail-of-ng?i_sCarCd=${identity.id}&i_sPassYn=N`,signal,0,'json');const payload=JSON.parse(page.html),d=payload.data?.data||payload.data;
    const {kcarSpecificationEvidence,exactVehicleGallery}=await import('../catalog/kcar-exact-source');const r=d?.rvo;if(r?.carCd!==identity.id||r.statCd!=='CAR_STATUS010')throw Error('Объявление недоступно');
    const e=kcarSpecificationEvidence({regModelYear:r.regModelyr,manufactureDate:r.mfgDt,fuelName:r.fuelTypecdNm,rawFuelType:r.fuelType,engineDisplacement:r.engdispmnt,horsepower:r.hrspow});
    data=fromRow({make:r.mnuftrNm,model:r.modelNm,trim:r.grdFullNm,year:e.year.value,productionDate:r.mfgDt,engineCc:e.engineCc.value,powerHp:e.powerHp.value,fuel:e.fuel.value,price:Number(r.salprc)*10000,currency:'KRW',mileageKm:r.milg,transmission:r.trnsmsncdNm,images:exactVehicleGallery(d,identity.id)},url,'korea');
   }else{const page=await readSource(url,signal);data=await extractKnownSource(page.html,page.url);}
   if(!data.price&&!Object.keys(data.draft).length)throw Error('Не получены характеристики объявления');
   return {...data,capturedAt:new Date().toISOString(),message:'Данные получены из объявления. Проверьте характеристики и заполните недостающее.'};
  }catch{
   const saved=await savedSource(url);if(saved)return saved;
   return {title:'',make:'',model:'',market:identity?.market||'',price:'',currency:'',images:[],draft:{},url,message:'Не получилось загрузить объявление: источник не отдал данные. Попробуйте другую ссылку или введите характеристики вручную.'};
  }
 });}finally{pendingLoads--;}
}
