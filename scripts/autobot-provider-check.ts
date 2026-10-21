import {readAutobotConfig,publicConfig} from '../apps/web/lib/autobot/config';
async function main(){
 const c=await readAutobotConfig();console.log('CURRENT_CONFIG',JSON.stringify(publicConfig(c)));
 const u=new URL(c.endpoint);u.pathname=u.pathname.replace(/\/chat\/completions$/,'/models');
 const r=await fetch(u,{headers:{Authorization:'Bearer '+c.token},redirect:'error',signal:AbortSignal.timeout(20000)});
 console.log('MODELS_STATUS',r.status);if(!r.ok){await r.body?.cancel();return;}
 const data=await r.json();console.log('DEEPSEEK_MODELS',JSON.stringify((data.data||[]).filter((x:any)=>/deepseek/i.test(x.id)).map((x:any)=>({id:x.id,owned_by:x.owned_by,context_length:x.context_length,pricing:x.pricing}))));
}
main().catch(()=>{console.log('DIAGNOSTIC_FAILED');process.exitCode=1;});
