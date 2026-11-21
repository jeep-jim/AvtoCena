import fs from 'node:fs/promises';
import {guard as need} from '../rev5-successor-core.mjs';
const G=1024**3,M=1024**2;
export const scratchSizes=Object.freeze([24,20,16,14,12,11]);
export const hostReserveBytes=1536*M;
export function pickScratchBytes(freeBytes){
 need(Number.isSafeInteger(freeBytes)&&freeBytes>0,'scratch_free_unknown');
 const size=scratchSizes.find(g=>freeBytes>=g*G+hostReserveBytes);
 need(size,'runner_local_free_below_fixed_private_floor');
 return size*G;
}
export function createScratchMeter(root,{now=Date.now,samplingMs=5000,stat=fs.statfs,emit=console.log}={}){
 let total,peak=0,last=-Infinity,minFree=Infinity,phase='initial';
 return Object.freeze({
  async check(stage,{force=false,needBytes=640*M}={}){
   need(typeof stage==='string'&&/^[a-z0-9_]{1,45}$/.test(stage)&&Number.isSafeInteger(needBytes)&&needBytes>=640*M,'scratch_meter_contract');
   const changed=phase!==stage;phase=stage;
   if(!force&&!changed&&now()-last<samplingMs)return {peak,minFree,total};
   const x=await stat(root,{bigint:true});
   const used=Number((x.blocks-x.bavail)*x.bsize),free=Number(x.bavail*x.bsize),capacity=Number(x.blocks*x.bsize);
   need(Number.isSafeInteger(used)&&Number.isSafeInteger(free)&&Number.isSafeInteger(capacity)&&
    capacity>=10*G&&capacity<=24*G&&(total===undefined||total===capacity),'isolated_scratch_volume_bounds');
   total=capacity;peak=Math.max(peak,used);minFree=Math.min(minFree,free);last=now();
   if(force||changed||free<needBytes)emit(JSON.stringify({stage,privateScratchBytes:total,usedBytes:used,freeBytes:free,observedPeakBytes:peak,noExternalChange:true}));
   need(free>=needBytes,'measured_scratch_headroom_hold');
   return {peak,minFree,total};
  },
 });
}
