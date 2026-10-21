// Retry idempotent reads only. A lost DELETE response must not replay a mutation.
export async function yandexJsonRequest(url,{token,method='GET',fetchImpl=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const attempts=method==='GET'?5:1;
 for(let attempt=0;attempt<attempts;attempt++){
  let delay=Math.min(8000,1000*2**attempt);
  try{
   const response=await fetchImpl(url,{method,headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
   if(!response.ok){
    const seconds=Number(response.headers.get('retry-after'));
    if(Number.isFinite(seconds)&&seconds>0)delay=Math.min(30000,seconds*1000);
    const error=Object.assign(new Error(`${method} ${new URL(url).pathname}: ${response.status}`),{httpStatus:response.status,retryable:[408,429,500,502,503,504].includes(response.status)});
    await response.body?.cancel().catch(()=>{});throw error;
   }
   return await response.json();
  }catch(error){
   if(attempt+1===attempts || (error.httpStatus && !error.retryable))throw error;
   await pause(delay);
  }
 }
}
