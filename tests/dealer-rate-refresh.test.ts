import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getDealerRate} from '../apps/web/lib/dealers/exchange-rate';
import {resetJsonStorageForTests} from '../apps/web/lib/data';
test('manual refresh rechecks a cached rate, retains the shared request lock and saved quote on failure',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,fetch=globalThis.fetch;
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dealer-rate-refresh-'));
 try{
  process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
  await fs.mkdir('data/dealers/rates',{recursive:true});const quote={value:80,quoteAt:new Date(Date.now()-60000).toISOString(),fetchedAt:new Date(Date.now()-60000).toISOString(),source:'https://www.profinance.ru/chart/usdrub/'};
  await fs.writeFile('data/dealers/rates/usdrub.json',JSON.stringify({quote,attemptAt:new Date(Date.now()-60000).toISOString(),error:''}));
  let calls=0;globalThis.fetch=async()=>{calls++;return calls%2?new Response('qtable.htm?SID=fixture&'):new Response('S=USD/RUB;TICK=USDRUB;LP=84;T=12:00:00');};
  assert.equal((await getDealerRate()).quote?.value,80);assert.equal(calls,0);
  const results=await Promise.all([getDealerRate(true),getDealerRate(true)]);assert.ok(results.some(r=>r.quote?.value===84));assert.equal(calls,2);
  assert.equal((await getDealerRate(true)).quote?.value,84);assert.equal(calls,2,'repeated clicks share a 30-second limit');
  await fs.writeFile('data/dealers/rates/usdrub.json',JSON.stringify({quote,attemptAt:new Date(Date.now()-60000).toISOString(),error:''}));
  globalThis.fetch=async()=>{throw Error('offline');};const failed=await getDealerRate(true);assert.equal(failed.quote?.value,80);assert.equal(failed.quote?.quoteAt,quote.quoteAt);assert.ok(failed.error);
 }finally{globalThis.fetch=fetch;process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();await fs.rm(tmp,{recursive:true,force:true});}
});
