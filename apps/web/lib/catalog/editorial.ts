import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
import {DetailReadCache} from './detail-read-cache';
import type {VehicleOffer} from './types';
import {editorialSpecificationOptions,type EditorialSpecifications} from './editorial-specifications';

export type EditorialStatus='visible'|'hidden'|'archived';
export type CatalogEditorialEntry={
 id:string; market:VehicleOffer["market"]; sourceId:string; sourceOfferId:string; make:string; model:string;
 title:string; photos:string[]|null; status:EditorialStatus; reason:string;
 specifications?:EditorialSpecifications;
 version:string; updatedAt:string; updatedBy:string; updatedByName:string;
 originalTitle:string; originalPhoto:string;
};
export type CatalogEditorialIndex={revision:string;entries:Record<string,CatalogEditorialEntry>};
const path='catalog-editorial/current.json';
const empty:CatalogEditorialIndex={revision:'0',entries:{}};
const reads=new DetailReadCache<CatalogEditorialIndex>({maxEntries:1,maxBytes:8*1024*1024,ttlMs:5_000,concurrency:1});
const context=new AsyncLocalStorage<CatalogEditorialIndex>();
export const readCatalogEditorial=()=>reads.get(path,()=>readDataJson(path,empty));
export function resetCatalogEditorialCache(){reads.clear();}
export async function withCatalogEditorial<T>(fn:()=>Promise<T>):Promise<T>{
 if(context.getStore())return fn();
 return context.run(await readCatalogEditorial(),fn);
}
export const editorialRevision=()=>context.getStore()?.revision||'0';
export const editorialEntries=()=>Object.values(context.getStore()?.entries||{});
type Identity={id:string;market?:string;sourceId?:string;sourceOfferId?:string};
export function matchingEditorial(offer:Identity,index=context.getStore()):CatalogEditorialEntry|undefined{
 const entry=index&&Object.hasOwn(index.entries,offer.id)?index.entries[offer.id]:undefined;
 if(!entry || (offer.market&&entry.market!==offer.market))return;
 // Projections deliberately omit private source fields; their stable ID is
 // derived from sourceId/sourceOfferId. Full records additionally check both.
 if(offer.sourceId && offer.sourceId!=='public_projection' && offer.sourceId!==entry.sourceId)return;
 if(offer.sourceId && offer.sourceId!=='public_projection' && offer.sourceOfferId && offer.sourceOfferId!==entry.sourceOfferId)return;
 return entry;
}
export function editorialHidden(offer:Identity,index=context.getStore()){
 const entry=matchingEditorial(offer,index);return !!entry&&entry.status!=='visible';
}
export function editorialHasHidden(market?:string){return editorialEntries().some(e=>e.status!=='visible'&&(!market||market==='any'||e.market===market));}
export function applyCatalogEditorial<T extends Identity>(offer:T,index=context.getStore()):T{
 const entry=matchingEditorial(offer,index);if(!entry)return offer;
 return {...applyCatalogEditorialSpecifications(offer,index),...(entry.title?{editorialTitle:entry.title}:{}),...(entry.photos?{
  cardImageUrl:entry.photos[0],images:entry.photos.map((url,i)=>({id:`editorial-${i}`,url,mimeType:'image/webp',size:0})),
 }: {})};
}
export function applyCatalogEditorialSpecifications<T extends Identity>(offer:T,index=context.getStore()):T{
 const specifications=matchingEditorial(offer,index)?.specifications;
 return specifications&&Object.keys(specifications).length?{...offer,...specifications,editorialSpecifications:specifications}:offer;
}
export class EditorialConflict extends Error {constructor(){super('Объявление уже изменено другим сотрудником. Обновите страницу перед сохранением.');}}
export class EditorialInputError extends Error {}
export function cleanEditorialInput(input:Record<string,unknown>,allowedPhotos:ReadonlySet<string>=new Set()){
 if(!['visible','hidden','archived'].includes(String(input.status)))throw new EditorialInputError('Выберите статус объявления.');
 if(typeof input.title!=='string'||input.title.length>200||typeof input.reason!=='string'||input.reason.length>500)throw new EditorialInputError('Название — до 200 символов, комментарий — до 500.');
 const title=input.title.trim().replace(/[\u0000-\u001f\u007f]/g,'');
 const photos=input.photos;
 if(photos!==null&&(!Array.isArray(photos)||photos.length<1||photos.length>30||photos.some(p=>typeof p!=='string'||(!/^\/api\/site-media\/[a-f0-9]{64}$/.test(p)&&!allowedPhotos.has(p)))))throw new EditorialInputError('Загрузите от 1 до 30 фотографий.');
 if(input.version!==null&&(typeof input.version!=='string'||input.version.length>100))throw new EditorialInputError('Обновите страницу перед сохранением.');
 let specifications:EditorialSpecifications|undefined;
 if(input.specifications!==undefined){
  if(!input.specifications||typeof input.specifications!=='object'||Array.isArray(input.specifications))throw new EditorialInputError('Проверьте характеристики автомобиля.');
  specifications={};
  for(const [key,value] of Object.entries(input.specifications)){
   if(!['bodyType','drive','transmission','color'].includes(key)||typeof value!=='string')throw new EditorialInputError('Проверьте характеристики автомобиля.');
   const clean=value.trim().replace(/[\u0000-\u001f\u007f]/g,'');
   if(!clean)continue;
   if(key==='color' ? clean.length>60 : !editorialSpecificationOptions[key as keyof typeof editorialSpecificationOptions].some(option=>option[0]===clean))throw new EditorialInputError('Выберите характеристику из списка. Цвет — до 60 символов.');
   specifications[key as keyof EditorialSpecifications]=clean;
  }
 }
 return {title,reason:input.reason.trim(),status:input.status as EditorialStatus,photos:photos as string[]|null,version:input.version as string|null,specifications};
}
export async function saveCatalogEditorial(offer:Pick<VehicleOffer,"id"|"market"|"sourceId"|"sourceOfferId"|"make"|"model">&{images:{url:string}[]},input:ReturnType<typeof cleanEditorialInput>,actor:{id:string;displayName:string},originalTitle:string){
 const next:CatalogEditorialEntry={id:offer.id,market:offer.market,sourceId:offer.sourceId,sourceOfferId:offer.sourceOfferId,
  make:offer.make,model:offer.model,title:input.title,photos:input.photos,status:input.status,reason:input.reason,
  version:randomUUID(),updatedAt:new Date().toISOString(),updatedBy:actor.id,updatedByName:actor.displayName,
  originalTitle,originalPhoto:offer.images[0]?.url||''};
 await mutateDataJson<CatalogEditorialIndex>(path,empty,current=>{
  const previous=Object.hasOwn(current.entries,offer.id)?current.entries[offer.id]:undefined;
  if((previous?.version||null)!==input.version)throw new EditorialConflict();
  if(previous&&!matchingEditorial(offer,current))throw new EditorialConflict();
  next.specifications=input.specifications??previous?.specifications;
  const result={revision:next.version,entries:{...current.entries,[offer.id]:next}};
  if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw new Error('catalog_editorial_capacity');
  return result;
 });
 reads.clear();return next;
}
