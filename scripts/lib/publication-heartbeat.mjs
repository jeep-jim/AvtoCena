import {fork} from 'node:child_process';
import {once} from 'node:events';

// Renew the writer lease independently of CPU-bound normalization in the parent.
// This process has no inventory/publishing code and exits if its parent exits.
export async function startPublicationHeartbeat(config, env=process.env) {
 const child=fork(new URL('./publication-heartbeat-worker.mjs',import.meta.url),[],{
  execArgv:['--import',import.meta.resolve('tsx'),'--max-old-space-size=256'],env:{...env,NODE_OPTIONS:''},
  stdio:['ignore','ignore','inherit','ipc']
 });
 let failure=null,stopping=false;
 child.on('error',()=>{failure=Error('catalog_heartbeat_process_failed');});
 child.on('exit',()=>{if(!stopping)failure=Error('catalog_heartbeat_process_exited');});
 child.on('message',message=>{if(message?.error)failure=Error('catalog_heartbeat_renewal_failed');});
 try {
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('catalog_heartbeat_start_timeout')),30000);
   const onMessage=message=>{
    if(message?.ready||message?.error){clearTimeout(timer);child.off('message',onMessage);message.ready?resolve():reject(Error('catalog_heartbeat_start_failed'));}
   };
   child.on('message',onMessage);
   child.send(config);
  });
 } catch(error){stopping=true;child.kill();throw error;}
 return {
  assertHealthy(){if(failure)throw failure;},
  async stop(){
   stopping=true;
   if(child.exitCode!==null||child.signalCode!==null)return;
   const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  }
 };
}
