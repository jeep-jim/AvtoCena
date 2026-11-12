import {gunzipSync} from 'node:zlib';
import {getJsonStorage} from '../apps/web/lib/data';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesRefusalCode} from '../apps/web/lib/catalog/ajes-refusal';

// Owner-requested, fixed bounded diagnostic. No feed copy, arbitrary SQL input,
// cache writes, listing identities, credentials or response bodies in the report.
async function main(){
 const ip=process.env.AJES_DIAG_IP;
 if(ip!=='151.248.113.177')throw Error('address');
 await assertCollectionEnabled('ajes_japan_feed');
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 const storage=getJsonStorage();
 const catalogue=ajesQuery({table:'stats',aggregate:'count'}).sql;
 const requests=[
  {name:'main_positive',table:'main',sql:'select count(*) from main where pw>0'},
  {name:'main_zero',table:'main',sql:'select count(*) from main where pw=0'},
  {name:'stats_positive',table:'stats',sql:'select count(*) from stats where pw>0'},
  {name:'stats_zero',table:'stats',sql:'select count(*) from stats where pw=0'},
  {name:'catalog_total',table:'stats',sql:catalogue},
  {name:'catalog_scalar_1_160',table:'stats',sql:catalogue+" and pw regexp '^[0-9]+$' and pw>=1 and pw<=160"},
  {name:'catalog_multiple_values',table:'stats',sql:catalogue+" and pw like '%,%'"},
  {name:'catalog_first_24',table:'stats',sql:ajesQuery({table:'stats',pageSize:24}).sql.replace('select *','select pw,time')},
 ] as const;
 const report:any={checkedAt:new Date().toISOString(),scope:'Fixed aggregates and 24 anonymous power/fuel pairs; counts are not verified technical facts or unique available cars',results:[]};
 for(const request of requests){
  await assertCollectionEnabled('ajes_japan_feed');
  await reserveAjesRequest(storage,request.table);
  const url=new URL('http://87.242.72.57/api/');
  url.search=new URLSearchParams({ip,json:'',code:password,sql:request.sql}).toString();
  const started=performance.now();
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});
   if(!response.ok){await response.body?.cancel();report.results.push({name:request.name,status:response.status});break;}
   const reader=response.body?.getReader();if(!reader)throw Error('empty');
   const chunks:Uint8Array[]=[];let bytes=0;
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536){await reader.cancel();throw Error('size');}chunks.push(value);}
   const body=Buffer.concat(chunks),decoded=body[0]===31&&body[1]===139?gunzipSync(body,{maxOutputLength:65536}):body;
   if(ajesRefusalCode(decoded.toString('utf8'))){report.results.push({name:request.name,error:'supplier_refused'});break;}
   const rows=JSON.parse(decoded.toString('utf8'));if(!Array.isArray(rows)||rows.length>24)throw Error('schema');
   const result:any={name:request.name,ms:Math.round(performance.now()-started)};
   if(request.name==='catalog_first_24'){
    result.received=rows.length;
    result.values=rows.map(row=>{
     const power=String(row.PW??row.pw??''),fuel=String(row.TIME??row.time??'');
     return {power:/^[0-9., /-]{0,100}$/.test(power)?power:'unrecognized',fuel:/^(?:P|D|E|H|HE|L|C)?$/.test(fuel)?fuel:'unrecognized'};
    });
   }else{
    if(rows.length!==1)throw Error('count');
    const field=Object.entries(rows[0]).find(([key])=>/^(?:count\(\*\)|count|total|tag0)$/i.test(key));
    if(!field||!/^\d+$/.test(String(field[1]))||!Number.isSafeInteger(Number(field[1])))throw Error('count');
    result.count=Number(field[1]);
   }
   report.results.push(result);
  }catch{report.results.push({name:request.name,error:'request_or_schema_failed',ms:Math.round(performance.now()-started)});break;}
 }
 console.log('JAPAN_POWER_AUDIT '+JSON.stringify(report));
 if(report.results.length!==requests.length||report.results.some((r:any)=>r.error||r.status))process.exitCode=1;
}
main().catch(()=>{console.log('JAPAN_POWER_AUDIT_SETUP_FAILED');process.exitCode=1;});
