import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {prepareClientDocument,encryptClientDocument,decryptClientDocument,MAX_CLIENT_FILE_BYTES} from '../apps/web/lib/client-documents';
const require=createRequire(import.meta.url);
test('documents validate image content, size and authenticated encryption',async()=>{
 process.env.CRM_DOCUMENTS_SECRET='test-only-documents-key';
 const pixels=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer();
 const image=await prepareClientDocument(new File([pixels],'passport.png'));
 assert.ok(image.thumbnail);assert.equal(image.mime,'image/png');
 await assert.rejects(prepareClientDocument(new File(['<script>alert(1)</script>'],'fake.png')));
 await assert.rejects(prepareClientDocument(new File(['<svg></svg>'],'bad.svg')));
 await assert.rejects(prepareClientDocument(new File([new Uint8Array(MAX_CLIENT_FILE_BYTES+1)],'large.pdf')));
 const encrypted=encryptClientDocument(pixels,'client-a/file');
 assert.notDeepEqual(encrypted,pixels);assert.deepEqual(decryptClientDocument(encrypted,'client-a/file'),pixels);
 assert.throws(()=>decryptClientDocument(encrypted,'client-b/file'));
 const changed=Buffer.from(encrypted);changed[30]^=1;assert.throws(()=>decryptClientDocument(changed,'client-a/file'));
});
test('document routes isolate clients, reject forgery and roll back failed writes',async()=>{
 process.env.CRM_DOCUMENTS_SECRET='test-only-documents-key';
 const state:any={user:null,client:{id:'c',assignedManagerId:'m',documents:[]},binary:new Map(),reads:0};
 (globalThis as any).__clientDocuments=state;
 const sources:Record<string,string>={
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__clientDocuments.user;export const isCrmRole=r=>['owner','admin','manager'].includes(r);`,
 '@/lib/data':`const s=globalThis.__clientDocuments;export const readChunkedDataJson=async()=>[s.client];export const updateChunkedDataJson=async(p,id,fn)=>{if(s.race)s.client.assignedManagerId='other';if(s.fail)throw Error('storage');return s.client=fn(s.client)};export const getJsonStorage=()=>({putBinary:async(k,b)=>{s.binary.set(k,b)},deleteBinary:async k=>s.binary.delete(k),getBinary:async k=>{s.reads++;return s.binary.has(k)?{data:s.binary.get(k)}:null}});`
 };
 async function route(path:string){const built=await build({entryPoints:[path],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'mock',setup(b){b.onResolve({filter:/^(@\/lib\/|\.\/data$)/},a=>{const key=a.path==='./data'?'@/lib/data':a.path;return sources[key]?{path:key,namespace:'mock'}:undefined});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:sources[a.path],loader:'ts',resolveDir:process.cwd()}));}}]});const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);return m.exports;}
 const post=await route('apps/web/app/(crm)/api/crm/clients/[id]/documents/route.ts');
 const get=await route('apps/web/app/(crm)/api/crm/clients/[id]/documents/[documentId]/route.ts');
 const upload=(origin='https://avtocena.com')=>{const f=new FormData();f.set('file',new File(['%PDF-1.4\nfixture'],'contract.pdf'));return post.POST(new Request('https://avtocena.com/api/crm/clients/c/documents',{method:'POST',headers:{origin},body:f}),{params:Promise.resolve({id:'c'})});};
 const download=(doc:string,id='c')=>get.GET(new Request('https://avtocena.com/api/file'),{params:Promise.resolve({id,documentId:doc})});
 try{
  assert.equal((await upload()).status,401);
  state.user={id:'m',role:'partner'};assert.equal((await upload()).status,401);
  state.user={id:'other',role:'manager'};assert.equal((await upload()).status,404);
  state.user={id:'m',role:'manager'};assert.equal((await upload('https://evil.example')).status,403);
  const r=await upload();assert.equal(r.status,200);const {document}=await r.json();assert.equal(state.binary.size,1);
  const file=await download(document.id);assert.equal(file.status,200);assert.match(file.headers.get('cache-control')||'',/no-store/);assert.equal(await file.text(),'%PDF-1.4\nfixture');
  state.user={id:'other',role:'manager'};const reads=state.reads;assert.equal((await download(document.id)).status,404);assert.equal(state.reads,reads);
  state.user={id:'m',role:'manager'};assert.equal((await download(document.id,'other-client')).status,404);
  const patch=(action:string,confirmed?:boolean,origin='https://avtocena.com')=>get.PATCH(new Request('https://avtocena.com/api/file',{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action,confirmed})}),{params:Promise.resolve({id:'c',documentId:document.id})});
  assert.equal((await patch('trash')).status,400);assert.equal((await patch('trash',true,'https://evil.example')).status,403);
  state.user={id:'other',role:'manager'};assert.equal((await patch('trash',true)).status,403);state.user={id:'m',role:'manager'};
  assert.equal((await patch('purge',true)).status,409);assert.equal((await patch('trash',true)).status,200);assert.ok(state.client.documents[0].deletedAt);assert.equal(state.binary.size,1);
  assert.equal((await patch('restore')).status,200);assert.equal(state.client.documents[0].deletedAt,undefined);
  state.client.documents[0].deletedAt='2020-01-01T00:00:00Z';assert.equal((await download(document.id)).status,404);assert.equal((await patch('restore')).status,409);delete state.client.documents[0].deletedAt;
  state.fail=true;assert.equal((await upload()).status,500);assert.equal(state.binary.size,1);state.fail=false;
  state.race=true;assert.equal((await upload()).status,403);assert.equal(state.binary.size,1);
  state.user=null;assert.equal((await download(document.id)).status,401);
 }finally{delete (globalThis as any).__clientDocuments;}
});
