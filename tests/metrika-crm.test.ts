import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {metrikaOrder,metrikaCsv,encryptMetrikaToken,decryptMetrikaToken,connectMetrika,flushMetrika,metrikaStatus} from '../apps/web/lib/metrika-crm';
import {resetJsonStorageForTests,appendChunkedDataJson,updateChunkedDataJson,readDataJson} from '../apps/web/lib/data';
const base={id:'lead-1',clientId:'client-1',createdAt:'2026-09-23T10:00:00Z',metrikaClientId:'12345678901234567890',status:'qualified',statusHistory:[]};
test('CRM statuses and cumulative goals remain distinct; no invented paid revenue',()=>{
 const q=metrikaOrder(base,'Asia/Novosibirsk')!;assert.equal(q.create_date_time,'2026-09-23 17:00:00');assert.equal(q.goals,'crm_qualified');assert.equal(q.order_status,'IN_PROGRESS');assert.ok(!('revenue' in q));
 const contract=metrikaOrder({...base,status:'contract_signed',statusHistory:[{status:'qualified'}]},'UTC')!;assert.equal(contract.goals,'crm_qualified,crm_contract');assert.equal(contract.order_status,'IN_PROGRESS');
 assert.equal(metrikaOrder({...base,status:'paid'},'UTC')!.order_status,'PAID');
 const spam=metrikaOrder({...base,status:'spam',statusHistory:[{status:'qualified'},{status:'paid'}]},'UTC')!;assert.equal(spam.order_status,'SPAM');assert.equal(spam.goals,'crm_spam');
 for(const status of ['rejected','duplicate','contacted'])assert.ok(!metrikaOrder({...base,status},'UTC')!.goals.includes('spam'));
 assert.equal(metrikaOrder({...base,metrikaClientId:''},'UTC'),null);
 assert.match(metrikaCsv([contract]),/"crm_qualified,crm_contract"/);
});
test('encrypted connection, goal setup, upload retries and stable order id prevent duplicate export',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,secret=process.env.AUTH_SECRET;const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'metrika-'));
 await fs.mkdir(path.join(tmp,'data'));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';process.env.AUTH_SECRET='test-only-secret';resetJsonStorageForTests();
 const token='test-token-123456789012345';let reject=true;let posts=0;let csv='';const goals:string[]=[];
 const mock=(async(url:any,init:any={})=>{
  if(String(url).endsWith('/goals')){if(init.method==='POST')goals.push(JSON.parse(init.body).goal.conditions[0].url);return Response.json({goals:[]});}
  if(String(url).includes('/simple_orders')){posts++;csv=await init.body.get('file').text();return reject?new Response('',{status:503}):Response.json({uploading:{uploading_id:'upload-1',api_validation_status:'PASSED'}});}
  return Response.json({counter:{time_zone_name:'UTC'}});
 }) as typeof fetch;
 try {
  assert.deepEqual(await flushMetrika(mock),{enabled:false});assert.equal(posts,0);
  const encrypted=encryptMetrikaToken(token);assert.ok(!encrypted.includes(token));assert.equal(decryptMetrikaToken(encrypted),token);
  await connectMetrika(token,mock);assert.equal(goals.length,4);
  assert.ok(!JSON.stringify(await metrikaStatus()).includes(token));
  const stored=await readDataJson<any>('integrations/metrika/config.json',{});assert.ok(!JSON.stringify(stored).includes(token));
  await appendChunkedDataJson('leads/leads.json',{...base,createdAt:new Date(Date.now()-1000).toISOString()});
  assert.equal((await flushMetrika(mock) as any).error,'metrika_http_503');assert.equal((await metrikaStatus()).acceptedOrders,0);
  reject=false;assert.equal((await flushMetrika(mock) as any).accepted,1);assert.match(csv,/"lead-1"/);assert.match(csv,/crm_qualified/);
  await flushMetrika(mock);assert.equal(posts,2);
  await updateChunkedDataJson<any>('leads/leads.json','lead-1',l=>({...l,status:'contract_signed',statusHistory:[{status:'qualified'}]}));
  await flushMetrika(mock);assert.equal(posts,3);assert.match(csv,/crm_qualified,crm_contract/);assert.equal((await metrikaStatus()).acceptedOrders,1);
 } finally {process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;if(secret===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=secret;resetJsonStorageForTests();await fs.rm(tmp,{recursive:true,force:true});}
});
