import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
export async function holdOwnerHostLease({identityFile,knownHostsFile,leaseScript,host='151.248.113.177',spawnImpl=spawn}){
 if(host!=='151.248.113.177'||![identityFile,knownHostsFile].every(v=>typeof v==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(v)))throw Error('scoped_host_arguments');
 const bytes=await fs.readFile(leaseScript);
 if(bytes.length<1||bytes.length>8192)throw Error('lease_program_bound');
 const remote="exec timeout -k 5s 480s /usr/bin/python3 -c \"\$(printf '%s' '"+bytes.toString('base64')+"' | base64 -d)\"";
 const p=spawnImpl('/usr/bin/ssh',['-T','-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
  '-o','UserKnownHostsFile='+knownHostsFile,'-o','ConnectTimeout=8','-i',identityFile,'root@'+host,remote],{stdio:['pipe','pipe','ignore']});
 const reader=createInterface({input:p.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
 let exited=false,busy=false;
 p.on('error',()=>{exited=true});p.on('exit',()=>{exited=true});p.stdin.on('error',()=>{exited=true});
 async function held(){
  if(exited||busy)throw Error('host_lease_unavailable');
  busy=true;
  let timer;
  try{
   const result=await Promise.race([reader.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('host_lease_timeout')),20000);})]);
   if(exited||result.done||result.value!=='held')throw Error('host_lease_lost');
  }finally{clearTimeout(timer);busy=false;}
 }
 try{await held();}catch(e){p.kill('SIGTERM');throw e;}
 return Object.freeze({async assertCurrent(){if(exited||busy)throw Error('host_lease_lost');p.stdin.write('recheck\n');await held();},
  close(){if(!exited)p.stdin.end('finish\n');}});
}
