import {createHash,randomUUID} from 'node:crypto';
import type {AuthUser} from '../auth';
import {isPlatformTeam} from '../platform-access';
import {getJsonStorage,mutateDataJson} from '../data';
import {fuelFilterKey,EncyclopediaInputError,cleanText,cleanVariant,numberFields,textFields,safeUrl,type Variant,type ModelRecord,type ModelSummary,type EncyclopediaManifest} from './schema';
export const ROOT='knowledge/encyclopedia/v1';
export const MANIFEST=`${ROOT}/manifest.json`;
export const canEditEncyclopedia=(user:AuthUser|null|undefined)=>isPlatformTeam(user)&&['owner','admin'].includes(user!.role);
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
export const token=(v:unknown)=>cleanText(v).normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
export const modelId=(make:string,model:string)=>hash(`${token(make)}:${token(model)}`);
export function variantSignature(row:Partial<Variant>){return JSON.stringify([...textFields.filter(x=>!['notes','sourceUrl'].includes(x)).map(x=>token(row[x])),...numberFields.map(x=>row[x]??null)]);}
export function summarize(record:ModelRecord,key:string):ModelSummary{return {id:record.id,make:record.make,model:record.model,photo:record.photo,photoMarket:record.photoMarket,hasUnknownYear:record.variants.some(v=>!v.year),years:[...new Set(record.variants.flatMap(v=>v.year?[v.year]:[]))].sort((a,b)=>b-a),fuels:[...new Set(record.variants.flatMap(v=>v.fuel?[fuelFilterKey(v.fuel)]:[]))],markets:[...new Set(record.variants.flatMap(v=>v.markets))],variants:record.variants.length,verified:record.variants.filter(v=>v.status==='verified').length,power30:record.variants.filter(v=>v.power30MinKw!==undefined).length,needs30:record.variants.filter(v=>/electric|hybrid|hev/i.test((v.fuel||'')+' '+(v.powertrainKind||''))&&v.power30MinKw===undefined).length,key,revision:record.revision,updatedAt:record.updatedAt};}
export const readEncyclopedia=()=>getJsonStorage().readJson<EncyclopediaManifest|null>(MANIFEST,null);
export async function readModel(id:string,manifest?:EncyclopediaManifest|null){if(!/^[a-f0-9]{24}$/.test(id))return null;const m=manifest===undefined?await readEncyclopedia():manifest;const summary=m?.models.find(x=>x.id===id);return summary?getJsonStorage().readJson<ModelRecord|null>(summary.key,null):null;}
export class EncyclopediaConflict extends Error{}
export async function editModel(id:string,input:Record<string,unknown>,user:AuthUser){
 if(!canEditEncyclopedia(user))throw new EncyclopediaInputError('Доступ запрещён.');
 const manifest=await readEncyclopedia();const current=await readModel(id,manifest);
 if(!manifest||!current)throw new EncyclopediaInputError('Модель не найдена.');
 if(input.revision!==current.revision)throw new EncyclopediaConflict('Запись уже изменена. Обновите страницу перед сохранением.');
 const next:ModelRecord={...current,variants:current.variants.map(v=>({...v})),revision:randomUUID(),updatedAt:new Date().toISOString(),editedBy:user.id,previousKey:manifest.models.find(x=>x.id===id)!.key};
 if(input.action==='model'){
  const make=cleanText(input.make,80),model=cleanText(input.model,100);if(!make||!model)throw new EncyclopediaInputError('Укажите марку и модель.');
  if(manifest.models.some(x=>x.id!==id&&token(x.make)===token(make)&&token(x.model)===token(model)))throw new EncyclopediaInputError('Такая модель уже есть в энциклопедии.');
  const photo=safeUrl(input.photo);if(input.photo&&!photo)throw new EncyclopediaInputError('Проверьте ссылку на фото.');Object.assign(next,{make,model,photo});
 }else{
  const raw=input.variant;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new EncyclopediaInputError('Проверьте параметры.');
  const v=raw as Record<string,unknown>,clean=cleanVariant(v),old=next.variants.find(x=>x.id===v.id);
  if(v.id&&!old)throw new EncyclopediaInputError('Модификация не найдена.');
  const changed:Variant={...clean,id:old?.id||randomUUID(),observedCount:old?.observedCount||0};
  if(next.variants.some(x=>x.id!==changed.id&&variantSignature(x)===variantSignature(changed)))throw new EncyclopediaInputError('Модификация с такими параметрами уже есть.');
  next.variants=old?next.variants.map(x=>x.id===old.id?changed:x):[...next.variants,changed];
 }
 const key=`${ROOT}/revisions/${id}/${next.revision}.json`;await getJsonStorage().writeJson(key,next,{ifNoneMatch:'*'});
 await mutateDataJson<EncyclopediaManifest|null>(MANIFEST,null,m=>{
  if(!m||m.models.find(x=>x.id===id)?.revision!==input.revision)throw new EncyclopediaConflict('Запись уже изменена. Обновите страницу перед сохранением.');
  if(m.models.some(x=>x.id!==id&&token(x.make)===token(next.make)&&token(x.model)===token(next.model)))throw new EncyclopediaConflict('Такая модель уже существует.');
  return {...m,updatedAt:next.updatedAt,models:m.models.map(x=>x.id===id?summarize(next,key):x)};
 });return next;
}
export async function createModel(input:Record<string,unknown>,user:AuthUser){
 if(!canEditEncyclopedia(user))throw new EncyclopediaInputError('Доступ запрещён.');
 const make=cleanText(input.make,80),model=cleanText(input.model,100);if(!make||!model)throw new EncyclopediaInputError('Укажите марку и модель.');
 const photo=safeUrl(input.photo);if(input.photo&&!photo)throw new EncyclopediaInputError('Проверьте ссылку на фото.');
 const id=modelId(make,model),now=new Date().toISOString(),record:ModelRecord={id,make,model,photo,updatedAt:now,revision:randomUUID(),variants:[],editedBy:user.id};
 const key=`${ROOT}/revisions/${id}/${record.revision}.json`;await getJsonStorage().writeJson(key,record,{ifNoneMatch:'*'});
 await mutateDataJson<EncyclopediaManifest|null>(MANIFEST,null,m=>{if(!m)throw new EncyclopediaInputError('Дождитесь первого снимка энциклопедии.');if(m.models.some(x=>x.id===id||token(x.make)===token(make)&&token(x.model)===token(model)))throw new EncyclopediaInputError('Такая модель уже есть в энциклопедии.');return {...m,updatedAt:now,models:[...m.models,summarize(record,key)].sort((a,b)=>`${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`,'ru'))};});return record;
}
