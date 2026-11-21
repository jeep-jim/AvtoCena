/** Materialize unchanged sealed checkout bytes at the private path native 1c5f8f6 expects. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(v,c)=>{if(!v)throw Error('china_runtime_context:'+c);};
export const PRIVATE_PLAN_MAX=64*1024;
export async function materializeRuntimeContextArguments(scratch,wire,pin){
 need(path.isAbsolute(scratch)&&path.normalize(scratch)===scratch&&await fs.realpath(scratch)===scratch,'handoff_private_root');
 const root=await fs.stat(scratch);
 need(root.isDirectory()&&(root.mode&0o077)===0,'handoff_private_root');
 need(Buffer.isBuffer(wire)&&wire.length>0&&wire.length<=PRIVATE_PLAN_MAX&&/^[a-f0-9]{64}$/.test(pin??'')&&sha(wire)===pin,'handoff_context_plan_pin');
 const plan=path.join(scratch,'runtime-context-plan.json');
 const out=path.join(scratch,'avtocena-china-context-own-run');
 const h=await fs.open(plan,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  await h.writeFile(wire);const st=await h.stat(),verify=Buffer.alloc(st.size);
  need(st.isFile()&&st.nlink===1&&(st.mode&0o777)===0o600&&st.size===wire.length,'handoff_context_plan_mode');
  const {bytesRead}=await h.read(verify,{offset:0,length:verify.length,position:0}); 
  need(bytesRead===wire.length&&sha(verify)===pin,'handoff_context_plan_readback');
 }finally{await h.close();}
 return Object.freeze({plan,out,sha256:pin});
}
