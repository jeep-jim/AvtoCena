import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function load(entry:string,state:any,mocks:Record<string,string>={}){
 (globalThis as any).__ab=state;process.env.AUTH_SECRET='autobot-test-only';
 mocks={data:`const s=globalThis.__ab;export const readDataJson=async(k,f)=>s.files.get(k)??f;export const mutateDataJson=async(k,f,fn)=>{const n=fn(s.files.get(k)??f);s.files.set(k,n);return n;};`,...mocks};
 const b=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>{const n=a.path.split('/').at(-1)!;if(mocks[n])return {path:n,namespace:'mocks'};});b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],loader:'js'}));}}]});const m={exports:{} as any};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('key encrypted at rest, redacted on reads, hostile endpoints rejected',async()=>{
 const state={files:new Map()},c=await load('apps/web/lib/autobot/config.ts',state);
 for(const u of ['http://ai.reg.ru/chat/completions','https://reg.ru.evil.test/chat/completions','https://user:pass@ai.reg.ru/chat/completions','https://127.0.0.1/chat/completions','https://ai.reg.ru/chat/completions?token=x'])assert.throws(()=>c.validateEndpoint(u));
 await c.saveAutobotConfig({enabled:true,endpoint:'https://ai.reg.ru/v1/chat/completions',model:'test',token:'PRIVATE-KEY',inputRate:30,outputRate:90,monthlyLimit:3000});
 assert.ok(!JSON.stringify([...state.files.values()]).includes('PRIVATE-KEY'));const read=await c.readAutobotConfig();assert.equal(read.token,'PRIVATE-KEY');assert.equal(c.publicConfig(read).token,undefined);assert.equal(c.configReady(read),true);
 await assert.rejects(c.saveAutobotConfig({...read,monthlyLimit:3001}));
});
test('parallel calls reserve shared allowance; settlement counts usage, failures retain estimated charge',async()=>{
 const state={files:new Map()},b=await load('apps/web/lib/autobot/budget.ts',state);
 const tickets=await Promise.allSettled(Array.from({length:20},()=>b.reserveBudget(1,3)));assert.equal(tickets.filter(t=>t.status==='fulfilled').length,3);
 const ok=tickets.filter((t:any)=>t.status==='fulfilled') as PromiseFulfilledResult<any>[];
 await b.settleBudget(ok[0].value,.2);await b.settleBudget(ok[0].value,.2);await b.settleBudget(ok[1].value);let s=await b.budgetStatus();assert.equal(s.spent,1.2);assert.equal(s.reserved,1);assert.equal(s.calls,2);
 await b.settleBudget(ok[2].value,2);assert.equal((await b.budgetStatus()).blocked,true);await assert.rejects(b.reserveBudget(.1,3));
 assert.equal(b.budgetMonth(new Date('2026-10-31T18:00:00Z')),'2026-11');assert.throws(()=>b.reserveInLedger({spent:0,holds:{},calls:0},'x',NaN,3000));
});
test('public route rejects CSRF and large requests; no login required for read-only chat',async()=>{
 const state={files:new Map()},r=await load('apps/web/app/api/autobot/route.ts',state,{agent:`export const runPublicAutobot=async(body)=>({text:'Ответ',cards:[],sources:[]});`});
 const req=(origin:string,body:any)=>new Request('https://avtocena.com/api/autobot',{method:'POST',headers:{origin,'content-type':'application/json','x-real-ip':'test'},body:JSON.stringify(body)});
 assert.equal((await r.POST(req('https://evil.test',{text:'hi'}))).status,403);
 assert.equal((await r.POST(req('',{text:'hi'}))).status,403);
 assert.equal((await r.POST(req('https://avtocena.com',{text:'hi'}))).status,200);
 assert.equal((await r.POST(req('https://avtocena.com',{text:'a'.repeat(40001)}))).status,503);
 assert.deepEqual(await (await r.GET()).json(),{connected:false});
});
test('provider records actual tokens and rejects truncated answers; key never enters payload',async()=>{
 const state={files:new Map()},c=await load('apps/web/lib/autobot/config.ts',state);
 await c.saveAutobotConfig({enabled:true,endpoint:'https://ai.reg.ru/v1/chat/completions',model:'fixture',token:'PRIVATE-KEY',inputRate:30,outputRate:90,monthlyLimit:3});
 const p=await load('apps/web/lib/autobot/provider.ts',state),old=globalThis.fetch;
 try{globalThis.fetch=async(url,init)=>{assert.equal(init?.redirect,'error');assert.equal((init?.headers as any).Authorization,'Bearer PRIVATE-KEY');assert.ok(!String(init?.body).includes('PRIVATE-KEY'));return Response.json({usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:'Ответ'}}]});};
 assert.equal((await p.regReply([{role:'user',content:'Машины'}],AbortSignal.timeout(1000))).text,'Ответ');
 const b=await load('apps/web/lib/autobot/budget.ts',state);assert.ok(Math.abs((await b.budgetStatus()).spent-.0048)<1e-9);
 globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'Оборвано'}}]});await assert.rejects(p.regReply([{role:'user',content:'Машины'}],AbortSignal.timeout(1000)),/не завершён/);
 }finally{globalThis.fetch=old;}
});
