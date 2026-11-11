import {getJsonStorage} from '../apps/web/lib/data.ts';
import {catalogOverviewMarketComplete,catalogOverviewMatchesGeneration} from '../apps/web/lib/catalog/overview.ts';
import {publicationWithdrawn} from '../apps/web/lib/catalog/publication-policy.ts';
import {PUBLIC_CATALOG_MARKETS} from '../apps/web/lib/catalog/runtime-config.ts';
const expected='gen_1793052425373_c710a778',day='2026-10-28';
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_storage_required');
const timer=setTimeout(()=>{console.error('metadata_deadline');process.exit(1);},180000);
const durations={};
async function read(label,key){const start=performance.now();try{return await storage.readJson(key,null);}finally{durations[label]=Math.round(performance.now()-start);}}
try{
 const before=await read('manifestBefore','catalog/manifest.json');
 if(before?.generationId!==expected){console.log(JSON.stringify({sameGeneration:false,stage:'before'}));}
 else{
  const base='catalog/generations/'+expected+'/indexes/overview';
  const immutable=await read('immutable',base+'.json');
  const dated=await read('dated',base+'.'+day+'.json');
  const publicOverview=await read('public','catalog/public/overview.json');
  const editorial=await read('editorial','catalog-editorial/current.json');
  const after=await read('manifestAfter','catalog/manifest.json');
  const shape=(value)=>({exists:!!value,dateMatches:value?.policyDate===day,generationMatches:catalogOverviewMatchesGeneration(value,expected)});
  let selected=immutable,selectedKind='immutable';
  if(selected?.policyDate!==day&&dated?.policyDate===day&&catalogOverviewMatchesGeneration(dated,expected)){selected=dated;selectedKind='dated';}
  if(!(selected?.policyDate===day&&catalogOverviewMatchesGeneration(selected,expected))){selected=publicOverview;selectedKind='public';}
  if(!(selected?.policyDate===day&&catalogOverviewMatchesGeneration(selected,expected))){selected=null;selectedKind='none';}
  const markets=PUBLIC_CATALOG_MARKETS.map(market=>{
   const s=selected?.markets?.[market],sourceCount=Number(before.markets?.[market]?.count||0);
   const summary=s?{...s,items:(s.items||[]).filter(item=>!publicationWithdrawn(item))}:undefined;
   const hidden=Object.values(editorial?.entries||{}).filter(e=>e.market===market&&e.status!=='visible').length;
   return {market,sourceCount,overviewTotal:s?.total??null,overviewSourceTotal:s?.sourceTotal??null,
    visiblePreparedRows:summary?.items.length??0,complete:market==='japan'||catalogOverviewMarketComplete(summary,sourceCount,10),hiddenEntries:hidden};
  });
  console.log(JSON.stringify({expectedGeneration:expected,policyDate:day,sameGeneration:before.generationId===after?.generationId,
   manifestUnchanged:JSON.stringify(before)===JSON.stringify(after),durations,immutable:shape(immutable),dated:shape(dated),
   public:shape(publicOverview),selectedKind,markets}));
 }
}finally{clearTimeout(timer);}
