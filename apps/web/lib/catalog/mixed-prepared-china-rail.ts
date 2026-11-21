import type {CatalogSearchParams} from './types';

type MixedRail = {total:number;items:any[]};
type Read = (params:CatalogSearchParams,options:{
 countOnly:false;includeFacets:false;marketPage:false;unsupported:boolean;expectedGeneration:string; signal:AbortSignal
})=>Promise<MixedRail|null>;

/** Bound the shared response without hiding a stalled direction as zero.
 * Runtime readers cooperate between reads; one already-started I/O may still settle. */
export async function readMixedPreparedChinaRail(
 read:Read, query:CatalogSearchParams, pageSize:number, scope:{source:string;stock:string;cut:string}, timeoutMs=20_000,
):Promise<MixedRail> {
 const deadline=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const interrupted=new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{
   const error=new Error('catalog_mixed_china_deadline');
   deadline.abort(error);
   reject(error);
  },timeoutMs);
 });
 try{
  const response=await Promise.race([interrupted,read({...query,market:'china',page:1,pageSize},{
   countOnly:false,includeFacets:false,marketPage:false,unsupported:Boolean(scope.source||scope.stock),
   expectedGeneration:scope.cut,signal:deadline.signal,
  })]);
  if(!response||!Number.isSafeInteger(response.total)||response.total<0||
     !Array.isArray(response.items)||response.items.length!==Math.min(pageSize,response.total))
   throw Error('catalog_mixed_china_unavailable');
  return response;
 }finally{clearTimeout(timer);}
}

export function includeMixedChinaRailCount(
 ordinary:{total:number;countIncomplete:boolean}, china?:{total:number;unavailable?:boolean},
){
 return {total:ordinary.total+(china?.unavailable?0:china?.total??0),
  countIncomplete:ordinary.countIncomplete||Boolean(china?.unavailable)};
}
