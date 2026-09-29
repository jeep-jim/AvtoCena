import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {appendChunkedDataJson,readChunkedDataJson,updateChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {deletionPreview,deleteCrmRecord} from '../apps/web/lib/crm-deletion';
import {createContract} from '../apps/web/lib/contracts/store';
import {randomUUID} from 'node:crypto';
const actor:any={id:'owner',role:'owner',displayName:'Owner'};
test('deletion protects linked records, permissions and stale confirmations; removes only the selected record',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,secret=process.env.AUTH_SECRET,temp=fs.mkdtempSync(path.join(os.tmpdir(),'crm-delete-'));
 process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';process.env.AUTH_SECRET='test-secret-for-crm-deletion';resetJsonStorageForTests();
 try{
  await appendChunkedDataJson('clients/clients.json',{id:'c',fio:'Client'});
  await appendChunkedDataJson('leads/leads.json',{id:'l',clientId:'c',status:'new'});
  await appendChunkedDataJson('leads/leads.json',{id:'other',status:'new'});
  assert.ok((await deletionPreview(actor,'client','c')).blockers.length);
  await assert.rejects(deletionPreview({...actor,role:'manager',permissions:{deleteRecords:true}},'lead','l'),/delete_forbidden/);
  await assert.rejects(deletionPreview({...actor,role:'admin',permissions:{viewAll:false}},'lead','l'),/delete_forbidden/);
  const p=await deletionPreview(actor,'lead','l');
  await updateChunkedDataJson<any>('leads/leads.json','l',r=>({...r,comment:'changed'}));
  await assert.rejects(deleteCrmRecord(actor,'lead','l',p.revision),/delete_conflict/);
  await deleteCrmRecord(actor,'lead','l',(await deletionPreview(actor,'lead','l')).revision);
  assert.deepEqual((await readChunkedDataJson<any>('leads/leads.json',[])).map(r=>r.id),['other']);
  await deleteCrmRecord(actor,'client','c',(await deletionPreview(actor,'client','c')).revision);
  assert.deepEqual(await readChunkedDataJson('clients/clients.json',[]),[]);
  await assert.rejects(deleteCrmRecord(actor,'client','c','old'),/delete_not_found/);
  const events=await readChunkedDataJson<any>('activity/feed.json',[]);assert.equal(events.filter(e=>e.type.endsWith('_deleted')).length,2);
  await appendChunkedDataJson('clients/clients.json',{id:'docs',documents:[{id:'doc',deletedAt:'2026-09-29'}]});
  assert.ok((await deletionPreview(actor,'client','docs')).blockers.some(x=>x.includes('документы')));
  await appendChunkedDataJson('leads/leads.json',{id:'paid',status:'rejected',statusHistory:[{status:'paid'}]});
  assert.ok((await deletionPreview(actor,'lead','paid')).blockers.length);
  await appendChunkedDataJson('clients/clients.json',{id:'contract',fio:'Contract client'});
  await createContract(actor,'japan','contract',randomUUID());
  assert.ok((await deletionPreview(actor,'client','contract')).blockers.some(x=>x.includes('договор')));
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;if(secret===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=secret;resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}
});
