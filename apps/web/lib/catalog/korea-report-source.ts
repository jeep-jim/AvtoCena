import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {exactKoreaReportUrl, koreaWrapperUrl, type KoreaSourceReportKind} from './korea-report-types';
export type {KoreaSourceReportKind} from './korea-report-types';
export class KoreaReportUnavailable extends Error {constructor(readonly reason:string){super(reason);}}

/** The opaque wrapper is accepted only alongside an exact LOT/kind URL in the same paid-feed response. */
export function koreaReportLinks(value: unknown, lot: string, kind: KoreaSourceReportKind): {href:string; originalHref:string} | null {
 if (!Array.isArray(value) || value.length > 4) return null;
 const originalHref = value.map(item => exactKoreaReportUrl(item, lot, kind)).find(Boolean);
 if (!originalHref) return null;
 const wrapper = value.map(koreaWrapperUrl).find(Boolean);
 return {href: wrapper || originalHref, originalHref};
}
export function koreaReportLink(value:unknown,lot:string,kind:KoreaSourceReportKind):string|null {
 return koreaReportLinks(value,lot,kind)?.href || null;
}
export async function readKoreaReportResponse(response:Response):Promise<unknown>{
 if(!response.ok){await response.body?.cancel();throw new KoreaReportUnavailable([401,403,429].includes(response.status)?'refused':'upstream');}
 if(Number(response.headers.get('content-length'))>2*1024*1024){await response.body?.cancel();throw new KoreaReportUnavailable('too_large');}
 const reader=response.body?.getReader();if(!reader)throw new KoreaReportUnavailable('empty');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new KoreaReportUnavailable('too_large');}chunks.push(value);}
 const bytes=Buffer.concat(chunks);let text:string;
 try{text=(bytes[0]===31&&bytes[1]===139?gunzipSync(bytes,{maxOutputLength:2*1024*1024}):bytes).toString('utf8').replace(/^\uFEFF/,'');}catch{throw new KoreaReportUnavailable('invalid');}
 if(/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(text))throw new KoreaReportUnavailable('refused');
 try{return JSON.parse(text);}catch{throw new KoreaReportUnavailable('invalid');}
}
export async function requestKoreaReportLinks(input:{id:string;lot:string;kind:KoreaSourceReportKind;ip:string},deps:{password:()=>Promise<string|undefined>;assertEnabled:()=>Promise<void>;reserve:()=>Promise<void>;endpoint:(ip:string)=>string;fetcher?:typeof fetch}){
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)||!/^\d{6,10}$/.test(input.lot)||!['history','inspection'].includes(input.kind)||!isIP(input.ip))throw new KoreaReportUnavailable('input');
 await deps.assertEnabled();const password=await deps.password();if(!password)throw new KoreaReportUnavailable('configuration');
 await deps.reserve();
 const url=new URL(deps.endpoint(input.ip));url.search=new URLSearchParams({ip:input.ip,json:'',code:password,sql:`select * from korea where id='${input.id}'`,[input.kind]:''}).toString();
 const response=await (deps.fetcher||fetch)(url,{signal:AbortSignal.timeout(20000),redirect:'error',cache:'no-store'});
 const value=await readKoreaReportResponse(response);const link=koreaReportLinks(value,input.lot,input.kind);
 if(!link)throw new KoreaReportUnavailable('report_missing');return link;
}

export async function requestKoreaReportLink(...args: Parameters<typeof requestKoreaReportLinks>) {
 return (await requestKoreaReportLinks(...args)).href;
}
