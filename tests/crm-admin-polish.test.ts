import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {build} from 'esbuild';
import {crmDateTime,crmDateKey,clientManagerId} from '../apps/web/lib/crm-time';
import {createContract,getContract,changeContractState,updateContract,listContracts,defaultTemplate} from '../apps/web/lib/contracts/store';
import {resetJsonStorageForTests,readDataJson} from '../apps/web/lib/data';
import {documentBlocks,sampleFields} from '../apps/web/lib/contracts/model';
import {previewBlocks,previewParts} from '../apps/web/lib/contracts/preview';
const require=createRequire(import.meta.url);
test('manual client creation writes only the client, retains all contacts and is idempotent',async()=>{
 const state:any={user:{id:'m',role:'manager',status:'active'},clients:[],writes:[]};(globalThis as any).__clientCreate=state;
 const mocks:any={
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__clientCreate.user;export const isCrmRole=r=>['owner','admin','manager'].includes(r);`,
 '@/lib/data':`export const generateId=()=> 'op';export const readChunkedDataJson=async(p)=>{if(p!=='clients/clients.json')throw Error('unexpected read '+p);return globalThis.__clientCreate.clients;};export const appendChunkedDataJson=async(p,v)=>{const s=globalThis.__clientCreate;s.writes.push(p);s.clients.push(v);return v;};`
 };
 const built=await build({entryPoints:['apps/web/app/(crm)/api/crm/clients/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'test'}:undefined);b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 const post=(origin='https://avtocena.com')=>m.exports.POST(new Request('https://avtocena.com/api/crm/clients',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({operationId:'op',fio:'Игорь',max:'max-contact',car:'RAV4',budgetRub:'5000000'})}));
 try{assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.deepEqual(state.writes,['clients/clients.json']);assert.equal(state.clients[0].max,'max-contact');assert.equal(state.clients[0].car,'RAV4');assert.equal(state.clients[0].assignedManagerId,'m');assert.equal((await post('https://evil.example')).status,403);state.user.id='other';assert.equal((await post()).status,403);state.user=null;assert.equal((await post()).status,401);}finally{delete (globalThis as any).__clientCreate;}
});
test('local CRM date crosses midnight at UTC+7 and ownership prefers assignment',()=>{
 assert.equal(crmDateKey('2026-09-25T17:01:00Z'),'2026-09-26');assert.match(crmDateTime('2026-09-25T09:00:00Z'),/16:00/);
 assert.equal(clientManagerId({createdByManagerId:'a',assignedManagerId:'b'}),'b');assert.equal(clientManagerId({createdByManagerId:'a'}),'a');
});
test('archive, restore and purge preserve revisions and cannot resurrect a deleted contract',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,secret=process.env.CRM_DOCUMENTS_SECRET,dir=fs.mkdtempSync(path.join(os.tmpdir(),'contract-archive-'));
 fs.mkdirSync(path.join(dir,'data'));process.chdir(dir);process.env.JSON_STORAGE_DRIVER='local';process.env.CRM_DOCUMENTS_SECRET='fixture';resetJsonStorageForTests();
 const user:any={id:'m',role:'manager',status:'active'};
 try{
  let r=await createContract(user,'japan','',randomUUID());
  await assert.rejects(()=>changeContractState({...user,id:'other'},r.id,r.revision,'archive'),/Нет доступа/);
  await assert.rejects(()=>changeContractState(user,r.id,r.revision,'purge'),/архив/);
  await changeContractState(user,r.id,r.revision,'archive');r=await getContract(user,r.id);assert.ok(r.archivedAt);
  await assert.rejects(()=>updateContract(user,r.id,r.revision,x=>x),/архиве/);
  await assert.rejects(()=>changeContractState(user,r.id,r.revision-1,'restore'),/другом окне/);
  await changeContractState(user,r.id,r.revision,'restore');r=await getContract(user,r.id);assert.equal(r.archivedAt,undefined);
  await changeContractState(user,r.id,r.revision,'archive');r=await getContract(user,r.id);
  await changeContractState(user,r.id,r.revision,'purge');assert.deepEqual(await listContracts(user),[]);
  await assert.rejects(()=>getContract(user,r.id),/не найден/);await assert.rejects(()=>updateContract(user,r.id,r.revision,x=>x),/не найден/);await assert.rejects(()=>createContract(user,'japan','',r.id),/не найден/);
  const stored:any=await readDataJson(`contracts/records/${r.id}.json`,null);assert.deepEqual(Object.keys(stored),['purgedAt']);
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;if(secret===undefined)delete process.env.CRM_DOCUMENTS_SECRET;else process.env.CRM_DOCUMENTS_SECRET=secret;resetJsonStorageForTests();fs.rmSync(dir,{recursive:true,force:true});}
});
test('interactive preview keeps printed clauses identical and maps car/passport/template edits',()=>{
 for(const id of ['japan','other'] as const){
 const s={version:0,createdAt:'',createdBy:'',fields:{...sampleFields(id),car:'Audi A4L',year:'2022',market:id==='japan'?'japan':'china'},template:defaultTemplate(id),calculation:null};
 const preview=previewBlocks(s,'1');assert.deepEqual(preview.map(b=>({text:b.text,heading:b.heading,pageBreak:b.pageBreak})),documentBlocks(s,'1').map(b=>({text:b.text,heading:b.heading,pageBreak:b.pageBreak})));
 const car=preview.find(b=>b.fields.includes('car'))!;assert.ok(car);assert.ok(previewParts(car,s.fields).some(p=>p.field==='car'&&p.text==='Audi A4L'));assert.ok(preview.find(b=>b.fields.includes('passportIssued')));assert.ok(preview.find(b=>b.editor==='template.sections.0.text'));
 }
});
