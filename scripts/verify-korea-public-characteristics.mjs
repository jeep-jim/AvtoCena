import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Acceptance of the saved 45002244430 intake; GETs only, no supplier or credentials.
export const KOREA_PUBLIC_ACCEPTANCE = Object.freeze({
  origin:'https://avtocena.com',
  release:'22867cbcfaee27b2e8917b6bf880e44827f67b60',
  calculationVersion:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
  previousGeneration:'gen_1794878284419_a611dfcf',
  samples:Object.freeze([
    Object.freeze({id:'009c1fcaf73d944a40ce94bc', sourceOfferId:'42799484', powerHp:76, engineCc:998}),
    Object.freeze({id:'011580d8aa566c8f87ec6080', sourceOfferId:'42760061', powerHp:193, engineCc:1598}),
  ]),
});
const PIN=KOREA_PUBLIC_ACCEPTANCE, MAX_MS=300_000, INTERVAL_MS=30_000;
const SEARCH='/api/catalog/search?market=korea&source=existing&page=1&pageSize=1';
const FUELS=new Map([['petrol','Бензин'],['diesel','Дизель'],['lpg','Газ LPG'],['cng','Газ CNG'],['electric','Электро'],['hybrid','Гибрид']]);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const decode=value=>value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[\da-f]+);/gi, entity=>{
  const known={'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>'};
  if(known[entity])return known[entity];
  const n=Number.parseInt(entity.slice(entity[2]?.toLowerCase()==='x'?3:2,-1),entity[2]?.toLowerCase()==='x'?16:10);
  return Number.isInteger(n)&&n>=0&&n<=0x10ffff?String.fromCodePoint(n):entity;
});
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
  .map(match=>[match[1],decode(match[2]??match[3])]));

/** Decode JSON only, never eval the scripts. Chunk joins precede Flight framing.
 * T records have byte-counted text bodies which may contain misleading JSON. */
export function publicFlightObjects(html) {
  const parts=[...html.matchAll(/self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\s*\)/g)]
    .map(match=>{try{return JSON.parse(match[1]);}catch{fail('public_flight_invalid');}});
  const data=Buffer.from(parts.join('')), objects=[];
  let start=0;
  while(start<data.length) {
    const colon=data.indexOf(58,start);
    const key=data.subarray(start,colon).toString();
    if(colon<0||!/^[\da-f]*$/i.test(key))fail('public_flight_invalid');
    const body=colon+1;
    // Production React also emits anonymous resource hints such as :HL[...].
    if(!key&&data[body]!==72&&data[body]!==78)fail('public_flight_invalid');
    if(data[body]===84) {
      const comma=data.indexOf(44,body+1), hex=data.subarray(body+1,comma).toString();
      if(comma<0||!/^[\da-f]+$/i.test(hex))fail('public_flight_invalid');
      start=comma+1+Number.parseInt(hex,16);
      if(start>data.length)fail('public_flight_invalid');
      if(data[start]===10)start++;
      continue;
    }
    const end=data.indexOf(10,body), next=end<0?data.length:end;
    const line=data.subarray(body,next).toString();
    // Import, resource-hint and error records are not rendered component data.
    if(line.startsWith('[')||line.startsWith('{')) {
      try{objects.push(JSON.parse(line));}catch{fail('public_flight_invalid');}
    }
    start=next+1;
  }
  const result=[], pending=[...objects];
  while(pending.length) {
    const item=pending.pop();
    if(!item||typeof item!=='object')continue;
    result.push(item);
    if(result.length>100_000)fail('public_flight_limit');
    for(const value of Object.values(item))if(value&&typeof value==='object')pending.push(value);
  }
  return result;
}

/** Both public offer identity and its actual editor/HTML must carry the values. */
export function inspectKoreaPublicDetail(html, sample) {
  const mains=[...html.matchAll(/<main\b([^>]*)>([\s\S]*?)<\/main>/gi)]
    .map(match=>({attrs:attributes(match[1]),body:match[2]})).filter(main=>main.attrs['data-offer-id']);
  if(mains.length!==1||mains[0].attrs['data-offer-id']!==sample.id)fail('public_detail_identity');
  const objects=publicFlightObjects(html);
  const offers=objects.filter(row=>row.id===sample.id&&Object.hasOwn(row,'sourceOfferId'));
  const editors=objects.filter(row=>row.offerId===sample.id&&row.initial&&row.priceIdentity);
  if(!offers.length||editors.length!==1)fail('public_detail_binding_missing');
  if(offers.some(row=>String(row.sourceOfferId)!==sample.sourceOfferId||row.sourceId!=='encar_direct'||row.market!=='korea')
    ||editors[0].priceIdentity.id!==sample.id||editors[0].priceIdentity.sourceId!=='encar_direct'
    ||editors[0].priceIdentity.market!=='korea')fail('public_detail_source_identity');
  const {attrs,body}=mains[0], initial=editors[0].initial;
  const inputs=[...body.matchAll(/<input\b[^>]*>/gi)].map(match=>attributes(match[0]));
  const input=label=>{
    const found=inputs.filter(row=>row['aria-label']===label);
    if(found.length!==1)fail('public_detail_editor_missing');
    return found[0].value;
  };
  const missing=[];
  const check=(name,values,expected)=>{
    for(const value of values) {
      if(value==null||value===''||value==='$undefined'){missing.push(name);continue;}
      if(typeof value!=='number'&&typeof value!=='string'||Number(value)!==expected)fail('public_detail_'+name+'_mismatch');
    }
  };
  check('powerHp',[...offers.map(row=>row.powerHp),initial.powerHp,input('Мощность, л.с.')],sample.powerHp);
  check('engineCc',[...offers.map(row=>row.engineCc),initial.engineCc,attrs['data-offer-share-engine-cc'],input('Объём, см³')],sample.engineCc);
  const fuels=[...offers.map(row=>row.fuel),initial.fuel,attrs['data-offer-share-fuel']];
  if(fuels.some(fuel=>fuel==null||fuel===''||fuel==='$undefined'))missing.push('fuel');
  const present=fuels.filter(fuel=>fuel!=null&&fuel!==''&&fuel!=='$undefined');
  if(present.some(fuel=>!FUELS.has(fuel))||new Set(present).size>1)fail('public_detail_fuel_mismatch');
  if(!missing.includes('fuel')) {
    const selected=[...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
      .filter(match=>attributes(match[1])['aria-pressed']==='true')
      .map(match=>decode(match[2].replace(/<[^>]*>/g,'')).trim());
    if(!selected.includes(FUELS.get(initial.fuel)))fail('public_detail_fuel_not_displayed');
  }
  return {id:sample.id,sourceOfferId:sample.sourceOfferId,powerHp:missing.includes('powerHp')?null:sample.powerHp,
    engineCc:missing.includes('engineCc')?null:sample.engineCc,fuel:missing.includes('fuel')?null:initial.fuel,
    missing:[...new Set(missing)]};
}

async function readPublic(pathname,{fetchImpl,signal,detailId}) {
  let url=new URL(pathname,PIN.origin);
  const allowed=candidate=>candidate.origin===PIN.origin&&!candidate.username&&!candidate.password
    &&(detailId?candidate.pathname===`/cars/offer/${detailId}`||candidate.pathname.startsWith(`/cars/offer/${detailId}/`)
      :candidate.pathname==='/api/health'||candidate.pathname==='/api/catalog/search');
  for(let redirects=0;redirects<=2;redirects++) {
    if(!allowed(url))fail('public_request_destination');
    let response;
    try{response=await fetchImpl(url.href,{method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',
      headers:{accept:detailId?'text/html':'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(15_000)])});}
    catch{fail(signal.aborted?'public_probe_deadline':'public_request_failed');}
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      await response.body?.cancel();
      if(!location)fail('public_redirect_invalid');
      url=new URL(location,url);continue;
    }
    if(!response.ok){await response.body?.cancel();fail('public_http_'+response.status);}
    const type=response.headers.get('content-type')||'';
    if(!type.includes(detailId?'text/html':'application/json')){await response.body?.cancel();fail('public_content_type');}
    const max=detailId?4*1024*1024:128*1024;
    if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();fail('public_response_limit');}
    const chunks=[];let bytes=0;
    try {
      for await(const chunk of response.body) {
        bytes+=chunk.length;if(bytes>max)fail('public_response_limit');chunks.push(chunk);
      }
    }catch(error){if(error.code)throw error;fail(signal.aborted?'public_probe_deadline':'public_body_failed');}
    const text=Buffer.concat(chunks).toString();
    if(detailId)return {html:text,url:url.href};
    try{return JSON.parse(text);}catch{fail('public_json_invalid');}
  }
  fail('public_redirect_limit');
}

export async function verifyKoreaPublicCharacteristics({fetchImpl=globalThis.fetch,once=false,budgetMs=MAX_MS,
  now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onProgress=()=>{}}={}) {
  if(!Number.isInteger(budgetMs)||budgetMs<1||budgetMs>MAX_MS)fail('public_probe_budget_invalid');
  const started=now(), controller=new AbortController(), timer=setTimeout(()=>controller.abort(),budgetMs);
  const request=(url,detailId)=>readPublic(url,{fetchImpl,signal:controller.signal,detailId});
  let attempt=0,last;
  const identity=async()=>{
    const [health,catalog]=await Promise.all([request('/api/health'),request(SEARCH)]);
    if(health.ok!==true||health.releaseSha!==PIN.release||health.calculationVersion!==PIN.calculationVersion)fail('public_live_identity_changed');
    if(catalog.ok!==true||!/^gen_\d+_[a-z0-9]+$/.test(catalog.generationId||'')||!(catalog.total>0)
      ||!Array.isArray(catalog.items)||catalog.items.length!==1||catalog.items[0]?.market!=='korea')fail('public_saved_catalog_invalid');
    return catalog.generationId;
  };
  try {
    while(attempt<10&&!controller.signal.aborted&&now()-started<budgetMs) {
      attempt++;
      const before=await identity();
      const samples=await Promise.all(PIN.samples.map(async sample=>{
        const {html,url}=await request(`/cars/offer/${sample.id}?market=korea`,sample.id);
        return {...inspectKoreaPublicDetail(html,sample),url};
      }));
      const after=await identity(), reasons=[];
      if(before!==after)reasons.push('generation_transition');
      if(before===PIN.previousGeneration||after===PIN.previousGeneration)reasons.push('previous_generation');
      if(samples.some(sample=>sample.missing.length))reasons.push('characteristics_missing');
      last={verified:reasons.length===0,attempts:attempt,generationId:after,release:PIN.release,
        calculationVersion:PIN.calculationVersion,supplierRequests:0,samples,reasons};
      if(last.verified||once)return last;
      // Only a stale generation / absent fields can be a cache transition. Wrong
      // identities, nonempty wrong values, transport and parser failures stop.
      const remaining=budgetMs-(now()-started);
      if(remaining<=INTERVAL_MS||attempt===10)break;
      onProgress({stage:'korea_public_cache_transition',attempt,reasons});
      await sleep(INTERVAL_MS);
    }
    return {...last,verified:false,reasons:last?.reasons||['public_probe_deadline']};
  } catch(error) {
    return {verified:false,attempts:attempt,errorCode:error.code||'public_probe_failed',supplierRequests:0};
  } finally {clearTimeout(timer);controller.abort();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--once')||args.length>1)fail('usage: node scripts/verify-korea-public-characteristics.mjs [--once]');
  verifyKoreaPublicCharacteristics({once:args.includes('--once'),
    onProgress:value=>console.error(JSON.stringify(value))}).then(result=>{
    console.log(JSON.stringify({stage:'korea_public_characteristics',...result},null,2));
    if(!result.verified)process.exitCode=1;
  });
}
