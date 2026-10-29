import {getJsonStorage} from '../apps/web/lib/data';
import {isIP} from 'node:net';
// Read four fixed private records only. Never call AJES, print SQL/IP/body or write data.
const kinds=['list','detail','count','models','makes','colors'];
async function main(){
 const storage=getJsonStorage();
 for(const table of ['main','stats','korea','china']){
  const v:any=await storage.readJson(`integrations/ajes/catalog-failure-${table}.json`,null);
  if(!v){console.log('AJES_SAVED_FAILURE',JSON.stringify({table,present:false}));continue;}
  const stamp=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
  const integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;
  console.log('AJES_SAVED_FAILURE',JSON.stringify({table,present:true,kind:kinds.includes(v.kind)?v.kind:null,page:integer(v.page),pageSize:integer(v.pageSize),startedAt:stamp(v.startedAt),finishedAt:stamp(v.finishedAt),httpStatus:integer(v.httpStatus),providerCode:typeof v.providerCode==='string'&&/^(bot|ban)\d{0,12}$/.test(v.providerCode)?v.providerCode:null,outcome:typeof v.outcome==='string'&&/^(visitor_restricted|request_failed|request_timeout|connect_timeout|invalid_response|empty_response|response_too_large|identity_mismatch|query_too_large|http_\d{3})$/.test(v.outcome)?v.outcome:'other',ipVersion:isIP(typeof v.clientIp==='string'?v.clientIp:''),endpoint:v.endpoint==='http://87.242.72.57/api/'?'ru':v.endpoint==='http://78.46.90.228/api/'?'global':'other'}));
 }
}
main().catch(()=>{console.log('AJES_SAVED_FAILURE_READ_FAILED');process.exitCode=1;});
