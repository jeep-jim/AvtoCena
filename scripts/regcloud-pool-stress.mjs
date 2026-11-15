// Diagnostic only: four fixed dummy PBKDF2 jobs, numeric counters, no keys/data.
const targets=await fetch('http://127.0.0.1:9229/json/list').then(r=>r.json());
if(targets.length!==1)throw Error('inspector_targets');
const url=new URL(targets[0].webSocketDebuggerUrl);
if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('inspector_scope');
const ws=new WebSocket(url);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let sequence=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function call(expression,awaitPromise=false){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('inspector_deadline')),25000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise,returnByValue:true}}));});}
try{
 const iterations=Number(process.argv[2]||3000000);if(!Number.isSafeInteger(iterations)||iterations<100000||iterations>12000000)throw Error('work_bound');
 const expression=`(()=>{const c=process.getBuiltinModule('node:crypto'),dns=process.getBuiltinModule('node:dns'),started=performance.now();let active=4;globalThis.__acPoolDiagnostic={pending:4,started};globalThis.__acPoolDiagnostic.done=Promise.all(Array.from({length:4},()=>new Promise((r,j)=>c.pbkdf2('avtocena-diagnostic','fixed-dummy-salt',${iterations},32,'sha256',(e)=>{globalThis.__acPoolDiagnostic.pending=--active;e?j(e):r(true);})))) .then(()=>({jobsMs:Math.round(performance.now()-started)}));const dnsStarted=performance.now();globalThis.__acPoolDiagnostic.dns=new Promise(r=>dns.lookup('s3.regru.cloud',()=>r({dnsMs:Math.round(performance.now()-dnsStarted)})));return {queued:4,threadpool:process.env.UV_THREADPOOL_SIZE||'4-default',vips:process.env.VIPS_CONCURRENCY||'default'};})()`;
 const start=await call(expression);if(start.exceptionDetails)throw Error('stress_setup_failed');console.log('POOL_READY '+JSON.stringify(start.result?.value));
 const done=await call('Promise.all([globalThis.__acPoolDiagnostic.done,globalThis.__acPoolDiagnostic.dns])',true);if(done.exceptionDetails)throw Error('stress_failed');console.log('POOL_DONE '+JSON.stringify(done.result?.value));
 await call('delete globalThis.__acPoolDiagnostic');
}finally{for(const p of pending.values())clearTimeout(p.timer);ws.close();}
