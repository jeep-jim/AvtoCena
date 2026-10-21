import {PUBLIC_MIN_VEHICLE_YEAR} from '../catalog/public-year-range';
import {autoCalcMake,splitAutoCalcIdentity} from './identity';
import {matchesCatalogModel} from '../catalog/model-filter';
import {readDirectoryModels,catalogModelSlug} from '../catalog/model-directory';
import {readCompiledKnowledgeVariants} from '../catalog/knowledge-read-model';
import {recallVehicleMemory} from '../catalog/knowledge-memory';
import {findAutocatalogPublishedCover,autocatalogCoverUrl} from '../catalog/autocatalog-publication';
import {searchOffers} from '../catalog/storage';
import {catalogBrandSlug,canonicalCatalogBrand} from '../catalog/brands';
import {vehicleKnowledgeToken,vehicleKnowledgeCompact} from '../catalog/vehicle-knowledge';
import {canonicalSourceFuel} from '../catalog/powertrain-safety';
import {DetailReadCache} from '../catalog/detail-read-cache';
export type KnowledgeChoice={id:string;make?:string;model?:string;title:string;kind:'reference'|'catalog'|'memory';label:string;sourceUrl?:string;date?:string;market?:string;price?:string;currency?:string;image?:string;draft:Record<string,string>};
export type KnowledgeMatches={models:{id:string;title:string;href:string}[];choices:KnowledgeChoice[];image?:string;imageLabel?:string};
const cache=new DetailReadCache<KnowledgeMatches>({maxEntries:100,maxBytes:2*1024*1024,ttlMs:60000,concurrency:2});
// Aliases are compared as complete model names before considering prefixes.
export function matchingKnowledgeModels(models:any[],query:string,selectedMake?:string){
 const identity=splitAutoCalcIdentity(query);
 const make=autoCalcMake(selectedMake||identity.make);
 const q=vehicleKnowledgeToken(identity.make ? identity.model : query);
 const letters:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
 const requested=[...new Set([q,q.replace(/[а-яё]/g,c=>letters[c]??c)])];
 const scope=models.filter(model=>(!make||autoCalcMake(model.make)===make)
  && autoCalcMake(model.model)!==autoCalcMake(model.make));
 if(!q)return make?scope.slice(0,6):[];
 if(q.length<2)return [];
 const names=(model:any)=>[model.model,...(model.aliases||[])].map(value=>vehicleKnowledgeToken(value)).filter(Boolean);
 const exact=scope.filter(model=>names(model).some(name=>requested.some(value=>vehicleKnowledgeCompact(value)===vehicleKnowledgeCompact(name))));
 if(exact.length)return exact.slice(0,6);
 const longer=scope.filter(model=>names(model).some(name=>requested.some(value=>value.startsWith(name+' '))));
 if(longer.length){const length=Math.max(...longer.map(model=>vehicleKnowledgeToken(model.model).length));return longer.filter(model=>vehicleKnowledgeToken(model.model).length===length).slice(0,6);}
 return scope.filter(model=>names(model).some(name=>requested.some(value=>name.startsWith(value)))).slice(0,6);
}
export function knowledgeDraft(row:any){
 const draft:Record<string,string>={};const fuel=canonicalSourceFuel(row.fuel);if(fuel)draft.fuel=fuel;
 if(Number(row.year)>=PUBLIC_MIN_VEHICLE_YEAR)draft.year=String(row.year);
 if(Number(row.engineCc)>0)draft.engineCc=String(row.engineCc);
 // Hybrid total/system power is not combustion or 30-minute power. Never infer either.
 if(fuel==='petrol'||fuel==='diesel'){if(Number(row.powerHp)>0)draft.powerHp=String(row.powerHp);if(Number(row.powerKw)>0)draft.powerKw=String(row.powerKw);}
 return draft;
}
export async function findAutoCalcKnowledge(query:string,year?:number,market?:string,make?:string):Promise<KnowledgeMatches>{
 const q=query.trim().slice(0,180);if(q.length<2 || year && year<PUBLIC_MIN_VEHICLE_YEAR)return {models:[],choices:[]};
 return cache.get(JSON.stringify([q,year,market,make]),async()=>{
  const models=matchingKnowledgeModels(await readDirectoryModels(),q,make);
  const result:KnowledgeMatches={models:models.map(m=>({id:m.id,title:`${m.make} ${m.model}`,href:`/cars/brand/${catalogBrandSlug(m.make)}/model/${catalogModelSlug(m)}`})),choices:[]};
  if(models.length!==1)return result;
  const model=models[0];
  const [variants,live,memory,cover]=await Promise.all([
   readCompiledKnowledgeVariants(model.make),
   searchOffers({make:model.make,model:model.model,...(market?{market}:{}),yearFrom:year||PUBLIC_MIN_VEHICLE_YEAR,...(year?{yearTo:year}:{}),pageSize:12,sort:'updatedAt'}),
   recallVehicleMemory(model.make,model.model).catch(()=>[]),
   findAutocatalogPublishedCover(model.id).catch(()=>null),
  ]);
  const sameModel=(r:any)=>canonicalCatalogBrand(r.make)===canonicalCatalogBrand(model.make)&&[model.model,...(model.aliases||[])].some(n=>vehicleKnowledgeCompact(n)===vehicleKnowledgeCompact(r.model));
  const sameLiveModel=(r:any)=>canonicalCatalogBrand(r.make)===canonicalCatalogBrand(model.make)&&[model.model,...(model.aliases||[])].some(n=>matchesCatalogModel(r.model,n));
  const seen=new Set<string>();
  const add=(choice:KnowledgeChoice)=>{const key=JSON.stringify([choice.kind,choice.market,choice.draft,choice.price,choice.currency]);if(!seen.has(key)&&result.choices.length<12){seen.add(key);result.choices.push({...choice,make:model.make,model:model.model});}};
  for(const row of variants.filter(r=>r.status==='reference'&&Number(r.yearTo||2100)>=PUBLIC_MIN_VEHICLE_YEAR&&sameModel(r)&&(!year||Boolean(r.yearFrom)&&year>=Number(r.yearFrom)&&year<=Number(r.yearTo||2100))&&(!market||!r.market||r.market===market)).slice(0,6)){
   if(row.status!=='reference')continue;
   add({id:row.id,title:[model.make,model.model,row.name].filter(Boolean).join(' '),kind:'reference',label:'Вариант из энциклопедии — проверьте комплектацию',sourceUrl:row.sourceUrl,date:row.verifiedAt,market:row.market,draft:knowledgeDraft(row)});
  }
  for(const row of live.items.filter(row=>sameLiveModel(row)&&Number(row.year)>=PUBLIC_MIN_VEHICLE_YEAR).sort((a:any,b:any)=>Number(b.market===market)-Number(a.market===market))){
   const image=String(row.images?.[0]?.url||'');
   if(image&&!result.image){result.image=image;result.imageLabel='Фото похожего автомобиля из каталога — не вашего объявления';}
   add({id:row.id,title:`${row.make} ${row.model} ${row.year}`,kind:'catalog',label:'Аналог в каталоге · ориентировочный расчёт',sourceUrl:`/cars/offer/${row.id}`,date:row.updatedAt,market:row.market,price:row.sourcePrice?String(row.sourcePrice):undefined,currency:row.sourceCurrency||undefined,image,draft:knowledgeDraft(row)});
  }
  for(const row of memory.filter(r=>r.year>=PUBLIC_MIN_VEHICLE_YEAR&&(!year||r.year===year)&&(!market||r.market===market))){
   add({id:row.id,title:`${row.make} ${row.model} ${row.year}`,kind:'memory',label:'Сохранённый аналог · цену нужно уточнить',sourceUrl:`/cars/offer/${row.offerId}`,date:row.seenAt,market:row.market,price:row.price?String(row.price):undefined,currency:row.currency,image:row.image,draft:knowledgeDraft(row)});
  }
  if(!result.image){const image=memory.find(r=>r.year>=PUBLIC_MIN_VEHICLE_YEAR&&(!year||r.year===year)&&r.image)?.image;if(image){result.image=image;result.imageLabel='Фото сохранённого аналога — не вашего объявления';}}
  if(!result.image&&cover){result.image=autocatalogCoverUrl(cover);result.imageLabel=`Иллюстрация модели — год и комплектация могут отличаться. ${cover.attribution} (${cover.license})`;}
  return result;
 });
}
