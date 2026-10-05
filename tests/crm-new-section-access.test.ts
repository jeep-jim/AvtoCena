import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hasCrmPermission} from '../apps/web/lib/crm-permissions';
const require=createRequire(import.meta.url);
const manager:any={id:'manager',role:'manager',companyId:'dealer_topavto',status:'active'};
test('new capabilities preserve existing access and require explicit site delegation',()=>{
 assert.equal(hasCrmPermission(manager,'chat'),true);
 assert.equal(hasCrmPermission(manager,'game'),true);
 assert.equal(hasCrmPermission({...manager,permissions:{activityAll:true}},'analytics'),true);
 assert.equal(hasCrmPermission({...manager,permissions:{activityAll:true,analytics:false}},'analytics'),false);
 assert.equal(hasCrmPermission({...manager,role:'admin',permissions:{activityAll:false}},'analytics'),false);
 assert.equal(hasCrmPermission({...manager,role:'admin'},'site'),false);
 assert.equal(hasCrmPermission({...manager,role:'admin',permissions:{site:true}},'site'),true);
 assert.equal(hasCrmPermission({...manager,permissions:{site:true}},'site'),false);
 assert.equal(hasCrmPermission({...manager,status:'disabled'},'chat'),false);
});
test('new section APIs deny revoked capabilities and Metrika is platform-owner only',async()=>{
 const state:any={user:manager,calls:0};(globalThis as any).__newAccess=state;
 const mock:any={
 '@/lib/account/auth':`export const currentAccount=async()=>null;`,
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__newAccess.user;export const isCrmRole=r=>['owner','admin','manager'].includes(r);export const isAdminRole=r=>['owner','admin'].includes(r);`,
 '@/lib/crm-chat':`const call=async()=>{globalThis.__newAccess.calls++;return {ok:true}};export const chatList=call,chatDetail=call,createDirectChat=call,sendChatMessage=call,createChatRoom=call,updateChatRoom=call,reactToChatMessage=call,changeChatMessage=call,forwardChatMessage=call;`,
 '@/lib/dealers/showcase-store':`export const savePublicFeatures=async()=>{globalThis.__newAccess.calls++;return {ok:true}};`,
 '@/lib/metrika-crm':`export const metrikaStatus=async()=>({connected:false});export const connectMetrika=async()=>{globalThis.__newAccess.calls++};export const disableMetrika=connectMetrika;`,
 '@/lib/crm-activity':`export const recordCrmActivity=async()=>{};`,
 '@/lib/metrika-reports':`export const siteAnalytics=async()=>{globalThis.__newAccess.calls++;return {ok:true}};`,
 '@/lib/crm-users':`export const readCrmUsers=async()=>[];`,
 '@/lib/crm-game':`export const beginGame=async()=>{globalThis.__newAccess.calls++;return 'run'};export const finishGame=beginGame;export const gameBest=async()=>0;export const gameProfile=async()=>null;export const publicGameId=id=>id;export const validGameMode=()=>true;`,
 };
 async function load(name:string){const r=await build({entryPoints:[`apps/web/app/(crm)/api/crm/${name}/route.ts`],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'access',setup(b){b.onResolve({filter:/^@\//},a=>mock[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mock[a.path],loader:'ts',resolveDir:process.cwd()}));}}]});const m={exports:{} as any};new Function('require','module','exports',r.outputFiles[0].text)(require,m,m.exports);return m.exports;}
 const req=(route:string,method='POST',body={})=>new Request(`https://avtocena.com/api/crm/${route}`,{method,headers:{origin:'https://avtocena.com','content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 try{
  const chat=await load('chat');state.user={...manager,permissions:{chat:false}};
  assert.equal((await chat.GET(req('chat','GET'))).status,403);assert.equal((await chat.POST(req('chat'))).status,403);assert.equal(state.calls,0);
  state.user=manager;assert.equal((await chat.GET(req('chat','GET'))).status,200);
  const site=await load('public-features');state.user={...manager,role:'admin'};
  assert.equal((await site.PUT(req('public-features','PUT'))).status,403);
  state.user={...state.user,permissions:{site:true}};assert.equal((await site.PUT(req('public-features','PUT'))).status,200);
  state.user={...manager,permissions:{site:true}};assert.equal((await site.PUT(req('public-features','PUT'))).status,403);
  const metrika=await load('settings/metrika');
  for(const user of [{...manager,role:'admin',permissions:{settings:true,site:true}},{...manager,role:'owner',companyId:'other'},{...manager,role:'owner',status:'disabled'}]){state.user=user;assert.equal((await metrika.GET()).status,403);assert.equal((await metrika.POST(req('settings/metrika'))).status,403);}
  state.user={...manager,role:'owner'};assert.equal((await metrika.GET()).status,200);assert.equal((await metrika.POST(req('settings/metrika','POST',{action:'disable'}))).status,200);
  const analytics=await load('analytics');state.user={...manager,permissions:{activityAll:true,analytics:false}};assert.equal((await analytics.GET(req('analytics','GET'))).status,403);state.user={...manager,permissions:{analytics:true,activityAll:false}};assert.equal((await analytics.GET(req('analytics','GET'))).status,200);
  const game=await load('game');state.user={...manager,permissions:{game:false}};assert.equal((await game.GET()).status,403);assert.equal((await game.POST(req('game','POST',{action:'start',mode:'hills'}))).status,403);
 }finally{delete (globalThis as any).__newAccess;}
});
