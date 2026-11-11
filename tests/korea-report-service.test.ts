import test from 'node:test';
import assert from 'node:assert/strict';
import {createKoreaReportService} from '../apps/web/lib/catalog/korea-report-service';
const input={offerId:'ajes-korea-selectedID',lot:'43014653',kind:'history' as const,ip:'203.0.113.1'};
const link='https://fem.encar.com/cars/report/accident/'+input.lot;
const base={password:async()=> 'server-secret',assertEnabled:async()=>{},reserve:async()=>{},endpoint:()=> 'http://87.242.72.57/api/'};
test('coalesces same visitor/identity; caches bounded links; preserves switch, visitor and TTL fences',async()=>{
 let calls=0,reserves=0,enabled=true,now=100000;
 let release!:()=>void;const held=new Promise<void>(r=>release=r);
 const read=createKoreaReportService({...base,now:()=>now,assertEnabled:async()=>{if(!enabled)throw Error('disabled');},reserve:async()=>{reserves++;},fetcher:async()=>{calls++;await held;return new Response(JSON.stringify([link]));}});
 const a=read(input),b=read(input);release();assert.deepEqual(await a,await b);assert.equal(calls,1);assert.equal(reserves,1);
 await read(input);assert.equal(calls,1);
 enabled=false;await assert.rejects(read(input),/disabled/);enabled=true;
 await read({...input,ip:'203.0.113.2'});assert.equal(calls,2,'never share visitor-bound access');
 now+=300001;await read(input);assert.equal(calls,3,'expired link refreshed only on request');
});
test('missing history leaves inspection usable; refusals prevent repeated provider requests',async()=>{
 let calls=0,now=100000,refuse=false;
 const read=createKoreaReportService({...base,now:()=>now,fetcher:async(url)=>{
  calls++;if(refuse)return new Response('bot2 SECRET',{status:403});
  return new Response(JSON.stringify(new URL(String(url)).searchParams.has('history')?[]:[`https://www.encar.com/md/sl/mdsl_regcar.do?method=inspectionViewNew&carid=${input.lot}`]));
 }});
 await assert.rejects(read(input),/report_missing/);await read({...input,kind:'inspection'});assert.equal(calls,2);
 refuse=true;await assert.rejects(read(input),/refused/);assert.equal(calls,3);
 await assert.rejects(read(input),/cooldown/);await assert.rejects(read({...input,kind:'inspection'}),/cooldown/);assert.equal(calls,3);
 now+=300001;await assert.rejects(read(input),/refused/);assert.equal(calls,4);
});
test('rejects untrusted query before any supplier request or quota reservation',async()=>{
 let calls=0;const read=createKoreaReportService({...base,reserve:async()=>{calls++;},fetcher:async()=>{calls++;return new Response('[]');}});
 for(const wrong of [{offerId:"ajes-korea-bad'"},{offerId:'ajes-china-valid'},{lot:'bad'},{kind:'other'},{ip:'unknown'}])await assert.rejects(read({...input,...wrong} as any),/input/);
 assert.equal(calls,0);
});
