type Query={id:string;markets?:string[]};
type Loaders={related:(query:Query)=>Promise<unknown>;alternatives:(query:Query)=>Promise<unknown>};
const MARKETS=new Set(['japan','china','korea','uae','europe','georgia']);
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',...(status===503?{'Retry-After':'5'}:{})}});

/** Background recommendations must not queue unbounded work behind live pages.
 * Slots contain no visitor data and are released only when the actual work ends.
 * No supplier result is shared between requests or visitor IPs here. */
export function createRecommendationsHandler(loaders:Loaders,maxConcurrent=2) {
  let active=0;
  return async(request:Request)=>{
    const p=new URL(request.url).searchParams;
    const kind=p.get('kind')||'related',id=p.get('id')||'';
    const markets=p.has('markets')?[...new Set((p.get('markets')||'').split(',').filter(Boolean))]:undefined;
    if(!['related','alternatives'].includes(kind)||(kind==='related'&&!id)
      ||(id&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id))
      ||markets?.some(market=>!MARKETS.has(market)))return response({error:'invalid_query'},400);
    if(request.signal.aborted)return response({error:'request_cancelled'},408);
    if(active>=maxConcurrent)return response({error:'recommendations_busy'},503);
    active++;
    try{return response(await loaders[kind as keyof Loaders]({id,markets}));}
    catch{return response({error:'recommendations_unavailable'},503);}
    finally{active--;}
  };
}
