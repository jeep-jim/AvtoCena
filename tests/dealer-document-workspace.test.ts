import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {resetJsonStorageForTests,writeDataJson,appendChunkedDataJson,readChunkedDataJson} from '../apps/web/lib/data';
import {canUseDocuments,workspaceClientsPath,canAccessDocumentClient} from '../apps/web/lib/document-workspace';
import {createContract,getContract,listContracts,getTemplate,saveTemplate,accessibleClient,changeContractState} from '../apps/web/lib/contracts/store';
import {documentBlocks,sampleFields} from '../apps/web/lib/contracts/model';
import {defaultShowcase} from '../apps/web/lib/dealers/showcase-model';
import {changeDocumentState} from '../apps/web/lib/client-document-trash';
import {siteAnalytics} from '../apps/web/lib/metrika-reports';
import {encryptMetrikaToken} from '../apps/web/lib/metrika-crm';
test('dealer clients, document archives, contracts and templates are isolated from other companies and platform',async()=>{
 const cwd=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'dealer-docs-'));const env={...process.env};process.chdir(dir);fs.mkdirSync('data');process.env.JSON_STORAGE_DRIVER='local';process.env.CRM_DOCUMENTS_SECRET='test-documents';process.env.AUTH_SECRET='test-auth';resetJsonStorageForTests();
 const a:any={id:'a',role:'dealer',status:'active',companyId:'dealer_a',dealerApproved:true},b:any={...a,id:'b',companyId:'dealer_b'},owner:any={id:'owner',role:'owner',companyId:'dealer_topavto',status:'active'};
 try{
  await writeDataJson('dealers/dealers.json',[{id:'dealer_a',name:'Компания А',status:'verified'},{id:'dealer_b',name:'Компания Б',status:'verified'}]);
  const s=defaultShowcase('dealer_a','Компания А');s.requisites!.legalName='ООО Компания А';s.offices=[{id:'office',city:'Москва',address:'Адрес',phone:'',hours:'',lat:null,lon:null,photos:[]}];await writeDataJson('dealers/showcases/dealer_a.json',s);
  assert.equal(await canUseDocuments(a),true);assert.equal(await canUseDocuments({...a,dealerApproved:false}),false);assert.equal(await canUseDocuments({...a,status:'disabled'}),false);assert.equal(await canUseDocuments({...a,companyId:'missing'}),false);
  const client={id:randomUUID(),companyId:a.companyId,fio:'Клиент А',documents:[{id:randomUUID(),name:'file.pdf'}]};await appendChunkedDataJson(workspaceClientsPath(a),client);
  assert.equal(canAccessDocumentClient(b,client),false);assert.equal((await accessibleClient(a,client.id)).fio,'Клиент А');await assert.rejects(()=>accessibleClient(b,client.id));await assert.rejects(()=>accessibleClient(owner,client.id));
  const r=await createContract(a,'japan',client.id,randomUUID());assert.equal(r.companyId,'dealer_a');assert.equal(r.template.agent,'ООО Компания А');assert.equal(r.template.city,'Москва');assert.doesNotMatch(documentBlocks({version:1,createdAt:'',createdBy:'a',fields:sampleFields('japan'),template:r.template,calculation:null},'1').map(b=>b.text).join('\n'),/Молодых|Новокузнецк/);
  await assert.rejects(()=>getContract(b,r.id));await assert.rejects(()=>getContract(owner,r.id));assert.equal((await listContracts(b)).length,0);assert.equal((await listContracts(a)).length,1);
  const t=await getTemplate('japan',a);await saveTemplate({...t,agent:'Новый исполнитель А'},t.revision,a);assert.notEqual((await getTemplate('japan',b)).agent,'Новый исполнитель А');assert.notEqual((await getTemplate('japan')).agent,'Новый исполнитель А');
  await assert.rejects(()=>changeDocumentState(b,client.id,client.documents[0].id,'trash'));await changeDocumentState(a,client.id,client.documents[0].id,'trash');await changeDocumentState(a,client.id,client.documents[0].id,'restore');await changeContractState(a,r.id,r.revision,'archive');assert.ok((await getContract(a,r.id)).archivedAt);
  assert.equal((await readChunkedDataJson('clients/clients.json',[])).length,0);
 }finally{process.chdir(cwd);process.env=env;resetJsonStorageForTests();fs.rmSync(dir,{recursive:true,force:true})}
});
test('analytics returns unavailable rather than fabricated zeroes and keeps credentials server-side',async()=>{
 const cwd=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'analytics-'));const env={...process.env};process.chdir(dir);fs.mkdirSync('data');process.env.JSON_STORAGE_DRIVER='local';process.env.AUTH_SECRET='analytics-test';resetJsonStorageForTests();
 try{assert.equal((await siteAnalytics(7)).status,'unconfigured');await writeDataJson('integrations/metrika/config.json',{enabled:true,encryptedToken:encryptMetrikaToken('private-test-token')});const calls:string[]=[];const result=await siteAnalytics(7,(async(url:any)=>{calls.push(String(url));const q=new URL(url).searchParams;return Response.json(q.get('dimensions')?{data:[{dimensions:[{name:'/cars/offer/car'},{name:'Toyota Corolla'},{name:'Москва'}],metrics:[5]}],total_rows:1,sampled:false}:{totals:[8,6,12]})}) as any);assert.equal(result.status,'ready');assert.equal(result.totals?.users,6);assert.equal(result.cars?.rows[0].detail,'Москва');assert.ok(calls.every(u=>!u.includes('private-test-token')));assert.ok(calls.some(u=>new URL(u).searchParams.get('filters')?.includes('/cars/offer/')));const failure=await siteAnalytics(30,(async()=>new Response(null,{status:403})) as any);assert.equal(failure.status,'error');assert.equal(failure.totals,undefined);
 }finally{process.chdir(cwd);process.env=env;resetJsonStorageForTests();fs.rmSync(dir,{recursive:true,force:true})}
});
