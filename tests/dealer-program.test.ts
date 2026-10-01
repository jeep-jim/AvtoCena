import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {createRequire} from 'node:module';
import {DEFAULT_PROGRAM,EMPTY_MEMBERSHIP,dealerAccessLevel,addMonths,normalizeProgram,restrictedShowcaseChange,applyBasicAccess} from '../apps/web/lib/dealers/program-model';
import {defaultShowcase,calculateSpecial,type SpecialOffer} from '../apps/web/lib/dealers/showcase-model';
import {CONTENT,LANGUAGES} from '../apps/web/lib/partners/content';
import {managesAllDealers} from '../apps/web/lib/dealers/access';
const require=createRequire(import.meta.url);
test('owner-only platform access, fixed trial expiry, paid priority and calendar-month extensions',()=>{
 const now=new Date('2026-10-01T00:00:00Z'),m={...EMPTY_MEMBERSHIP,trialStartedAt:'2026-09-01',trialEndsAt:'2026-10-01',paidUntil:''};
 assert.equal(dealerAccessLevel('external',m,now).full,false);assert.equal(dealerAccessLevel('dealer_topavto',m,now).full,true);
 assert.equal(dealerAccessLevel('external',{...m,paidUntil:'2026-11-01'},now).level,'paid');
 assert.equal(addMonths(new Date('2027-01-31T12:00:00Z'),1).toISOString(),'2027-02-28T12:00:00.000Z');
 for(const role of ['dealer','admin','manager'])assert.equal(managesAllDealers({role,companyId:'dealer_topavto'} as any),false);
 assert.equal(managesAllDealers({role:'owner',companyId:'dealer_topavto'} as any),true);
 assert.throws(()=>normalizeProgram({...DEFAULT_PROGRAM,commissionPercent:101}));
 const s=defaultShowcase('other','Dealer');assert.equal(restrictedShowcaseChange(s,{...s,description:'Allowed change'}),false);assert.equal(restrictedShowcaseChange(s,{...s,buyersEnabled:true}),true);
 const premium={...s,banner:'/cover.jpg',logoLight:'/logo.jpg',buyersEnabled:true,buyerPhotos:[{id:'p',url:'/photo.jpg',caption:''}],offices:[{id:'o',city:'Москва',address:'Адрес',phone:'',hours:'',lat:null,lon:null,photos:[{id:'p',url:'/photo.jpg',caption:''}]}]};const limited=applyBasicAccess(premium);assert.equal(limited.buyerPhotos.length,0);assert.equal(limited.offices[0].photos.length,0);assert.equal(limited.logoLight,'');assert.equal(premium.buyerPhotos.length,1);assert.equal(premium.offices[0].photos.length,1);
});
test('every supported language has real matching knowledge articles and no blank navigation targets',()=>{const ids=CONTENT.ru.articles.map(a=>a.id);for(const lang of Object.keys(LANGUAGES) as (keyof typeof CONTENT)[]){const t=CONTENT[lang];assert.deepEqual(t.articles.map(a=>a.id),ids);for(const a of t.articles){assert.ok(a.title);assert.ok(a.paragraphs.length>=2);assert.ok(a.paragraphs.every(p=>p.length>20));}assert.equal(t.fields.length,7);}});
test('program endpoints enforce owner, paid access, trial idempotency and hidden page submissions',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,out=path.resolve('artifacts/dealer-program-tests');fs.mkdirSync(out,{recursive:true});const modules:any={};
 for(const [name,entry] of Object.entries({program:'apps/web/app/(crm)/api/crm/dealer-program/route.ts',showcase:'apps/web/app/(crm)/api/crm/dealers/[id]/showcase/route.ts',apply:'apps/web/app/(public)/api/dealers/apply/route.ts',features:'apps/web/app/(crm)/api/crm/public-features/route.ts'})){
  const file=path.join(out,name+'.cjs');await build({entryPoints:[entry],outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'auth',setup(b){b.onResolve({filter:/^@\/lib\/auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function getCurrentUser(){return globalThis.__programActor||null}'}));b.onResolve({filter:/^@\/lib\/crm-activity$/},()=>({path:'activity',namespace:'activity'}));b.onLoad({filter:/.*/,namespace:'activity'},()=>({contents:'export async function recordCrmActivity(){}'}));}}]});modules[name]=require(file);
 }
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dealer-program-'));fs.mkdirSync(path.join(tmp,'data/dealers'),{recursive:true});fs.writeFileSync(path.join(tmp,'data/dealers/dealers.json'),JSON.stringify([{id:'external',name:'External',status:'verified'},{id:'dealer_topavto',name:'TopAvto',status:'verified'}]));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';
 const owner={id:'owner',displayName:'Owner',companyId:'dealer_topavto',role:'owner'},external={id:'dealer',role:'dealer',companyId:'external',dealerApproved:true};
 const req=(body:any,origin='https://avtocena.com')=>new Request('https://avtocena.com/api/crm/dealer-program',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});const context={params:Promise.resolve({id:'external'})};
 try{
  for(const actor of [null,external,{...owner,role:'admin'},{...owner,companyId:'external'}]){(globalThis as any).__programActor=actor;assert.equal((await modules.program.POST(req({action:'program',value:DEFAULT_PROGRAM}))).status,403);}
  (globalThis as any).__programActor=owner;assert.equal((await modules.program.POST(req({action:'program',value:DEFAULT_PROGRAM},'https://evil.example'))).status,403);
  assert.equal((await modules.program.POST(req({action:'program',value:DEFAULT_PROGRAM}))).status,200);assert.equal((await modules.program.POST(req({action:'program',value:DEFAULT_PROGRAM}))).status,400);
  (globalThis as any).__programActor=external;const s=defaultShowcase('external','External');assert.equal((await modules.showcase.PUT(req({...s,buyersEnabled:true}),context)).status,403);assert.equal((await modules.showcase.PUT(req({...s,description:'New description'}),context)).status,200);
  (globalThis as any).__programActor=owner;let r=await modules.program.POST(req({action:'trial',dealerId:'external'}));assert.equal(r.status,200);const trial=await r.json();r=await modules.program.POST(req({action:'trial',dealerId:'external'}));assert.deepEqual(await r.json(),trial);
  r=await modules.program.POST(req({action:'membership',dealerId:'external',version:trial.version,months:1,amountRub:2000,note:'Payment 1'}));assert.equal(r.status,200);const paid=await r.json();assert.equal(paid.history.length,1);assert.ok(Date.parse(paid.paidUntil)>Date.parse(trial.trialEndsAt));assert.equal((await modules.program.POST(req({action:'membership',dealerId:'external',version:trial.version,months:1,amountRub:2000,note:'Duplicate'}))).status,400);
  fs.mkdirSync(path.join(tmp,'data/leads'),{recursive:true});fs.writeFileSync(path.join(tmp,'data/leads/leads.json'),JSON.stringify([{id:'sold',status:'completed',requestedDealerId:'external'},{id:'other-company',status:'completed',requestedDealerId:'another'},{id:'open',status:'new',requestedDealerId:'external'}]));
  for(const leadId of ['other-company','open'])assert.equal((await modules.program.POST(req({action:'sale',dealerId:'external',leadId,amountRub:100000}))).status,400);
  assert.equal((await modules.program.POST(req({action:'sale',dealerId:'external',leadId:'sold',amountRub:100000}))).status,200);
  assert.equal((await modules.program.POST(req({action:'sale',dealerId:'external',leadId:'sold',amountRub:100000}))).status,400);
  const sales=JSON.parse(fs.readFileSync(path.join(tmp,'data/dealers/sales.json'),'utf8'));assert.equal(sales.length,1);assert.equal(sales[0].commissionRub,15000);assert.equal(sales[0].basis,'sale');
  assert.equal((await modules.program.POST(req({action:'program',value:{...DEFAULT_PROGRAM,version:1,commissionPercent:10,commissionBasis:'remuneration'}}))).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'data/dealers/sales.json'),'utf8'))[0].commissionRub,15000);
  assert.equal((await modules.program.POST(req({action:'settle',dealerId:'external',saleId:sales[0].id}))).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'data/dealers/sales.json'),'utf8'))[0].status,'paid');
  const form=()=>{const f=new FormData();for(const [k,v] of Object.entries({companyName:'Supplier',country:'China',city:'Shanghai',contactName:'Contact',contact:'test@example.com',consent:'yes',partnerType:'supplier',lang:'zh'}))f.set(k,v);return f;};
  const apply=(f:FormData)=>modules.apply.POST(new Request('https://avtocena.com/api/dealers/apply',{method:'POST',headers:{origin:'https://avtocena.com',accept:'application/json'},body:f}));
  (globalThis as any).__programActor=null;assert.equal((await apply(form())).status,404);
  (globalThis as any).__programActor=owner;const preview=form();preview.set('preview','1');assert.equal((await apply(preview)).status,200);assert.equal(fs.existsSync(path.join(tmp,'data/dealers/applications.json')),false);
  assert.equal((await modules.features.PUT(req({version:0,affiliatesEnabled:true,partnersEnabled:true,knowledgeEnabled:false}))).status,200);
  (globalThis as any).__programActor=null;assert.equal((await apply(form())).status,200);
  (globalThis as any).__programActor=owner;assert.equal((await modules.features.PUT(req({version:1,affiliatesEnabled:true,partnersEnabled:false,knowledgeEnabled:false}))).status,200);
  (globalThis as any).__programActor=null;assert.equal((await apply(form())).status,404);
 }finally{delete(globalThis as any).__programActor;process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;fs.rmSync(tmp,{recursive:true,force:true});}
});
