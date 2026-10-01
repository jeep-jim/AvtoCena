import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {createRequire} from 'node:module';
import {isPlatformTeam,scopedAuthUser} from '../apps/web/lib/platform-access';
import {publicDealerProfile} from '../apps/web/lib/dealers/public-profile';
import {defaultShowcase} from '../apps/web/lib/dealers/showcase-model';
import type {AuthUser} from '../apps/web/lib/auth';
const require=createRequire(import.meta.url);
test('new owners cannot become platform operators; existing roles and disabled status still apply',()=>{
 const base={id:'user_nstass',companyId:'dealer_topavto',role:'owner',telegramUsername:'test',displayName:'Test'} as AuthUser;
 assert.equal(isPlatformTeam(base),true);
 assert.equal(isPlatformTeam({...base,id:'new-owner'}),false);
 assert.equal(isPlatformTeam({...base,companyId:'other'}),false);
 assert.equal(isPlatformTeam({...base,status:'disabled'}),false);
 assert.equal(scopedAuthUser({...base,id:'new-owner'}).role,'dealer');
 assert.equal(scopedAuthUser(base).role,'owner');
});
test('public profile never serializes contacts, pricing or unpublished offers',()=>{
 const s=defaultShowcase('dealer_topavto');s.phone='+79991234567';s.telegram='https://t.me/contact';s.max='https://max.ru/contact';s.description='О компании +7 (999) 123-45-67 https://t.me/contact';s.offices=[{id:'office',city:'Москва',address:'улица Тестовая, 10',phone:'+79991234567',lat:null,lon:null,hours:'10:00–18:00',photos:[]}];
 const p=publicDealerProfile(s),json=JSON.stringify(p);
 for(const key of ['phone','telegram','max','pricing','offers'])assert.equal(key in p,false,key);
 assert.equal('phone' in p.offices[0],false);assert.equal(json.includes('123-45-67'),false);assert.equal(json.includes('t.me'),false);
 assert.equal(p.offices[0].address,s.offices[0].address);assert.equal(p.offices[0].hours,'10:00–18:00');
});
test('dealer HTTP endpoints deny foreign IDs, pending, suspended and unapproved accounts',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
 const out=path.resolve('artifacts/dealer-tenant-tests');fs.mkdirSync(out,{recursive:true});
 const entries={showcase:'apps/web/app/(crm)/api/crm/dealers/[id]/showcase/route.ts',media:'apps/web/app/(crm)/api/crm/dealers/[id]/media/route.ts',access:'apps/web/app/(crm)/api/crm/dealers/[id]/access/route.ts',features:'apps/web/app/(crm)/api/crm/public-features/route.ts'};
 const modules:any={};
 for(const [name,entry] of Object.entries(entries)){
  const file=path.join(out,name+'.cjs');await build({entryPoints:[entry],outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'auth',setup(b){b.onResolve({filter:/^@\/lib\/auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function getCurrentUser(){return globalThis.__tenantActor||null} export function getAuthUsers(){return []} export function normalizeTelegramUsername(v){return v.replace(/^@/, "").toLowerCase()}'}));}}]});modules[name]=require(file);
 }
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dealer-tenant-'));fs.mkdirSync(path.join(tmp,'data/dealers'),{recursive:true});
 fs.writeFileSync(path.join(tmp,'data/dealers/dealers.json'),JSON.stringify([{id:'first',name:'First',status:'verified'},{id:'second',name:'Second',status:'verified'},{id:'pending',name:'Pending',status:'active'},{id:'paused',name:'Paused',status:'paused'}]));
 process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';
 const request=(method='GET',id='first',origin='https://avtocena.com')=>new Request(`https://avtocena.com/api/crm/dealers/${id}/showcase`,{method,headers:{origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(defaultShowcase(id,"Test dealer"))})});
 const context=(id='first')=>({params:Promise.resolve({id})});
 const actor={id:'external',role:'dealer',companyId:'first',dealerApproved:true,status:'active'};
 try{
  (globalThis as any).__tenantActor=actor;
  assert.equal((await modules.showcase.GET(request(),context())).status,200);
  assert.equal((await modules.showcase.PUT(request('PUT'),context())).status,200);
  for(const candidate of [{...actor,companyId:'second'},{...actor,dealerApproved:false},{...actor,status:'disabled'},{...actor,role:'owner'}]){
   (globalThis as any).__tenantActor=candidate;
   assert.equal((await modules.showcase.GET(request(),context())).status,403);
   assert.equal((await modules.showcase.PUT(request('PUT'),context())).status,403);
   assert.equal((await modules.media.POST(request('POST'),context())).status,403);
  }
  for(const id of ['pending','paused']){(globalThis as any).__tenantActor={...actor,companyId:id};assert.equal((await modules.showcase.GET(request('GET',id),context(id))).status,403);}
  (globalThis as any).__tenantActor=actor;
  assert.equal((await modules.showcase.PUT(request('PUT','first','https://attacker.example'),context())).status,403);
  assert.equal((await modules.access.GET(request(),context())).status,403);
  assert.equal((await modules.access.PUT(request('PUT'),context())).status,403);
  assert.equal((await modules.features.PUT(request('PUT'))).status,403);
  assert.equal((await modules.showcase.GET(request('GET','../second'),context('../second'))).status,403);
  fs.mkdirSync('data/auth',{recursive:true});fs.writeFileSync('data/auth/users.json',JSON.stringify([{...actor,id:'external',telegramUsername:'dealer_one',displayName:'Dealer One',dealerApproved:false,sessionVersion:1},{...actor,id:'foreign',companyId:'second',telegramUsername:'dealer_two',displayName:'Dealer Two'}]));
  (globalThis as any).__tenantActor={id:'user_nstass',role:'owner',companyId:'dealer_topavto'};
  const grant=(username:string,approved:boolean)=>new Request('https://avtocena.com/api/crm/dealers/first/access',{method:'PUT',headers:{origin:'https://avtocena.com','Content-Type':'application/json'},body:JSON.stringify({username,approved})});
  assert.equal((await modules.access.PUT(grant('dealer_two',true),context())).status,400);
  assert.equal((await modules.access.PUT(grant('dealer_one',true),context())).status,200);
  let saved=JSON.parse(fs.readFileSync('data/auth/users.json','utf8'))[0];assert.equal(saved.dealerApproved,true);assert.equal(saved.sessionVersion,2);
  assert.equal((await (await modules.access.GET(request(),context())).json()).users.length,1);
  assert.equal((await modules.access.PUT(grant('dealer_one',false),context())).status,200);
  saved=JSON.parse(fs.readFileSync('data/auth/users.json','utf8'))[0];assert.equal(saved.dealerApproved,false);assert.equal(saved.sessionVersion,3);
  (globalThis as any).__tenantActor=saved;assert.equal((await modules.showcase.GET(request(),context())).status,403);

 }finally{delete(globalThis as any).__tenantActor;process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;fs.rmSync(tmp,{recursive:true,force:true});}
});
test('middleware admits the reviewed team and limits dealer sessions to scoped endpoints',async()=>{
 const {middleware}=await import('../apps/web/middleware');const {NextRequest}=await import('next/server');const {createHmac}=await import('node:crypto');
 const previous=process.env.AUTH_SECRET;process.env.AUTH_SECRET='dealer-test-secret';
 const call=async(user:any,url:string)=>{const payload=Buffer.from(JSON.stringify({...user,exp:Math.floor(Date.now()/1000)+60})).toString('base64url');const cookie=payload+'.'+createHmac('sha256','dealer-test-secret').update(payload).digest('base64url');return middleware(new NextRequest('https://avtocena.com'+url,{headers:{cookie:'avtocena_session='+cookie}}));};
 try{
  const team={id:'user_nstass',role:'owner',companyId:'dealer_topavto'},dealer={id:'external',role:'dealer',companyId:'first'};
  assert.equal((await call(team,'/crm/dealers')).headers.get('x-middleware-next'),'1');
  assert.equal((await call(dealer,'/api/crm/dealers/first/showcase')).headers.get('x-middleware-next'),'1');
  for(const url of ['/api/crm/dealers','/api/crm/dealers/first/access','/api/crm/users','/api/crm/contracts','/api/leads','/api/partners','/api/cpa']){
   assert.equal((await call(dealer,url)).status,401,url);
   assert.equal((await call({...dealer,role:'owner'},url)).status,401,`stale owner: ${url}`);
  }
  assert.equal(new URL((await call(dealer,'/crm')).headers.get('location')!).pathname,'/dealer-cabinet');
 }finally{if(previous===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=previous;}
});
