import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function route(file:string,sources:Record<string,string>){const built=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>sources[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:sources[a.path],loader:'ts',resolveDir:process.cwd()}));}}]});const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);return m.exports;}
test('deletion HTTP boundary requires authentication, confirmation and same origin',async()=>{
 const s:any={user:null,calls:0};(globalThis as any).__privacyRoutes=s;
 try{const api=await route('apps/web/app/(crm)/api/crm/delete/[kind]/[id]/route.ts',{'@/lib/auth':`export const getCurrentUser=async()=>globalThis.__privacyRoutes.user;`,'@/lib/crm-deletion':`export const deletionPreview=async()=>({revision:'r'});export const deleteCrmRecord=async(u,k,id,r)=>{if(r!=='r')throw Error('delete_conflict');globalThis.__privacyRoutes.calls++;return {ok:true};};`});
 const send=(body:any={},origin='https://avtocena.com')=>api.DELETE(new Request('https://avtocena.com/api/crm/delete/lead/a',{method:'DELETE',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({kind:'lead',id:'a'})});
 assert.equal((await send()).status,401);s.user={id:'owner',role:'owner'};assert.equal((await send()).status,400);assert.equal((await send({confirm:'other',revision:'r'})).status,400);assert.equal((await send({confirm:'a',revision:'r'},'https://evil.test')).status,403);assert.equal((await send({confirm:'a',revision:'old'})).status,409);assert.equal(s.calls,0);assert.equal((await send({confirm:'a',revision:'r'})).status,200);assert.equal(s.calls,1);
 }finally{delete (globalThis as any).__privacyRoutes;}
});
test('privacy requests are stored without sales consent or attribution and retries keep one identity',async()=>{
 const s:any={rows:new Map()};(globalThis as any).__privacyRoutes=s;
 try{const api=await route('apps/web/app/(public)/api/privacy-request/route.ts',{'next/server':`export {NextResponse} from 'next/server.js';export const after=()=>{};`,'@/lib/data':`export const appendChunkedDataJson=async(p,r)=>{globalThis.__privacyRoutes.rows.set(r.id,r);return r;};`,'@/lib/lead-antispam':`export const guardLead=async()=>null;export const leadVisitor=()=>({cookie:'test'});`,'@/lib/crm-dispatch':`export const requestCrmDelivery=async()=>{};`});
 const send=(extra:object={},origin='https://avtocena.com')=>api.POST(new Request('https://avtocena.com/api/privacy-request',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({name:'Test',phone:'+79991234567',message:'Отзываю согласие',operationId:'privacy-operation-1234',analyticsConsent:true,attribution:{metrikaClientId:'123'},...extra})}));
 assert.equal((await send({},'https://evil.test')).status,403);assert.equal((await send({phone:'bad'})).status,400);const first=await send();assert.equal(first.status,200);const id=(await first.json()).id;assert.equal((await (await send()).json()).id,id);assert.equal(s.rows.size,1);const row=s.rows.get(id);assert.equal(row.source,'privacy_request');assert.equal(row.analyticsConsent,false);assert.equal(row.attribution,undefined);assert.equal(row.personalDataConsent,undefined);assert.equal(row.clientId,undefined);
 }finally{delete (globalThis as any).__privacyRoutes;}
});

test('dealer settings require permission and same origin, and preserve email for older forms', async()=>{
 const s:any={user:null,rows:[{id:'dealer_topavto',name:'TopAvto',city:'Новокузнецк',mail:{email:'info@avtocena.com',provider:'reg',ready:false}}],writes:0}; (globalThis as any).__dealerMailRoutes=s;
 try {
  const api=await route('apps/web/app/(crm)/api/crm/dealers/route.ts',{
   '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__dealerMailRoutes.user;`,
   '@/lib/data':`export const getJsonStorage=()=>({});export const mutateDataJson=async(p,f,fn)=>{const s=globalThis.__dealerMailRoutes;s.rows=fn(s.rows);s.writes++;};`,
   '@/lib/crm-activity':`export const recordCrmActivity=async()=>{};`
  });
  const send=(mail=false,origin='https://avtocena.com')=>{const body=new FormData();for(const [k,v] of Object.entries({dealerId:'dealer_topavto',name:'TopAvto',city:'Новокузнецк',status:'verified'}))body.set(k,v);if(mail){body.set('mailEmail','office@example.ru');body.set('mailProvider','yandex');body.set('mailReady','on');}return api.POST(new Request('https://avtocena.com/api/crm/dealers',{method:'POST',headers:{origin},body}));};
  assert.match((await send()).headers.get('location')||'',/login/);s.user={id:'m',role:'manager'};assert.match((await send()).headers.get('location')||'',/login/);assert.equal(s.writes,0);
  s.user={id:'o',role:'owner'};assert.equal((await send(true,'https://evil.test')).status,403);assert.equal(s.writes,0);
  assert.match((await send()).headers.get('location')||'',/state=saved/);assert.equal(s.rows[0].mail.email,'info@avtocena.com');
  assert.match((await send(true)).headers.get('location')||'',/state=saved/);assert.deepEqual(s.rows[0].mail,{email:'office@example.ru',provider:'yandex',ready:true});
 } finally {delete (globalThis as any).__dealerMailRoutes;}
});
