import {randomUUID} from 'node:crypto';

// One synthetic conversation through the public website. Never log cookies,
// credentials or existing user sessions. Frames only belong to this probe.
const endpoint='https://avtocena.com/api/browser-pilot';
const origin='https://avtocena.com';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const initial=await fetch(endpoint,{signal:AbortSignal.timeout(20000)});
 const cookie=initial.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const available=await initial.json();
 if(!initial.ok||!available.enabled)throw Error('pilot_disabled');
 const id=randomUUID();
 async function post(action,extra={}){
  return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify({action,id,...extra}),signal:AbortSignal.timeout(20000)});
 }
 async function check(action,extra={}){
  const r=await post(action,extra),b=await r.json();
  if(!r.ok||b.state==='failed')throw Error(b.error||'probe_failed');
  return b;
 }
 async function wait(ms){
  for(let elapsed=0;elapsed<ms;elapsed+=4000){await sleep(4000);await check('heartbeat');}
 }
 async function frame(label){
  const r=await post('frame');
  if(!r.ok||!r.headers.get('content-type')?.includes('image/jpeg'))throw Error('probe_frame_failed');
  const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length<100)throw Error('probe_frame_empty');
  console.log(JSON.stringify({event:'synthetic_probe_frame',label,base64:bytes.toString('base64')}));
 }
 try{
  await check('create',{offerId:'f5a71ab88bd987740e5eaf13'});
  let ready=false;
  for(let i=0;i<25;i++){await sleep(2000);const b=await check('heartbeat');if(b.state==='ready'){ready=true;break;}}
  if(!ready)throw Error('probe_readiness_timeout');
  await wait(24000);await frame('initial_answer');
  await check('send',{text:'Уточни, о какой модели автомобиля идёт речь в этой переписке. Ответь одним предложением.'});
  await wait(24000);await frame('followup_answer');
  console.log(JSON.stringify({event:'synthetic_probe',ready:true,followupSubmitted:true}));
 }finally{
  const closed=await check('close');
  if(closed.closed!==true)throw Error('probe_close_failed');
  const r=await post('heartbeat');
  const b=await r.json();
  if(r.ok||!['session_not_found','session_closed'].includes(b.error))throw Error('probe_survived_close');
  console.log(JSON.stringify({event:'synthetic_probe_closed',closed:true,heartbeatRejected:true}));
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
