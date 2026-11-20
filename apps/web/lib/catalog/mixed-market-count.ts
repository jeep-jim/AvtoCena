export type MixedMarketCount={total:number|null;countIncomplete:boolean;marketCounts:Record<string,number>;missingMarkets:string[]};
/** A shared deadline bounds the browser response even if downstream ignores
 * abortion. Only exact successful market counts are totaled. Unknown isn't zero. */
export async function readMixedMarketCounts(
 markets:readonly string[],read:(market:string,signal:AbortSignal)=>Promise<Response>,
 {timeoutMs=3500,signal}:{timeoutMs?:number;signal?:AbortSignal}={},
):Promise<MixedMarketCount>{
 if(markets.length<2||markets.length>7||new Set(markets).size!==markets.length||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('mixed_market_count_scope');
 const deadline=new AbortController();
 const timer=setTimeout(()=>deadline.abort(),timeoutMs);
 const active=signal?AbortSignal.any([deadline.signal,signal]):deadline.signal;
 try{
  const one=async(market:string)=>{
   if(active.aborted)return;
   let end:()=>void=()=>{};
   const interrupted=new Promise<undefined>(resolve=>{
    end=()=>resolve(undefined);
    active.addEventListener('abort',end,{once:true});
   });
   const lookup=async()=>{
    try{
     const response=await read(market,active);
     if(!response.ok)return;
     const body=await response.json();
     const count=body?.total;
     return !active.aborted&&body?.ok===true&&body.countIncomplete!==true&&body.partial!==true&&
      Number.isSafeInteger(count)&&count>=0&&count<=10_000_000?Number(count):undefined;
    }catch{return;}
   };
   try{return await Promise.race([interrupted,lookup()]);}
   finally{active.removeEventListener('abort',end);}
  };
  const exact=await Promise.all(markets.map(one));
  const marketCounts:Record<string,number>={},missingMarkets:string[]=[];
  markets.forEach((m,i)=>{const count=exact[i];if(count===undefined)missingMarkets.push(m);else marketCounts[m]=count;});
  return {marketCounts,missingMarkets,countIncomplete:missingMarkets.length>0,
   total:missingMarkets.length===markets.length?null:Object.values(marketCounts).reduce((a,b)=>a+b,0)};
 }finally{clearTimeout(timer);}
}
