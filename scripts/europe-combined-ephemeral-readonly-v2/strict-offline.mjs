import fs from 'node:fs';
import {createHash} from 'node:crypto';
const bytes=fs.readFileSync(new URL('./official-cbr.xml',import.meta.url));
const xmlSha=createHash('sha256').update(bytes).digest('hex');
if(xmlSha!=='2adeb25ad182398684c4c646e110ded5449f7174e4a4442f8bff6b7d1d32aec6')throw Error('pinned_cbr_bytes');
const text=new TextDecoder('windows-1251',{fatal:true}).decode(bytes);
if(!/<ValCurs[^>]+Date="20\.11\.2026"/.test(text)||!/<CharCode>EUR<\/CharCode><Nominal>1<\/Nominal>[\s\S]{0,100}<Value>89,8597<\/Value>/.test(text))throw Error('pinned_cbr_rate');
const RealDate=globalThis.Date, instant=RealDate.parse('2026-11-20T16:00:00.000Z');
globalThis.Date=class FrozenDate extends RealDate {constructor(...a){if(a.length)super(...a);else super(instant);} static now(){return instant;}};
let denied=0, cbr=0;
globalThis.fetch=async (url)=>{
 const s=typeof url==='string'?url:url?.url??String(url);
 if(s==='https://www.cbr.ru/scripts/XML_daily.asp'){cbr++;return new Response(text,{status:200});}
 denied++;throw Error('network_denied_by_offline_harness');
};
globalThis.readNetworkProof=()=>({officialLocalSubstitutions:cbr,outgoingNetworkAttempts:denied});
const {Socket}=await import('node:net');
Socket.prototype.connect=function(){denied++;throw Error('network_denied_by_offline_harness');};
