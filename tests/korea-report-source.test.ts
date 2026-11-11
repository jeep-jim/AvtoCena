import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {koreaReportLink,readKoreaReportResponse,requestKoreaReportLink} from '../apps/web/lib/catalog/korea-report-source';
const lot='43014653',link=`https://fem.encar.com/cars/report/accident/${lot}`;
test('accept only feed-provided exact report identity, never arbitrary URLs or credentials',()=>{
 assert.equal(koreaReportLink([link,'https://tru.ru/korea/example'],lot,'history'),link);
 for(const value of [link+'?code=secret',link.replace(lot,'43014654'),link.replace('fem.encar.com','fem.encar.com.evil.test'),link.replace('fem.encar.com','user:pass@fem.encar.com'),'http://127.0.0.1/admin',link+'#fragment'])assert.equal(koreaReportLink([value],lot,'history'),null);
 const inspection=`https://www.encar.com/md/sl/mdsl_regcar.do?method=inspectionViewNew&carid=${lot}`;
 assert.equal(koreaReportLink([inspection],lot,'inspection'),inspection);
 assert.equal(koreaReportLink([inspection+'&url=http://localhost'],lot,'inspection'),null);
});
test('decodes bounded JSON/gzip; rejects provider refusal without leaking body',async()=>{
 assert.deepEqual(await readKoreaReportResponse(new Response(gzipSync(JSON.stringify([link])))),[link]);
 await assert.rejects(readKoreaReportResponse(new Response('bot2 SECRET')),e=>e instanceof Error&&e.message==='refused'&&!e.message.includes('SECRET'));
 await assert.rejects(readKoreaReportResponse(new Response('x'.repeat(2*1024*1024+1))),/too_large/);
 await assert.rejects(readKoreaReportResponse(new Response('<html>sign in</html>')),/invalid/);
});
test('source switch precedes request and secrets remain server-only; no retries',async()=>{
 let calls=0;const deps={password:async()=> 'private-secret',assertEnabled:async()=>{},reserve:async()=>{},endpoint:()=> 'http://87.242.72.57/api/',fetcher:async(input:any,init:any)=>{calls++;const u=new URL(String(input));assert.equal(u.searchParams.get('code'),'private-secret');assert.equal(u.searchParams.get('history'),'');assert.equal(init.redirect,'error');return new Response(JSON.stringify([link]));}};
 const input={id:'selectedID',lot,kind:'history' as const,ip:'203.0.113.1'};
 assert.equal(await requestKoreaReportLink(input,deps),link);assert.equal(calls,1);
 await assert.rejects(requestKoreaReportLink(input,{...deps,assertEnabled:async()=>{throw Error('disabled');}}),/disabled/);assert.equal(calls,1);
 await assert.rejects(requestKoreaReportLink({...input,id:"bad' SQL"},deps),/input/);assert.equal(calls,1);
 await assert.rejects(requestKoreaReportLink(input,{...deps,fetcher:async()=>{calls++;return new Response('refusal',{status:403});}}),/refused/);assert.equal(calls,2);
});

test('prefer supplier anonymous wrapper only with exact LOT and report kind in the same response',async()=>{
 const {koreaReportLinks}=await import('../apps/web/lib/catalog/korea-report-source');
 const wrapper='https://tru.ru/korea/v9LnRTiIYGJEJVDE6muNCtoRrd8skq6xWaqkSuFUVtbgo0cKL8s3NjAnqFYZjiE61cNQHqu';
 assert.deepEqual(koreaReportLinks([link,wrapper],lot,'history'),{href:wrapper,originalHref:link});
 assert.equal(koreaReportLinks([wrapper],lot,'history'),null);
 assert.equal(koreaReportLinks([link.replace(lot,'99999999'),wrapper],lot,'history'),null);
 assert.equal(koreaReportLinks([link,wrapper],lot,'inspection'),null);
 for(const bad of [wrapper.replace('tru.ru','tru.ru.evil.test'),wrapper+'?redirect=https://evil.test',wrapper+'#x',wrapper.replace('https:','http:'),wrapper.replace('tru.ru','user:password@tru.ru')])assert.equal(koreaReportLinks([link,bad],lot,'history')?.href,link);
});
test('browser rejects mismatched identity and untrusted URLs',async()=>{
 const {validKoreaReportLink}=await import('../apps/web/lib/catalog/korea-report-types');
 const value={version:2,offerId:'ajes-korea-selectedID',lot,kind:'history',href:link,originalHref:link};
 assert.equal(validKoreaReportLink(value,value.offerId,lot,'history'),true);
 for(const wrong of [{lot:'12345678'},{offerId:'ajes-korea-another'},{kind:'inspection'},{href:'javascript:alert(1)'},{originalHref:link.replace(lot,'12345678')}])assert.equal(validKoreaReportLink({...value,...wrong},value.offerId,lot,'history'),false);
});
