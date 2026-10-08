import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('navigation badges count new visible events, preserve per-user receipts and reject forbidden acknowledgements',async()=>{
 const at=new Date(Date.now()-1000).toISOString();
 const state:any={seen:{},events:[{id:'1',type:'lead_created',createdAt:at},{id:'2',type:'document_uploaded',createdAt:at,entityType:'document',href:'/crm/clients/one'},{id:'3',type:'site_updated',createdAt:at,href:'/crm/site'},{id:'4',type:'client_updated',createdAt:at,actor:{id:'m'}}],ideas:[{authorId:'other',createdAt:at,updatedAt:at,comments:[{authorId:'other',createdAt:at}]}],notices:[{unread:true,href:'/crm/chat?thread=test',createdAt:at}]};
 (globalThis as any).__navTest=state;
 const sources:any={
  './crm-activity':'export const readCrmActivity=async()=>globalThis.__navTest.events;',
  './crm-unified-notifications':'export const readNotifications=async()=>({notifications:globalThis.__navTest.notices});',
  './team-ideas':'export const listIdeas=async()=>globalThis.__navTest.ideas;',
  './data':'export const readDataJson=async(p,f)=>globalThis.__navTest.seen[p]||f;export const mutateDataJson=async(p,f,fn)=>globalThis.__navTest.seen[p]=fn(globalThis.__navTest.seen[p]||f);'
 };
 const b=await build({entryPoints:['apps/web/lib/crm-navigation-counts.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'sources',setup(p){p.onResolve({filter:/^\.\//},a=>sources[a.path]?{path:a.path,namespace:'mock'}:undefined);p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:sources[a.path]}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);
 const user:any={id:'m',role:'manager',companyId:'dealer_topavto',permissions:{documents:false}};
 try{
  let data=await m.exports.navigationCounts(user);
  assert.equal(data.counts['/crm/leads'],1);assert.equal(data.counts['/crm/ideas'],2);assert.equal(data.counts['/crm/chat'],1);assert.equal(data.counts['/crm/clients'],0);
  assert.equal(data.counts['/crm/site'],undefined);assert.equal(data.counts['/crm/documents'],undefined);
  await m.exports.markNavigationSeen(user,'/crm/ideas',data.through);
  assert.equal((await m.exports.navigationCounts(user)).counts['/crm/ideas'],0);
  assert.equal((await m.exports.navigationCounts({...user,id:'other-user'})).counts['/crm/ideas'],2);
  await assert.rejects(()=>m.exports.markNavigationSeen(user,'/crm/site',data.through),/forbidden/);
  await assert.rejects(()=>m.exports.markNavigationSeen(user,'/crm/ideas',new Date(Date.now()+100000).toISOString()),/invalid_date/);
  await assert.rejects(()=>m.exports.navigationCounts({...user,companyId:'external'}),/forbidden/);
  assert.equal(m.exports.navigationSection({type:'document_uploaded',href:'/crm/clients/x'}),'/crm/documents');
  assert.equal(m.exports.navigationSection({type:'settings_updated',href:'/crm/settings#site'}),'/crm/settings');
 }finally{delete (globalThis as any).__navTest;}
});
