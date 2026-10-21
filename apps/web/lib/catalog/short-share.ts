import {selectionTarget,selectionTitle} from '../dealers/selection-share';
import {createHash} from 'node:crypto';
import {getJsonStorage, StorageConflictError, type JsonStorage} from '../data';
import {decodeShareDraft, encodeShareDraft} from './offer-share';

export const SHORT_SHARE_TOKEN = /^[A-Za-z0-9_-]{16}$/;
export type ShortShare = {version:1; path:string; mini:boolean} | {version:2; kind:"dealer-selection"; dealerId:string; path:string; mini:false; title?:string};
export function cleanShareTarget(value:unknown, mini:unknown, title?:unknown):ShortShare {
  if(typeof value==='string'&&value.length<=4000&&/^\/dealers\/[A-Za-z0-9_-]{1,80}(?:\?|$)/.test(value)){
    const url=new URL(value,'https://avtocena.com');
    const dealerId=url.pathname.slice('/dealers/'.length);
    return {version:2,kind:'dealer-selection',dealerId,path:selectionTarget(dealerId,url.search),mini:false,...(selectionTitle(title)?{title:selectionTitle(title)}:{})};
  }
  if(typeof value!=='string'  || value.length>4000 || !/^\/cars\/offer\/[A-Za-z0-9_%.-]+(?:\?|$)/.test(value))throw Error('invalid_share');
  const url=new URL(value,'https://avtocena.com');
  if(!/^\/cars\/offer\/[A-Za-z0-9_-]{1,240}$/.test(url.pathname))throw Error('invalid_share');
  const query=new URLSearchParams();
  for(const key of ['calculation','direct','powerHp','modificationId','estimate','dealer']){
    const item=url.searchParams.get(key);if(!item)continue;
    if(key==='estimate'){
      const draft=decodeShareDraft(item);if(!draft)throw Error('invalid_share');
      query.set(key,encodeShareDraft(draft));
    } else {
      if(!/^[A-Za-z0-9_.-]{1,160}$/.test(item))throw Error('invalid_share');
      query.set(key,item);
    }
  }
  query.set('share','3');
  return {version:1,path:url.pathname+'?'+query,mini:mini===true};
}
function storagePath(token:string){return `public-share-links/${token.slice(0,2)}/${token}.json`;}
export async function createShortShare(target:ShortShare,storage:JsonStorage=getJsonStorage()){
  const payload=JSON.stringify(target);
  for(let attempt=0;attempt<4;attempt++){
    // New car shares get a fresh preview URL; previously issued tokens keep resolving.
    const previewVersion=target.version===1?':preview-jpeg-v1':'';
    const token=createHash('sha256').update(payload+previewVersion+(attempt?`:${attempt}`:'')).digest('base64url').slice(0,16);
    const key=storagePath(token), current=await storage.readJson<ShortShare|null>(key,null);
    if(current){if(JSON.stringify(current)===payload)return `/s/${token}`;continue;}
    try{await storage.writeJson(key,target,{ifNoneMatch:'*'});return `/s/${token}`;}
    catch(error){if(!(error instanceof StorageConflictError))throw error;}
  }
  throw Error('share_conflict');
}
export async function readShortShare(token:string,storage:JsonStorage=getJsonStorage()){
  if(!SHORT_SHARE_TOKEN.test(token))return null;
  const record=await storage.readJson<ShortShare|null>(storagePath(token),null);
  if(!record || ![1,2].includes(record.version))return null;
  try{return cleanShareTarget(record.path,record.mini,record.version===2?record.title:undefined);}catch{return null;}
}
