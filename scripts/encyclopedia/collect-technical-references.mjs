import{execFile}from'node:child_process';import{promisify}from'node:util';import{createHash}from'node:crypto';
import{getJsonStorage}from'../../apps/web/lib/data.ts';
const exec=promisify(execFile),storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
const root='knowledge/encyclopedia/reference-intake/v1',key=`${root}/state.json`,now=()=>new Date().toISOString();
const state=await storage.readJson(key,null)||{version:1,minimumYear:2008,pending:['https://www.drom.ru/catalog/'],visited:[],saved:0,failed:[],startedAt:now()};
const visited=new Set(state.visited),queued=new Set(state.pending),limit=Math.min(3000,Math.max(1,Number(process.env.REFERENCE_PAGE_LIMIT||3000)));
let fetched=0;
async function checkpoint(){state.visited=[...visited];state.updatedAt=now();await storage.writeJson(key,state);}
while(state.pending.length&&fetched<limit){
 const url=state.pending.shift();queued.delete(url);if(visited.has(url))continue;
 try{
  const {stdout}=await exec('python3',['scripts/encyclopedia/read-technical-reference.py',url],{timeout:65000,maxBuffer:4000000});const row=JSON.parse(stdout);if(row.error)throw Error(row.detail);
  for(const next of row.links)if(!visited.has(next)&&!queued.has(next)){queued.add(next);state.pending.push(next);}
  if(Object.keys(row.facts).length){const id=createHash('sha256').update(url).digest('hex');await storage.writeJson(`${root}/records/${id}.json`,{...row,links:undefined,retrievedAt:now()});state.saved++;}
  visited.add(url);fetched++;
  // Stable lexical order keeps each make/model together; facts remain separate from production.
  state.pending.sort((a,b)=>a.localeCompare(b));
  if(fetched%10===0){await checkpoint();console.log(JSON.stringify({fetched,totalVisited:visited.size,saved:state.saved,pending:state.pending.length}));}
 }catch(error){state.pending.unshift(url);state.failed.push({url,at:now(),message:String(error.message).slice(0,300)});state.failed=state.failed.slice(-100);await checkpoint();throw Error('reference_fetch_stopped_checkpoint_saved');}
 await new Promise(resolve=>setTimeout(resolve,1500));
}
state.completed=!state.pending.length;await checkpoint();console.log(JSON.stringify({fetched,totalVisited:visited.size,saved:state.saved,pending:state.pending.length,completed:state.completed}));
