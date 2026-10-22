import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const member=(extra={})=>({id:'manager',displayName:'Иван',role:'manager',companyId:'dealer_topavto',status:'active',...extra});
async function load(entry:string,state:any,mockAgent=false){
 (globalThis as any).__assistantTest=state;process.env.AUTH_SECRET='assistant-unit-test-only-not-production';
 const mocks:Record<string,string>={
  auth:`export const getCurrentUser=async()=>globalThis.__assistantTest.actor;`,
  data:`const s=globalThis.__assistantTest;export const readDataJson=async(k,f)=>s.files.get(k)??f;export const mutateDataJson=async(k,f,fn)=>{const next=fn(s.files.get(k)??f);s.files.set(k,next);return next;};export const readChunkedDataJson=async(k)=>s.records?.[k]||[];`,
  'crm-activity':`export const recordCrmActivity=async(u,e)=>globalThis.__assistantTest.events.push(e);`,
 };
 if(mockAgent)mocks.agent=`export const runAssistant=async()=>({id:'answer',role:'assistant',text:'Ответ',at:new Date().toISOString()});`;
 const result=await build({entryPoints:[entry],bundle:true,format:'cjs',platform:'node',packages:'external',write:false,plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^(\.\.\/|\.\/|@\/lib\/)/},a=>{const n=a.path.split('/').at(-1)!;if(mocks[n])return {path:n,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('only internal team; code rights default to owner and explicit grants are respected',async()=>{
 const p=await load('apps/web/lib/team-assistant/policy.ts',{});
 for(const role of ['manager','admin','owner']){assert.equal(p.assistantAllowed(member({role})),true);assert.equal(p.assistantCodeAllowed(member({role})),role==='owner');}
 assert.equal(p.assistantCodeAllowed(member({permissions:{assistantCode:true}})),true);
 for(const u of [null,member({role:'dealer'}),member({companyId:'other',role:'owner'}),member({status:'disabled',role:'owner'}),member({permissions:{assistant:false}}),member({role:'owner',permissions:{assistant:false}})])assert.equal(p.assistantAllowed(u),false);
 assert.equal(p.canFillPath(member(),'/crm/clients/123'),true);
 assert.equal(p.canFillPath(member({permissions:{editClients:false}}),'/crm/clients/123'),false);
 for(const path of ['/crm/managers/123','/crm/settings','/crm/documents','/api/crm/users'])assert.equal(p.canFillPath(member({role:'owner'}),path),false);
});
test('reject private fields, external routes, API and auth/code escalation paths',async()=>{
 const p=await load('apps/web/lib/team-assistant/policy.ts',{});
 for(const url of ['//evil.test','https://evil.test','/\\evil','/api/crm/users','/login'])assert.equal(p.safePath(url),null);
 for(const path of ['.env','apps/web/app/(crm)/api/x.tsx','apps/web/components/../../lib/auth.tsx','apps/web/app/layout.tsx','apps/web/components/crm/assistant/A.tsx'])assert.equal(p.editableCodePath(path),false);
 assert.equal(p.editableCodePath('apps/web/components/crm/CrmShellView.tsx'),true);
 const c=p.cleanContext({path:'/crm/clients/1',fields:[{id:'af-0',label:'Имя',value:'Иван'},{id:'af-1',label:'password',value:'secret'},{id:'bad',label:'Адрес',value:'x'}]});assert.equal(c.fields.length,1);
});
test('history is encrypted, isolated, version checked, leased and bounded by hourly quota',async()=>{
 const state={files:new Map()},s=await load('apps/web/lib/team-assistant/store.ts',state);
 const lease=await s.lockHistory('one',0);await assert.rejects(s.lockHistory('one',0),/Дождитесь/);
 await s.mutateHistory('one',(v:any)=>({...v,revision:1,messages:[{id:'x',role:'user',text:'PRIVATE CLIENT',at:''}]}));
 assert.equal(JSON.stringify([...state.files.values()]).includes('PRIVATE CLIENT'),false);
 assert.equal((await s.readHistory('two')).messages.length,0);assert.equal((await s.readHistory('one')).messages[0].text,'PRIVATE CLIENT');
 await s.unlockHistory('one','wrong');await assert.rejects(s.lockHistory('one',1),/Дождитесь/);
 await s.unlockHistory('one',lease);await assert.rejects(s.lockHistory('one',0),/другом окне/);
 await s.mutateHistory('one',(v:any)=>({...v,window:Math.floor(Date.now()/3600000),count:40}));await assert.rejects(s.lockHistory('one',1),/40 запросов/);
});
test('code phrase is hashed, changes invalidate previous phrase; pending actions are user-bound and expire',async()=>{
 const state={files:new Map()},s=await load('apps/web/lib/team-assistant/store.ts',state);
 assert.equal(await s.checkPhrase('Погнали БРО'),true);assert.equal(await s.checkPhrase('wrong'),false);
 await s.changePhrase('Новая фраза 123');assert.equal(await s.checkPhrase('Погнали БРО'),false);assert.equal(await s.checkPhrase('Новая фраза 123'),true);
 assert.equal(JSON.stringify([...state.files.values()]).includes('Новая фраза'),false);
 await s.savePending('one',{action:{id:'test',kind:'fill'},createdAt:Date.now(),state:'ready'});
 await assert.rejects(s.mutatePending('two','test',(p:any)=>p),/устарело/);
 await s.savePending('one',{action:{id:'old',kind:'fill'},createdAt:Date.now()-16*60000,state:'ready'});
 await assert.rejects(s.mutatePending('one','old',(p:any)=>p),/устарело/);
});
test('route rejects visitors, external staff, CSRF and unauthorized code or phrase changes; explicit offline status',async()=>{
 const state={files:new Map(),events:[],actor:null as any},r=await load('apps/web/app/(crm)/api/crm/assistant/route.ts',state,true);
 const req=(body:any,origin='https://avtocena.com')=>new Request('https://avtocena.com/api/crm/assistant',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({revision:0,...body})});
 assert.equal((await r.GET(new Request('https://avtocena.com/api/crm/assistant'))).status,401);
 state.actor=member({companyId:'external',role:'owner'});assert.equal((await r.POST(req({op:'reset'}))).status,403);
 state.actor=member();assert.equal((await r.POST(req({op:'reset'},'https://evil.test'))).status,403);
 assert.equal((await r.POST(req({op:'reset'},''))).status,403);
 assert.equal((await r.POST(req({op:'phrase',current:'Погнали БРО',next:'новая фраза'}))).status,403);
 delete process.env.TEAM_ASSISTANT_RESPONSES_URL;
 assert.equal((await r.POST(req({op:'message',text:'Привет'}))).status,503);
 const s=await load('apps/web/lib/team-assistant/store.ts',state),id='00000000-0000-4000-8000-000000000001';
 await s.savePending('manager',{action:{id,kind:'code',path:'/crm',files:[]},createdAt:Date.now(),state:'ready'});
 assert.equal((await r.POST(req({op:'action',id,phrase:'Погнали БРО'}))).status,400);
 assert.equal(state.events.length,0);
});
test('completed stream required; HTTP 200 with failed, interrupted or incomplete stream never counts as answer',async()=>{
 const p=await load('apps/web/lib/team-assistant/provider.ts',{files:new Map()}),original=globalThis.fetch;
 process.env.TEAM_ASSISTANT_RESPONSES_URL='https://provider.test/v1/responses';process.env.TEAM_ASSISTANT_ACCESS_TOKEN='fixture';process.env.TEAM_ASSISTANT_MODEL='fixture';
 const mock=(events:any[])=>{globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init!.body as string);assert.equal(body.stream,true);assert.equal(body.store,false);return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));};};
 try{
  mock([{type:'response.output_text.delta',delta:'not finished'}]);await assert.rejects(p.modelReply([],new AbortController().signal),/оборвался/);
  mock([{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}]);await assert.rejects(p.modelReply([],new AbortController().signal),/не завершил/);
  mock([{type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Ответ'}]}]}}]);assert.equal((await p.modelReply([],new AbortController().signal)).text,'Ответ');
 }finally{globalThis.fetch=original;delete process.env.TEAM_ASSISTANT_RESPONSES_URL;delete process.env.TEAM_ASSISTANT_ACCESS_TOKEN;delete process.env.TEAM_ASSISTANT_MODEL;}
});

test('browser channel is private, single-use, encrypted and preserves the assistant tool pipeline',async()=>{
 const state:any={actor:member(),files:new Map(),events:[]};
 const store=await load('apps/web/lib/team-assistant/store.ts',state);
 const bridge=await load('apps/web/lib/team-assistant/browser.ts',state);
 const route=await load('apps/web/app/(crm)/api/crm/assistant/browser/route.ts',state);
 const channel='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const lease=await store.lockHistory('manager',0);
 const task=bridge.browserReply('manager',channel,lease)([{role:'user',content:'private prompt'}],AbortSignal.timeout(5000));
 await new Promise(r=>setTimeout(r,20));
 const get=(c:string)=>route.GET(new Request('https://avtocena.com/api/crm/assistant/browser?channel='+c));
 assert.equal((await (await get(other)).json()).turn,null);
 const turn=(await (await get(channel)).json()).turn;assert.equal(turn.input[0].content,'private prompt');
 assert.ok(!JSON.stringify([...state.files.values()]).includes('private prompt'));
 const post=(origin:string,id=turn.id)=>route.POST(new Request('https://avtocena.com/api/crm/assistant/browser',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({channel,id,text:'new answer',error:''})}));
 assert.equal((await post('https://evil.test')).status,403);
 assert.equal((await post('https://avtocena.com',other)).status,409);
 assert.equal((await post('https://avtocena.com')).status,200);
 assert.equal((await post('https://avtocena.com')).status,409);
 assert.equal((await task).text,'new answer');assert.equal((await (await get(channel)).json()).turn,null);
 state.actor=member({companyId:'other'});assert.equal((await get(channel)).status,403);
});

test('page control is opt-in, owner/admin-only, and revocation blocks pending actions',async()=>{
 const state={files:new Map(),events:[],actor:member()},r=await load('apps/web/app/(crm)/api/crm/assistant/route.ts',state,true);
 const req=(body:any)=>new Request('https://avtocena.com/api/crm/assistant',{method:'POST',headers:{origin:'https://avtocena.com','content-type':'application/json'},body:JSON.stringify(body)});
 const status=async()=> (await r.GET(new Request('https://avtocena.com/api/crm/assistant?path=/cars/autocatalog'))).json();
 assert.equal((await status()).pageControl,false);
 assert.equal((await r.POST(req({revision:0,op:'page_control',enabled:true}))).status,403);
 state.actor=member({role:'admin'});
 assert.equal((await r.POST(req({revision:0,op:'page_control',enabled:true}))).status,200);
 assert.equal((await status()).pageControl,true);assert.equal((await status()).canFill,true);
 const store=await load('apps/web/lib/team-assistant/store.ts',state),id='00000000-0000-4000-8000-000000000002';
 await store.savePending('manager',{action:{id,kind:'fill',path:'/cars/autocatalog',fields:[]},createdAt:Date.now(),state:'ready'});
 assert.equal((await r.POST(req({revision:1,op:'page_control',enabled:false}))).status,200);
 assert.equal((await r.POST(req({revision:2,op:'action',id,path:'/cars/autocatalog'}))).status,400);
 assert.equal((await status()).canFill,false);
 const p=await load('apps/web/lib/team-assistant/policy.ts',state);
 assert.equal(p.canFillPath(member(),'/cars/autocatalog'),false);
 assert.equal(p.assistantPageControlAllowed(member({role:'owner',companyId:'other'})),false);
});
