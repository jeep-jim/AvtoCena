import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {EMPTY_MEMBERSHIP,dealerAccessLevel,dealerCommissionPercent} from '../apps/web/lib/dealers/program-model';
const require=createRequire(import.meta.url);

test('partner access expires, extends without payment and stays owner-only',async()=>{
 const cwd=process.cwd(),old=process.env.JSON_STORAGE_DRIVER;
 const out=path.resolve('artifacts/dealer-pilot/routes.cjs');fs.mkdirSync(path.dirname(out),{recursive:true});
 const entries={program:'apps/web/app/(crm)/api/crm/dealer-program/route.ts',save:'apps/web/app/api/catalog/offer/[id]/save/route.ts',editorial:'apps/web/app/api/catalog/offer/[id]/editorial/route.ts',photos:'apps/web/app/api/crm/catalog/photos/route.ts',createModel:'apps/web/app/api/encyclopedia/route.ts',editModel:'apps/web/app/api/encyclopedia/[id]/route.ts'};
 await build({stdin:{contents:Object.entries(entries).map(([k,v])=>`export * as ${k} from './${v}';`).join('\n'),resolveDir:cwd,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'actor',setup(b){b.onResolve({filter:/^@\/lib\/auth$/},()=>({path:'auth',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export async function getCurrentUser(){return globalThis.__pilotActor||null} export function isCrmRole(r){return ["owner","admin","manager"].includes(r)}'}));b.onResolve({filter:/^@\/lib\/crm-activity$/},()=>({path:'activity',namespace:'activity'}));b.onLoad({filter:/.*/,namespace:'activity'},()=>({contents:'export async function recordCrmActivity(){} export function activityChanges(){return []} export function activityPerson(){return ""}'}));}}]});
 const routes=require(out),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pilot-'));
 process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';
 const write=(p:string,v:unknown)=>{fs.mkdirSync(path.dirname('data/'+p),{recursive:true});fs.writeFileSync('data/'+p,JSON.stringify(v));};
 const read=()=>JSON.parse(fs.readFileSync('data/dealers/memberships/external.json','utf8'));
 write('dealers/dealers.json',[{id:'external',name:'Pilot',status:'verified'}]);
 const owner={id:'owner',role:'owner',companyId:'dealer_topavto',status:'active'};
 const req=(body:unknown,method='POST',origin='https://avtocena.com')=>new Request('https://avtocena.com/api/crm/dealer-program',{method,headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const grant={action:'partnerAccess',dealerId:'external',version:0,months:3,note:'Pilot'};
 const ctx={params:Promise.resolve({id:'test'})};
 try{
  for(const actor of [null,...['dealer','owner','admin','manager','partner'].map(role=>({...owner,role,companyId:'external',dealerApproved:true,permissions:{catalog:true,calculations:true}})),{...owner,status:'disabled'}]){
   (globalThis as any).__pilotActor=actor;
   assert.equal((await routes.program.POST(req(grant))).status,403);
   for(const name of ['save','editorial','photos','createModel'])assert.equal((await routes[name].POST(req({}),ctx)).status,403,name);
   assert.equal((await routes.editModel.POST(req({}),ctx)).status,403);
  }
  assert.equal(fs.existsSync('data/dealers/memberships/external.json'),false);
  (globalThis as any).__pilotActor=owner;
  assert.equal((await routes.program.POST(req(grant,'POST','https://evil.example'))).status,403);
  assert.equal((await routes.program.POST(req(grant))).status,400,'agreement required');
  write('dealers/memberships/external.json',{...EMPTY_MEMBERSHIP,agreement:{approvedAt:new Date().toISOString()},paidUntil:'2030-01-31T12:00:00.000Z'});
  for(const months of [0,-1,2,1.5,100,'3'])assert.equal((await routes.program.POST(req({...grant,months}))).status,400);
  assert.equal((await routes.program.POST(req({...grant,note:''}))).status,400);
  const res=await routes.program.POST(req(grant));assert.equal(res.status,200);const m=await res.json();
  assert.equal(m.partnerUntil,'2030-04-30T12:00:00.000Z');assert.equal(m.paidUntil,'2030-01-31T12:00:00.000Z');
  assert.equal(m.history[0].amountRub,0);assert.equal(m.history[0].kind,'partner');assert.equal(m.history[0].actorId,'owner');
  assert.equal(dealerAccessLevel('external',m,new Date('2030-03-01')).level,'partner');
  assert.equal(dealerCommissionPercent(m,new Date('2030-03-01')),10);
  assert.equal(dealerAccessLevel('external',m,new Date(m.partnerUntil)).full,false);
  assert.equal(dealerCommissionPercent(m,new Date(m.partnerUntil)),null);
  assert.equal((await routes.program.POST(req(grant))).status,400,'duplicate stale version');assert.equal(read().history.length,1);
  const paid=await routes.program.POST(req({action:'membership',dealerId:'external',version:m.version,months:1,amountRub:10000,note:'Actual payment'}));assert.equal(paid.status,200);
  assert.equal((await paid.json()).paidUntil,'2030-05-30T12:00:00.000Z');
 }finally{delete (globalThis as any).__pilotActor;process.chdir(cwd);if(old===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=old;fs.rmSync(tmp,{recursive:true,force:true});}
});
