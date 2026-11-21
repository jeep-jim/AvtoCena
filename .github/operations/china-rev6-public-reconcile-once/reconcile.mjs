import {pathToFileURL} from 'node:url';
const ORIGIN='https://avtocena.com',GEN='gen_1795239842026_china44871616387';
const RELEASE='22867cbcfaee27b2e8917b6bf880e44827f67b60',CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const ID=/^[a-f0-9]{24}$/,FORD='f011736e0fada0af4e0a7491';
const need=(b,s)=>{if(!b)throw Error('china_rev6_reconcile:'+s)};
const positive=x=>Number.isSafeInteger(x)&&x>0;
function urlFor(id){return '/cars/offer/'+id+'?'+new URLSearchParams({market:'china',preparedCut:GEN});}
export function classifyPublicCard(body,id,expectedRub){
 const mains=[...body.matchAll(/<main\b[^>]*>/gi)].map(x=>x[0]);
 const m=mains.find(x=>/\bdata-offer-id\s*=/.test(x));
 const priced=/(?:^|\s)data-offer-price-rub="(\d+)"/.exec(m??'');
 const seen=/(?:^|\s)data-offer-id="([a-f0-9]{24})"/.exec(m??'');
 const unavailableMain=mains.some(x=>/class="[^"]*\bac-unavailable-main\b[^"]*"/.test(x));
 const heading=/<h1\b[^>]*\bid="unavailable-offer-title"[^>]*>([\s\S]{0,500}?)<\/h1>/i.exec(body)?.[1]??'';
 const clean=heading.replace(/<!--[^]*?-->|<[^>]+>/g,'').replaceAll('&nbsp;',' ').trim();
 return {activeCardMarker:!!m,expectedCardId:seen?.[1]===id,cardPricePresent:positive(Number(priced?.[1])),
  expectedCardPrice:expectedRub!==undefined&&Number(priced?.[1])===expectedRub,unavailableMain,
  unavailableHeading:['Этот автомобиль больше недоступен','Этот автомобиль продан'].includes(clean),
  temporaryCalculationHeading:clean==='Расчёт временно недоступен',
  nextRedirectSurface:/NEXT_REDIRECT|http-equiv="refresh"/.test(body)};
}
export async function reconcile({fetcher=fetch}={}){
 let requests=0,bytes=0;const limit=AbortSignal.timeout(95_000);
 const get=async(raw,max,accept,id)=>{
  let u=new URL(raw,ORIGIN);let hops=0,queryStayed=true;
  do{
   need(u.origin===ORIGIN&&!u.username&&!u.password&&!u.hash&&++requests<=12,'request_scope');
   const r=await fetcher(u,{method:'GET',redirect:'manual',cache:'no-store',signal:limit,
    headers:{accept,'cache-control':'no-cache'}});
   const status=r.status;
   if([301,302,303,307,308].includes(status)&&id){
    const where=r.headers.get('location');
    await r.body?.cancel();
    if(!where||hops>=2)return {status,hops,redirectScoped:false,queryStayed,text:''};
    const v=new URL(where,u);
    if(v.origin!==ORIGIN||v.username||v.password||v.hash||
      !new RegExp('^/cars/offer/'+id+'(?:/[a-z0-9-]{1,160})?$').test(v.pathname)||
      v.searchParams.get('market')!=='china'||v.searchParams.get('preparedCut')!==GEN||[...v.searchParams].length!==2)
     return {status,hops,redirectScoped:false,queryStayed:false,text:''};
    u=v;hops++;continue;
   }
   if(!r.body)return {status,hops,redirectScoped:true,queryStayed,text:''};
   const chunks=[];let n=0;
   for await(const b of r.body){n+=b.byteLength;bytes+=b.byteLength;need(n<=max&&bytes<=12*1024**2,'response_scope');chunks.push(b);}
   return {status,hops,redirectScoped:true,queryStayed,text:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))};
  }while(true);
 };
 const h=await get('/api/health',64*1024,'application/json');
 const health=JSON.parse(h.text);
 need(h.status===200&&health.ok===true&&health.releaseSha===RELEASE&&health.calculationVersion===CALC,'exact_public_runtime');
 const q='/api/catalog/search?'+new URLSearchParams({market:'china',make:'BMW',model:'X3',sort:'totalRub',page:'1',pageSize:'1',preparedCut:GEN});
 const [list,ford]=await Promise.all([get(q,512*1024,'application/json'),get(urlFor(FORD),5*1024**2,'text/html',FORD)]);
 const x=JSON.parse(list.text),row=x.items?.[0];need(list.status===200&&x.ok===true&&x.generationId===GEN&&ID.test(row?.id)&&
  row?.preparedChinaSelection?.generationId===GEN&&positive(row.totalRub)&&positive(x.total),'exact_public_list');
 const priced=await get(urlFor(row.id),5*1024**2,'text/html',row.id);
 const pricedFacts=classifyPublicCard(priced.text,row.id,row.totalRub),fordFacts=classifyPublicCard(ford.text,FORD);
 const publicUnavailable=[404,410].includes(ford.status)||(ford.status===200&&fordFacts.unavailableMain&&fordFacts.unavailableHeading&&!fordFacts.activeCardMarker);
 return {kind:'china_rev6_discriminated_public_no_write',generation:x.generationId,filteredCount:x.total,
  pricedCard:{status:priced.status,hops:priced.hops,redirectScoped:priced.redirectScoped,...pricedFacts},
  fordCard:{status:ford.status,hops:ford.hops,redirectScoped:ford.redirectScoped,...fordFacts,publicUnavailable},
  oldGuard:{pricedId:pricedFacts.expectedCardId,pricedAmount:pricedFacts.expectedCardPrice,fordUnavailable:publicUnavailable},
  readOnly:true,requests,providerRequests:0,cursorWrites:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await reconcile()));}catch(e){const s=e instanceof Error?e.message:'';console.log(JSON.stringify({
  kind:'china_rev6_public_reconcile_held',reason:/^china_rev6_reconcile:[a-z_]+$/.test(s)?s:'public_transport_or_parse',
  readOnly:true,providerRequests:0,cursorWrites:0}));process.exitCode=2;}
}
