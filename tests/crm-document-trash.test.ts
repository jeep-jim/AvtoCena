import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('document trash preserves access, retention deadlines and retryable purge claims',async()=>{
 const doc={id:'file',name:'Договор.pdf',mime:'application/pdf',size:10,createdAt:'2026-09-01',createdBy:'m',hasThumbnail:false};
 const state:any={client:{id:'c',assignedManagerId:'m',documents:[doc]},deleted:[],fail:false};
 (globalThis as any).__trashTest=state;
 const built=await build({entryPoints:['apps/web/lib/client-document-trash.ts'],bundle:true,format:'cjs',platform:'node',write:false,packages:'external',plugins:[{name:'storage',setup(b){b.onResolve({filter:/^\.\/data$/},()=>({path:'storage',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`const s=globalThis.__trashTest;export const readChunkedDataJson=async()=>[s.client];export const updateChunkedDataJson=async(p,id,fn)=>id===s.client.id?s.client=fn(s.client):undefined;export const getJsonStorage=()=>({deleteBinary:async key=>{if(s.duringDelete)await s.duringDelete();if(s.fail)throw Error('storage_failed');s.deleted.push(key)}});`}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);
 const {changeDocumentState,purgeDocument,purgeExpiredDocuments,documentExpired,DOCUMENT_RETENTION_MS}=module.exports;
 const actor={id:'m',role:'manager'},other={id:'other',role:'manager'},now=Date.parse('2026-09-24T12:00:00Z');
 try{
  await assert.rejects(changeDocumentState(other,'c','file','trash',now),/forbidden/);
  await assert.rejects(purgeDocument(actor,'c','file'),/not_trashed/);
  await assert.rejects(changeDocumentState(actor,'unknown','file','trash',now),/not_found/);
  await changeDocumentState(actor,'c','file','trash',now);
  assert.equal(state.client.documents[0].deletedAt,new Date(now).toISOString());assert.equal(state.deleted.length,0);
  await changeDocumentState(actor,'c','file','trash',now+1000);assert.equal(state.client.documents[0].deletedAt,new Date(now).toISOString(),'repeated trash does not extend retention');
  assert.equal(documentExpired(state.client.documents[0],now+DOCUMENT_RETENTION_MS-1),false);
  assert.equal(documentExpired(state.client.documents[0],now+DOCUMENT_RETENTION_MS),true);
  await changeDocumentState(actor,'c','file','restore',now+1000);assert.equal(state.client.documents[0].deletedAt,undefined);
  await changeDocumentState(actor,'c','file','trash',now);
  assert.deepEqual(await purgeExpiredDocuments(now+DOCUMENT_RETENTION_MS-1),{deleted:0,failed:[]});
  await assert.rejects(changeDocumentState(actor,'c','file','restore',now+DOCUMENT_RETENTION_MS),/expired/);
  state.fail=true;assert.equal((await purgeExpiredDocuments(now+DOCUMENT_RETENTION_MS)).failed.length,1);assert.equal(state.client.documents.length,1);assert.ok(state.client.documents[0].purgeToken);
  await assert.rejects(changeDocumentState(actor,'c','file','restore',now+1000),/purging/);
  state.fail=false;assert.deepEqual(await purgeExpiredDocuments(now+DOCUMENT_RETENTION_MS),{deleted:1,failed:[]});assert.equal(state.client.documents.length,0);assert.equal(state.deleted.length,1);
  state.client.documents=[{...doc,deletedAt:new Date(now).toISOString()}];
  state.duringDelete=async()=>{await assert.rejects(changeDocumentState(actor,'c','file','restore',now+1),/purging/);};
  await purgeDocument(actor,'c','file');assert.equal(state.client.documents.length,0);
  state.duringDelete=null;state.client.documents=[{...doc,deletedAt:new Date(now).toISOString()}];
  await changeDocumentState(actor,'c','file','restore',now+1);
  await assert.rejects(purgeDocument(null,'c','file',{expiredOnly:true,now:now+DOCUMENT_RETENTION_MS}),/not_trashed/);
 }finally{delete (globalThis as any).__trashTest;}
});
