import {getJsonStorage, StorageConflictError, type JsonStorage} from '../data';
import {COLLECTION_MARKETS,COLLECTION_SOURCES,defaultCollectionControls,collectionEnabled,type CollectionControls,type CollectionChange} from './collection-controls-schema';
export const COLLECTION_CONTROLS_KEY='catalog/operations/collection-controls-v1.json';
export class CollectionDisabledError extends Error {constructor(public sourceId:string){super(`collection_disabled_by_owner:${sourceId}`);this.name='CollectionDisabledError';}}
export class CollectionControlsConflict extends Error {}
export class CollectionControlsInputError extends Error {}
/** Missing object means documented defaults; unreadable/corrupt storage never means enabled. */
export function validateCollectionControls(value:unknown):CollectionControls {
  const v=value as CollectionControls;
  if(!v || v.version!==1 || !Number.isSafeInteger(v.revision) || v.revision<0 || !Array.isArray(v.history))throw Error('invalid_collection_controls');
  const defaults=defaultCollectionControls();
  for(const scope of ['markets','sources'] as const){
    if(!v[scope] || typeof v[scope]!=='object')throw Error('invalid_collection_controls');
    for(const id of Object.keys(defaults[scope])){
      const row=v[scope][id];
      if(!row || (typeof row.enabled!=='boolean' || [row.enabledAt,row.disabledAt].some(t=>t!==null&&!Number.isFinite(Date.parse(t)))))throw Error('invalid_collection_controls');
    }
  }
  return {...v,markets:{...defaults.markets,...v.markets},sources:{...defaults.sources,...v.sources}};
}
export async function readCollectionControls(storage:JsonStorage=getJsonStorage()) {
  const meta=await storage.readJsonWithMeta<unknown>(COLLECTION_CONTROLS_KEY,null);
  return meta.found?validateCollectionControls(meta.value):defaultCollectionControls();
}
let cache:{value:CollectionControls;until:number}|undefined;
let pending:Promise<CollectionControls>|undefined;
export function clearCollectionControlsCache(){cache=undefined;pending=undefined;}
export async function currentCollectionControls() {
  if(cache && cache.until>Date.now())return cache.value;
  if(!pending)pending=readCollectionControls().then(value=>{cache={value,until:Date.now()+5000};return value;}).finally(()=>{pending=undefined;});
  return pending;
}
export async function assertCollectionEnabled(id:string){if(!collectionEnabled(await currentCollectionControls(),id))throw new CollectionDisabledError(id);}
export async function saveCollectionSwitch(input:unknown,actor:string,storage:JsonStorage=getJsonStorage()) {
  const body=input as {scope?:unknown;id?:unknown;enabled?:unknown;revision?:unknown};
  if(!body || !['market','source'].includes(String(body.scope)) || typeof body.id!=='string' || typeof body.enabled!=='boolean' || !Number.isSafeInteger(body.revision))throw new CollectionControlsInputError('Некорректная настройка');
  const scope=body.scope as 'market'|'source',id=body.id,enabled=body.enabled;
  if(!(scope==='market'?COLLECTION_MARKETS:COLLECTION_SOURCES).some(row=>row.id===id))throw new CollectionControlsInputError('Неизвестный источник или рынок');
  const meta=await storage.readJsonWithMeta<unknown>(COLLECTION_CONTROLS_KEY,null),current=meta.found?validateCollectionControls(meta.value):defaultCollectionControls();
  if(current.revision!==body.revision)throw new CollectionControlsConflict('Настройки уже изменились. Обновите список.');
  const field=scope==='market'?'markets':'sources',before=current[field][id];
  if(before.enabled===enabled)return current;
  if(scope==='source' && enabled && ((id==='autohome_used_china_open' && current.sources.che168_feed.enabled)||(id==='che168_feed' && current.sources.autohome_used_china_open.enabled)))throw new CollectionControlsInputError('Сначала выключите другой источник подержанных авто Китая: фид и резервный парсер нельзя собирать одновременно.');
  const at=new Date().toISOString(),revision=current.revision+1;
  const event:CollectionChange={revision,at,actor,scope,id,enabled};
  const next:CollectionControls={...current,revision,updatedAt:at,[field]:{...current[field],[id]:{...before,enabled,enabledAt:enabled?at:before.enabledAt,disabledAt:enabled?before.disabledAt:at,changedBy:actor}},history:[event,...current.history].slice(0,200)};
  if(meta.found && !meta.etag)throw Error('collection_controls_missing_etag');
  try{await storage.writeJson(COLLECTION_CONTROLS_KEY,next,meta.found?{ifMatch:meta.etag!}:{ifNoneMatch:'*'});}
  catch(error){if(error instanceof StorageConflictError)throw new CollectionControlsConflict('Настройки уже изменились. Обновите список.');throw error;}
  clearCollectionControlsCache();
  return next;
}
