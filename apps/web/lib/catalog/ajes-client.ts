import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {DetailReadCache} from './detail-read-cache';
import {ajesQuery,ajesLot,type AjesTable} from './ajes-query';

export class AjesUnavailable extends Error {constructor(public reason:string){super(`ajes_${reason}`);}}
type Dependencies={password:()=>string|undefined|Promise<string|undefined>; assertEnabled:()=>Promise<void>; reserve:(table:AjesTable)=>Promise<void>; fetcher?:typeof fetch; readDetail?:(table:AjesTable,id:string)=>Promise<any|null>; saveDetail?:(table:AjesTable,id:string,value:any)=>Promise<void>};
export function createAjesClient(deps:Dependencies) {
  const cache=new DetailReadCache<any>({maxEntries:300,maxBytes:16*1024*1024,ttlMs:30*60*1000,concurrency:2});
  return {
    async read(input:unknown,clientIp:string) {
      const query=ajesQuery(input);
      if(!isIP(clientIp)) throw new AjesUnavailable('client_ip_missing');
      await deps.assertEnabled(); // Also applies to cache hits after an owner disables the source.
      const password=await deps.password();
      if(!password)throw new AjesUnavailable('not_configured');
      return cache.get(query.sql,async()=>{
        await deps.assertEnabled(); // Recheck after waiting for concurrency slot.
        if(query.kind==='detail'&&deps.readDetail){
          const saved=await deps.readDetail(query.table,query.id!);
          const age=Date.now()-Date.parse(saved?.observedAt||'');
          if(age>=0&&age<30*60*1000&&saved?.items?.length===1&&saved.items[0].id===query.id&&saved.items[0].table===query.table)return saved;
        }
        await deps.reserve(query.table);
        const url=new URL('http://87.242.72.57/gzip/');
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
          try{
            const body=Buffer.concat(chunks);
            // Node fetch usually decompresses Content-Encoding automatically. The
            // provider can also return a gzip body without that header: inspect magic.
            const decoded=body[0]===0x1f&&body[1]===0x8b?gunzipSync(body,{maxOutputLength:2*1024*1024}):body;
            // The provider returns a short plaintext bot refusal containing the
            // API password for some visitor addresses. Classify it without ever
            // retaining/logging its contents or replacing the visitor address.
            if(decoded.length<=256&&/^bot\d*\s/i.test(decoded.toString('utf8')))throw new AjesUnavailable('visitor_restricted');
            rows=JSON.parse(decoded.toString('utf8'));
          }catch(error){if(error instanceof AjesUnavailable)throw error;throw new AjesUnavailable('invalid_response');}
          if(!Array.isArray(rows)||rows.length>query.pageSize||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new AjesUnavailable('invalid_response');
          if(query.kind==='detail'&&rows.some(r=>r.ID!==query.id))throw new AjesUnavailable('identity_mismatch');
          const items=rows.map(r=>ajesLot(r,query.table,query.kind==='detail')).filter(Boolean);
          const result={items,page:query.page,pageSize:query.pageSize,received:rows.length,rejected:rows.length-items.length,observedAt:new Date().toISOString(),
            quota:{counter:quotaNumber(response.headers.get('api-counter')),limit:quotaNumber(response.headers.get('api-limit')),remaining:quotaNumber(response.headers.get('api-rest'))}};
          // Only explicitly opened, accepted details; list responses never populate a database.
          if(query.kind==='detail'&&items.length===1&&deps.saveDetail)await deps.saveDetail(query.table,query.id!,result);
          return result;
        }catch(error){
          // Never propagate URLs, provider bodies, credentials or nested fetch causes to logs.
          if(error instanceof AjesUnavailable)throw error;
          const code=(error as any)?.cause?.code;
          const reason=controller.signal.aborted?'request_timeout':code==='UND_ERR_CONNECT_TIMEOUT'?'connect_timeout':'request_failed';
          throw new AjesUnavailable(reason);
        }finally{clearTimeout(timer);}
      });
    },
  };
}
function quotaNumber(value:string|null){return value!==null&&/^\d+$/.test(value)?Number(value):null;}
