import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('discussion attachments require access on upload and download, encrypt bytes and clean retry copies',async()=>{
 process.env.CRM_DOCUMENTS_SECRET='test-only-discussion-key';
 const state:any={user:null,notes:[],binary:new Map(),reads:0,fail:false};(globalThis as any).__discussionFiles=state;
 const mocks:Record<string,string>={
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__discussionFiles.user;export const isCrmRole=r=>r==='manager';`,
 '@/lib/crm-discussion-store':`const s=globalThis.__discussionFiles;export async function discussionEntity(u,t,id){if(u.id!=='m'||id!=='lead'||t!=='lead')throw Error('discussion_forbidden');return {internalNotes:s.notes}};export async function addDiscussionMessage(u,t,id,input,attachment){await discussionEntity(u,t,id);if(s.fail)throw Error('storage');if(!s.notes.some(n=>n.id===input.operationId))s.notes.push({id:input.operationId,text:input.text,attachment});return {messages:s.notes}};`,
 '@/lib/data':`const s=globalThis.__discussionFiles;export const getJsonStorage=()=>({putBinary:async(k,b)=>s.binary.set(k,b),deleteBinary:async k=>s.binary.delete(k),getBinary:async k=>{s.reads++;return s.binary.has(k)?{data:s.binary.get(k)}:null}});`,
 };
 const built=await build({entryPoints:['apps/web/app/(crm)/api/crm/discussion/attachment/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'mock',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);const route=m.exports;
 const upload=(operation='operation-123',origin='https://avtocena.com',file=new File(['%PDF-1.4\nfixture'],'quote.pdf'))=>{const f=new FormData();f.set('file',file);f.set('type','lead');f.set('id','lead');f.set('operationId',operation);return route.POST(new Request('https://avtocena.com/api/crm/discussion/attachment',{method:'POST',headers:{origin},body:f}));};
 const download=(id:string,entity='lead')=>route.GET(new Request(`https://avtocena.com/api/crm/discussion/attachment?type=lead&id=${entity}&file=${id}`));
 try{
  assert.equal((await upload()).status,403);
  state.user={id:'m',role:'manager'};assert.equal((await upload('operation-123','https://foreign.example')).status,403);
  state.user={id:'m',role:'manager',permissions:{editLeads:false}};assert.equal((await upload()).status,403);
  state.user={id:'m',role:'manager'};
  assert.equal((await upload()).status,200);assert.equal(state.binary.size,1);assert.equal(state.notes.length,1);
  assert.ok(![...state.binary.values()][0].includes(Buffer.from('%PDF-')));
  const attachment=state.notes[0].attachment;
  const response=await download(attachment.id);assert.equal(response.status,200);assert.equal(await response.text(),'%PDF-1.4\nfixture');assert.match(response.headers.get('cache-control')||'',/private, no-store/);assert.match(response.headers.get('content-disposition')||'',/^attachment/);
  await upload();assert.equal(state.binary.size,1);assert.equal(state.notes.length,1);
  state.fail=true;assert.equal((await upload('operation-failure')).status,400);assert.equal(state.binary.size,1);state.fail=false;
  assert.equal((await upload('operation-bad','https://avtocena.com',new File(['bad'],'fake.svg'))).status,400);
  const reads=state.reads;state.user={id:'other',role:'manager'};assert.equal((await download(attachment.id)).status,404);assert.equal(state.reads,reads);
  state.user={id:'m',role:'manager'};assert.equal((await download(attachment.id,'another-lead')).status,404);assert.equal(state.reads,reads);
 }finally{delete (globalThis as any).__discussionFiles;}
});
