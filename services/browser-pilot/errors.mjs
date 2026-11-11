// Keep diagnostic output categorical: never persist prompts, page text or raw browser errors.
export function diagnosis(stage,error){
 const message=String(error?.message||'');
 const network=message.match(/net::(ERR_[A-Z_]+)/)?.[1];
 const known=['provider_blocked','composer_missing','provider_unavailable'].includes(message)?message:null;
 const code=known||network||(error?.name==='TimeoutError'?'timeout':/Operation not permitted|No usable sandbox|Failed to move to new namespace/i.test(message)?'sandbox_unavailable':/Executable doesn.t exist/i.test(message)?'chromium_missing':/Target.*closed|browser.*closed/i.test(message)?'browser_closed':'unexpected_error');
 return {stage:['launch','context','navigate','check','fill','submit'].includes(stage)?stage:'unknown',code};
}
export async function stage(name,fn){try{return await fn();}catch(error){error.diagnostic=diagnosis(name,error);if(name==='launch'){const lines=String(error.message||'').split('\n').filter(line=>/ERROR:|FATAL:|Operation not permitted|No usable sandbox|Executable doesn.t exist/i.test(line));console.error(JSON.stringify({event:'chromium_launch_error',details:lines.join('\n').replace(/https?:\/\/\S+/g,'[url]').slice(0,2500)}));}throw error;}}
