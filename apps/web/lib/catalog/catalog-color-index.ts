import {AsyncLocalStorage} from 'node:async_hooks';
import {getJsonStorage,readDataJson} from '../data';
import {DetailReadCache} from './detail-read-cache';
import {matchingEditorial,readCatalogEditorial} from './editorial';
import {namedVehicleColor} from './vehicle-colors';
export const colorName=(value:unknown)=>{const text=String(value??'').trim().replace(/\s+/g,' ');return namedVehicleColor(text)?.[0]||text;};
const colorKeys=new Map<string,string>();
export function colorKey(value:unknown){const raw=String(value??'');const cached=colorKeys.get(raw);if(cached!==undefined)return cached;const normalized=colorName(raw).toLocaleLowerCase('ru').replaceAll('ё','е');if(raw.length<=256){if(colorKeys.size>=512)colorKeys.delete(colorKeys.keys().next().value!);colorKeys.set(raw,normalized);}return normalized;}
const selections=new Map<string,Set<string>>();
function selectedColors(value:string){let selected=selections.get(value);if(!selected){selected=new Set(value.split('|').map(colorKey));if(value.length<=2048){if(selections.size>=64)selections.delete(selections.keys().next().value!);selections.set(value,selected);}}return selected;}
export type CatalogColorIndex={generationId:string;rows:Array<[string,string,string]>};
export function buildCatalogColorIndex(generationId:string,rows:Array<{id:string;market:string;color?:string}>):CatalogColorIndex{return {generationId,rows:rows.filter(row=>Boolean(row.color?.trim())).map(row=>[row.id,row.market,colorName(row.color)])};}
const cache=new DetailReadCache<CatalogColorIndex>({maxEntries:2,maxBytes:32*1024*1024,ttlMs:300000,concurrency:2});
const context=new AsyncLocalStorage<Map<string,string>>();
const lookupMaps=new WeakMap<CatalogColorIndex,Map<string,string>>();
export async function readCatalogColorIndex(){const manifest=await readDataJson<{generationId:string}>('catalog/manifest.json',{generationId:''});return cache.get(manifest.generationId,async()=>{const index=await readDataJson<CatalogColorIndex|null>(`catalog/generations/${manifest.generationId}/indexes/colors-v1.json`,null);if(!index||index.generationId!==manifest.generationId)throw Error('catalog_colors_not_ready');return index;});}
export async function withCatalogColorFilter<T>(params:{color?:string},fn:()=>Promise<T>){if(!params.color||context.getStore())return fn();const index=await readCatalogColorIndex();let map=lookupMaps.get(index);if(!map){map=new Map(index.rows.map(([id,,color])=>[id,color]));lookupMaps.set(index,map);}return context.run(map,fn);}
export function matchesCatalogColor(row:{id?:string;market?:string;color?:string},value?:string){if(!value)return true;const edited=row.id?matchingEditorial(row as {id:string;market?:string})?.specifications?.color:undefined;const color=edited??row.color??(row.id?context.getStore()?.get(row.id):undefined);return !!color&&selectedColors(value).has(colorKey(color));}
export async function localCatalogColors(markets:string[]){const index=await readCatalogColorIndex();const editorial=await readCatalogEditorial();return [...new Set(index.rows.filter(([,market])=>markets.includes(market)).map(([id,,color])=>colorName(editorial.entries[id]?.specifications?.color??color)).concat(Object.values(editorial.entries).filter(e=>markets.includes(e.market)&&e.status==='visible'&&e.specifications?.color).map(e=>colorName(e.specifications!.color))))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru'));}
export async function prepareCatalogColorIndex(){
 const storage=getJsonStorage();const manifest=await storage.readJson<any>('catalog/manifest.json',null);if(!manifest?.generationId)throw Error('catalog_manifest_missing');
 const path=`catalog/generations/${manifest.generationId}/indexes/colors-v1.json`;
 if((await storage.readJson<CatalogColorIndex|null>(path,null))?.generationId===manifest.generationId)return {ready:true,reused:true};
 const tasks=Object.entries(manifest.markets as Record<string,{chunks:string[]}>).flatMap(([market,v])=>v.chunks.map(chunk=>({market,path:chunk.startsWith('catalog/')?chunk:`catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`})));let cursor=0;const rows:CatalogColorIndex['rows']=[];
 await Promise.all(Array.from({length:4},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];const offers=await storage.readJson<any[]|null>(task.path,null);if(!offers)throw Error('catalog_color_chunk_missing');rows.push(...buildCatalogColorIndex(manifest.generationId,offers).rows);}}));
 if((await storage.readJson<any>('catalog/manifest.json',null))?.generationId!==manifest.generationId)throw Error('catalog_generation_changed');
 await storage.writeJson(path,{generationId:manifest.generationId,rows});return {ready:true,rows:rows.length};
}
