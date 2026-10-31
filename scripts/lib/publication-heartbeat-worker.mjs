import {mutateDataJson} from '../../apps/web/lib/data.ts';
process.on('disconnect',()=>process.exit(0));
process.once('message',async config=>{
 const {key,operationId,ttlMs,intervalMs}=config||{};
 if(key!=='catalog/import-lock.json'||!/^catalog_v3_publish_[a-z]+_[a-f0-9-]+$/.test(operationId||'')
   ||!Number.isFinite(ttlMs)||!Number.isFinite(intervalMs)||intervalMs<=0||ttlMs<=intervalMs){process.send?.({error:true});process.exitCode=1;process.disconnect();return;}
 let busy=false;
 async function renew(){
  if(busy)return true;busy=true;
  try {
   await mutateDataJson(key,{lockedUntil:''},current=>{
    if(current?.operationId!==operationId||!(Date.parse(current.lockedUntil)>Date.now()))throw Error('catalog_publish_lock_lost');
    return {...current,lockedUntil:new Date(Date.now()+ttlMs).toISOString(),heartbeatAt:new Date().toISOString()};
   });
   return true;
  } catch {process.send?.({error:true});return false;}
  finally {busy=false;}
 }
 if(!await renew()){process.disconnect();return;}
 process.send?.({ready:true});
 setInterval(async()=>{if(!await renew())process.exit(1);},intervalMs);
});
