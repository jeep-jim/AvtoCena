import {getJsonStorage} from '../apps/web/lib/data';
import {isIP} from 'node:net';
import {ajesQuery,ajesCatalogQuery} from '../apps/web/lib/catalog/ajes-query';
import {readAjesQueryCache} from '../apps/web/lib/catalog/ajes-query-cache';
// Read fixed private records only. Never call AJES, print SQL/IP/body or write data.
const kinds=['list','detail','count','models','makes','colors'];
async function main(){
 const storage=getJsonStorage();
 // Configuration chronology only: never print or decrypt the saved credential.
 const config:any=await storage.readJson('integrations/ajes/config.json',null);
 const configAt=Date.parse(typeof config?.updatedAt==='string'?config.updatedAt:'');
 console.log('AJES_CONFIGURATION_METADATA',JSON.stringify({source:config?'saved':process.env.AJES_API_PASSWORD?'environment':'missing',updatedAt:Number.isFinite(configAt)?new Date(configAt).toISOString():null}));
 // Fixed continuation slots cannot be replaced by a later page-one failure.
 for(const table of ['korea','stats'])for(const page of [1,3,5,6]){
  const v:any=await storage.readJson(`integrations/ajes/catalog-failure-pages/${table}-list-${page}.json`,null);
  const stamp=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
  console.log('AJES_SAVED_PAGE_FAILURE',JSON.stringify({table,page,present:!!v,startedAt:stamp(v?.startedAt),finishedAt:stamp(v?.finishedAt),httpStatus:Number.isSafeInteger(v?.httpStatus)?v.httpStatus:null,providerCode:typeof v?.providerCode==='string'&&/^(bot|ban)\d{0,12}$/.test(v.providerCode)?v.providerCode:null,outcome:typeof v?.outcome==='string'&&/^(visitor_restricted|request_failed|request_timeout|connect_timeout|invalid_response|empty_response|response_too_large|identity_mismatch|query_too_large|http_\d{3})$/.test(v.outcome)?v.outcome:null}));
 }
 // Six exact cache keys, no directory scan and no upstream client import.
 for(const market of ['korea','japan'])for(const page of [1,2,3]){
  const query=ajesQuery(ajesCatalogQuery({market,page:String(page)}));
  const v:any=await readAjesQueryCache(storage,query.sql);
  const at=Date.parse(v?.observedAt||''),age=Number.isFinite(at)?Math.max(0,Math.round((Date.now()-at)/1000)):null;
  console.log('AJES_SAVED_PAGE',JSON.stringify({market,page,found:!!v,items:Array.isArray(v?.items)?v.items.length:null,received:Number.isSafeInteger(v?.received)?v.received:null,ageSeconds:age,observedAt:Number.isFinite(at)?new Date(at).toISOString():null,schemaVersion:Number.isSafeInteger(v?.schemaVersion)?v.schemaVersion:null,stale:v?.stale===true,partial:v?.partial===true}));
 }
 for(const table of ['main','stats','korea','china']){
  const v:any=await storage.readJson(`integrations/ajes/catalog-failure-${table}.json`,null);
  if(!v){console.log('AJES_SAVED_FAILURE',JSON.stringify({table,present:false}));continue;}
  const stamp=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
  const integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;
  console.log('AJES_SAVED_FAILURE',JSON.stringify({table,present:true,kind:kinds.includes(v.kind)?v.kind:null,page:integer(v.page),pageSize:integer(v.pageSize),startedAt:stamp(v.startedAt),finishedAt:stamp(v.finishedAt),httpStatus:integer(v.httpStatus),providerCode:typeof v.providerCode==='string'&&/^(bot|ban)\d{0,12}$/.test(v.providerCode)?v.providerCode:null,outcome:typeof v.outcome==='string'&&/^(visitor_restricted|request_failed|request_timeout|connect_timeout|invalid_response|empty_response|response_too_large|identity_mismatch|query_too_large|http_\d{3})$/.test(v.outcome)?v.outcome:'other',ipVersion:isIP(typeof v.clientIp==='string'?v.clientIp:''),endpoint:v.endpoint==='http://87.242.72.57/api/'?'ru':v.endpoint==='http://78.46.90.228/api/'?'global':'other'}));
 }
}
main().catch(()=>{console.log('AJES_SAVED_FAILURE_READ_FAILED');process.exitCode=1;});
