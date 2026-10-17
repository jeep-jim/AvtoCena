import {spawn} from 'node:child_process';
import {transientOperationFailure} from './lib/transient-operation.mjs';
const [command,...args]=process.argv.slice(2);if(!command)throw Error('missing_command');
const max=3;
let child,stopped=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;child?.kill(signal);});
for(let attempt=1;attempt<=max;attempt++){
 let tail='';
 const code=await new Promise((resolve,reject)=>{
  child=spawn(command,args,{stdio:['inherit','pipe','pipe'],env:process.env});
  const consume=(stream,target)=>stream.on('data',chunk=>{target.write(chunk);tail=(tail+chunk.toString()).slice(-1024*1024);});
  consume(child.stdout,process.stdout);consume(child.stderr,process.stderr);
  child.on('error',reject);child.on('close',code=>resolve(code??1));
 });
 if(code===0){process.exitCode=0;break;}
 if(stopped||attempt===max||!transientOperationFailure(tail)){process.exitCode=Number(code)||1;break;}
 console.warn(`Transient operation failure: retry ${attempt+1}/${max} in ${attempt*30}s; publication guards unchanged.`);
 await new Promise(resolve=>setTimeout(resolve,attempt*30000));
 if(stopped){process.exitCode=1;break;}
}
