import fs from 'node:fs';
// Run only inside the application container. Emit function counters, never heap data.
const targets=await fetch('http://127.0.0.1:9229/json/list').then(r=>r.json());
if(targets.length!==1)throw Error('unexpected_inspector_targets');
const url=new URL(targets[0].webSocketDebuggerUrl);
if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('inspector_must_be_loopback');
const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let sequence=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('inspector_timeout:'+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
try{
 if(process.env.CPU_SAMPLE_CLOSE_ONLY==='1'){}else{
 await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:2000});await call('Profiler.start');
 await new Promise(r=>setTimeout(r,5000));
 const {profile}=await call('Profiler.stop');
 const parents=new Map();for(const node of profile.nodes)for(const child of node.children||[])parents.set(child,node.id);
 const byId=new Map(profile.nodes.map(n=>[n.id,n]));
 const samples=new Map();for(const id of profile.samples||[])samples.set(id,(samples.get(id)||0)+1);
 const sources=new Map();
 const describe=id=>{const n=byId.get(id);if(!n)return null;const f=n.callFrame;let code='';if(f.url.startsWith('file:///app/apps/web/.next/server/')){try{let lines=sources.get(f.url);if(!lines){lines=fs.readFileSync(new URL(f.url),'utf8').split('\n');sources.set(f.url,lines);}code=lines[f.lineNumber]?.slice(Math.max(0,f.columnNumber-80),f.columnNumber+1800)||'';}catch{}}return {fn:f.functionName,url:f.url,line:f.lineNumber,column:f.columnNumber,code};};
 console.log('CPU_SAMPLE',JSON.stringify({samples:profile.samples?.length,top:[...samples].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([id,count])=>({count,stack:[id,parents.get(id),parents.get(parents.get(id))].filter(Boolean).map(describe)}))}));
 await call('Profiler.disable');
 }
}finally{
 // Close the temporary listener from the sampled process; never publish its port.
 ws.send(JSON.stringify({id:++sequence,method:'Runtime.evaluate',params:{expression:'process._debugEnd()'}}));
 await new Promise(r=>setTimeout(r,500));ws.close();
}
