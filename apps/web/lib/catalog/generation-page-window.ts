import {datedCatalogPagePath} from './dated-pages';

type Landing = {
  generationId:string; market:string; policyDate?:string; sourceTotal:number;
  total:number; items:unknown[]; facets:{generationId:string};
};
type Overview = {
  generationId:string; policyDate?:string; facets:{generationId:string};
  markets:Record<string,{sourceTotal?:number;total:number;items:unknown[]}>;
};
const policyDay=(date:Date)=>new Date(date.getTime()+7*3600000).toISOString().slice(0,10);

/** Build the exact current and next two policy days from the rows already held
 * by the publisher. No source requests or active-manifest writes are permitted.
 * The caller may publish its manifest only after this promise succeeds. */
export async function stageGenerationPageWindow<Row extends {market:string}, L extends Landing, O extends Overview>({
  generationId, markets, rowsByMarket, landingLimit, overviewLimit, buildLanding, prepareRows, buildOverview,
  landingPath, overviewPath, write, now=()=>new Date(),
}: {
  generationId:string; markets:readonly string[]; rowsByMarket:ReadonlyMap<string,Row[]>;
  landingLimit:number; overviewLimit:number;
  buildLanding:(generation:string,market:string,rows:Row[],date:Date)=>Promise<L>;
  prepareRows:(rows:Row[],date:Date)=>Row[];
  buildOverview:(generation:string,rows:Row[],date:Date)=>Promise<O>;
  landingPath:(generation:string,market:string)=>string;
  overviewPath:(generation:string)=>string;
  write:(path:string,value:L|(O&{dailyLandingsVersion:1}))=>Promise<unknown>;
  now?:()=>Date;
}) {
  if(!/^[a-zA-Z0-9_-]+$/.test(generationId)||!markets.length||new Set(markets).size!==markets.length
      ||!Number.isSafeInteger(landingLimit)||landingLimit<1||!Number.isSafeInteger(overviewLimit)||overviewLimit<1)
    throw Error('catalog_generation_pages_scope_invalid');
  const prefix=`catalog/generations/${generationId}/indexes/`;
  const scoped=(path:string)=>{
    if(!path.startsWith(prefix)||path.includes('..'))throw Error('catalog_generation_pages_unscoped_write');
    return path;
  };
  for(const [market,rows] of rowsByMarket){
    if(!markets.includes(market)||rows.some(row=>row.market!==market))throw Error('catalog_generation_pages_market_invalid');
  }
  const captured=now();
  const dates=Array.from({length:3},(_,offset)=>new Date(captured.getTime()+offset*86400000));
  const policyDates=dates.map(policyDay);
  const checkWindow=()=>{
    if(!policyDates.includes(policyDay(now())))throw Error('catalog_generation_pages_window_expired');
  };
  let currentOverview:(O&{dailyLandingsVersion:1})|undefined;
  for(const [offset,date] of dates.entries()){
    const day=policyDates[offset],prepared:Row[]=[],counts:Record<string,number>={};
    const target=(path:string)=>scoped(offset?datedCatalogPagePath(path,day):path);
    for(const market of markets){
      const rows=rowsByMarket.get(market)||[],landing=await buildLanding(generationId,market,rows,date);
      if(landing.generationId!==generationId||landing.facets.generationId!==generationId||landing.market!==market
          ||landing.policyDate!==day||landing.sourceTotal!==rows.length||!Number.isSafeInteger(landing.total)
          ||landing.total<0||landing.total>rows.length||landing.items.length>landing.total
          ||landing.items.length<Math.min(landingLimit,landing.total))
        throw Error('catalog_generation_pages_landing_invalid');
      checkWindow();
      await write(target(landingPath(generationId,market)),landing);
      for(const row of prepareRows(rows,date))prepared.push(row);
      counts[market]=rows.length;
    }
    const overview=await buildOverview(generationId,prepared,date);
    if(overview.generationId!==generationId||overview.facets.generationId!==generationId||overview.policyDate!==day)
      throw Error('catalog_generation_pages_overview_invalid');
    for(const market of markets){
      const summary=overview.markets[market];
      if(!summary||!Number.isSafeInteger(summary.total)||summary.total<0||summary.total>counts[market]
          ||summary.items.length>summary.total||summary.items.length<Math.min(overviewLimit,summary.total))
        throw Error('catalog_generation_pages_overview_incomplete');
      summary.sourceTotal=counts[market];
    }
    const complete=Object.assign(overview,{dailyLandingsVersion:1 as const});
    checkWindow();
    await write(target(overviewPath(generationId)),complete);
    if(offset===0)currentOverview=complete;
  }
  checkWindow();
  if(!currentOverview)throw Error('catalog_generation_pages_overview_missing');
  return {overview:currentOverview,policyDates};
}
