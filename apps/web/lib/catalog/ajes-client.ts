import {isIP} from 'node:net';
import {DetailReadCache} from './detail-read-cache';
import {ajesQuery,ajesLot,type AjesTable} from './ajes-query';

export class AjesUnavailable extends Error {constructor(public reason:string){super(`ajes_${reason}`);}}
type Dependencies={password:()=>string|undefined; assertEnabled:()=>Promise<void>; reserve:(table:AjesTable)=>Promise<void>; fetcher?:typeof fetch};
export function createAjesClient(deps:Dependencies) {
  const cache=new DetailReadCache<any>({maxEntries:300,maxBytes:16*1024*1024,ttlMs:30*60*1000,concurrency:2});
  return {
    async read(input:unknown,clientIp:string) {
      const query=ajesQuery(input);
      if(!isIP(clientIp)) throw new AjesUnavailable('client_ip_missing');
      await deps.assertEnabled(); // Also applies to cache hits after an owner disables the source.
      const password=deps.password();
      if(!password)throw new AjesUnavailable('not_configured');
      return cache.get(query.sql,async()=>{
        await deps.assertEnabled(); // Recheck after waiting for concurrency slot.
        await deps.reserve(query.table);
        const url=new URL('http://87.242.72.57/api/');
        url.search=new URLSearchParams({ip:clientIp,json:'',code:password,sql:query.sql}).toString();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
        try {
          const response=await (deps.fetcher??fetch)(url,{signal:controller.signal,redirect:'error',cache:'no-store'});
          if(!response.ok)throw new AjesUnavailable(`http_${response.status}`);
          if(Number(response.headers.get('content-length'))>2*1024*1024)throw new AjesUnavailable('response_too_large');
          const reader=response.body?.getReader();
          if(!reader)throw new AjesUnavailable('empty_response');
          const chunks:Uint8Array[]=[];let bytes=0;
          while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw new AjesUnavailable('response_too_large');}chunks.push(value);}
          let rows:unknown;
          try{rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AjesUnavailable('invalid_response');}
          if(!Array.isArray(rows)||rows.length>query.pageSize||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new AjesUnavailable('invalid_response');
          if(query.kind==='detail'&&rows.some(r=>r.ID!==query.id))throw new AjesUnavailable('identity_mismatch');
          const items=rows.map(r=>ajesLot(r,query.table,query.kind==='detail')).filter(Boolean);
          return {items,page:query.page,pageSize:query.pageSize,received:rows.length,rejected:rows.length-items.length,observedAt:new Date().toISOString(),
            quota:{counter:quotaNumber(response.headers.get('api-counter')),limit:quotaNumber(response.headers.get('api-limit')),remaining:quotaNumber(response.headers.get('api-rest'))}};
        }catch(error){
          // Never propagate URLs, provider bodies, credentials or nested fetch causes to logs.
          if(error instanceof AjesUnavailable)throw error;
          throw new AjesUnavailable('request_failed');
        }finally{clearTimeout(timer);}
      });
    },
  };
}
function quotaNumber(value:string|null){return value!==null&&/^\d+$/.test(value)?Number(value):null;}
