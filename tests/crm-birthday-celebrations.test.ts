import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const member=(id:string,extra={})=>({id,role:'manager',companyId:'dealer_topavto',status:'active',displayName:id,avatarUrl:'/photo.jpg',...extra});
async function load(state:any,entry='apps/web/lib/crm-birthday-celebrations.ts'){
 (globalThis as any).__birthdayTest=state;
 const mocks:Record<string,string>={
  auth:`export const getCurrentUser=async()=>globalThis.__birthdayTest.actor;export const isCrmRole=r=>['owner','admin','manager'].includes(r);`,
  data:`const s=globalThis.__birthdayTest;export const readDataJson=async(k,f)=>s.files.get(k)??f;export const mutateDataJson=async(k,f,fn)=>{const next=fn(s.files.get(k)??f);s.files.set(k,next);return next;};export const appendChunkedDataJson=async()=>{};export const readRecentChunkedDataJson=async()=>[];`,
  'crm-users':`export const readCrmUsers=async()=>globalThis.__birthdayTest.users;`,
  'crm-activity':`export const recordCrmActivity=async()=>{};`,
  'calculation-request-origin':`export const isCalculationOriginAllowed=r=>r.headers.get('origin')==='https://avtocena.com';`
 };
 const result=await build({entryPoints:[entry],bundle:true,format:'cjs',platform:'node',packages:'external',write:false,plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^(\.\/|@\/lib\/)/},a=>{const name=a.path.split('/').at(-1)!;if(mocks[name])return {path:name,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('today in Krasnoyarsk, all internal roles, photos, private date and tenant isolation',async()=>{
 const api=await load({files:new Map()});const now=new Date('2026-10-12T18:00:00Z');
 const users=[member('Егор'),member('Друг'),member('Отключён',{status:'disabled'}),member('Дилер',{companyId:'external'})];
 const profiles=Object.fromEntries(users.map(u=>[u.id,{birthDate:'1990-10-13'}]));
 for(const role of ['manager','admin','owner']){
  const rows=api.birthdayCelebrations(member('viewer',{role}),users,profiles,{},now);
  assert.equal(rows.length,2);assert.equal(rows[0].name,'Егор');assert.equal(rows[0].avatarUrl,'/photo.jpg');assert.equal(rows[0].day,'2026-10-13');assert.equal('birthDate' in rows[0],false);
 }
 assert.deepEqual(api.birthdayCelebrations(member('v',{companyId:'external'}),users,profiles,{},now),[]);
 assert.deepEqual(api.birthdayCelebrations(member('v',{role:'customer'}),users,profiles,{},now),[]);
 assert.deepEqual(api.birthdayCelebrations(member('v'),users,profiles,{},new Date('2026-10-12T16:59:00Z')),[]);
});
test('each viewer claims each birthday once, independently from bell and next year',async()=>{
 const state={files:new Map()};const api=await load(state),id='birthday-card:2026-10-13:e';
 assert.equal(await api.claimBirthdayCelebration('viewer',id),true);
 assert.equal(await api.claimBirthdayCelebration('viewer',id),false);
 assert.equal(await api.claimBirthdayCelebration('colleague',id),true);
 assert.equal(await api.claimBirthdayCelebration('viewer','birthday-card:2027-10-13:e'),true);
 const u=member('e'),p={e:{birthDate:'1990-10-13'}},now=new Date('2026-10-13T01:00:00Z');
 assert.equal(api.birthdayCelebrations(u,[u],p,{birthday_e_2026:'read'},now).length,1);
 assert.equal(api.birthdayCelebrations(u,[u],p,{[id]:'read'},now).length,0);
});
test('leap birthday and invalid dates',async()=>{
 const api=await load({files:new Map()}),u=member('e');
 assert.equal(api.birthdayCelebrations(u,[u],{e:{birthDate:'2000-02-29'}},{},new Date('2027-02-28T01:00:00Z')).length,1);
 assert.equal(api.birthdayCelebrations(u,[u],{e:{birthDate:'2000-02-30'}},{},new Date('2027-02-28T01:00:00Z')).length,0);
});
test('claim API validates origin, internal audience, current birthday, and repeated claim',async()=>{
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),person=member('e');
 const state={files:new Map([['crm/staff-profiles.json',{e:{birthDate:`1990-${today.slice(5)}`}}]]),users:[person],actor:null as any};
 const api=await load(state,'apps/web/app/(crm)/api/crm/birthdays/claim/route.ts');
 const request=(id=`birthday-card:${today}:e`,origin='https://avtocena.com')=>new Request('https://avtocena.com/api/crm/birthdays/claim',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({id})});
 assert.equal((await api.POST(request())).status,401);
 state.actor=member('v',{companyId:'external'});assert.equal((await api.POST(request())).status,403);
 state.actor=member('v');assert.equal((await api.POST(request(undefined,'https://other.test'))).status,403);
 assert.equal((await (await api.POST(request('birthday-card:2001-01-01:e'))).json()).celebration,null);
 assert.equal((await (await api.POST(request())).json()).celebration.name,'e');
 assert.equal((await (await api.POST(request())).json()).celebration,null);
});
