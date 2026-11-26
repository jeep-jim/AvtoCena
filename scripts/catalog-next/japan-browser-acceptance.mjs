import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const ORIGIN='https://avtocena.com';
const SCOPE='catalog-japan-recovery-v1';
const COMPLETION_SCOPE='catalog-japan-completion-v1';
const CARD='article.ac-catalog-card,article.ac-catalog-list-row';
const CITY='Новокузнецк';
const QUERY=new URLSearchParams({market:'japan',page:'1',pageSize:'24',city:CITY});
const PLAIN='/api/catalog/search?'+QUERY;
const POWER=PLAIN+'&powerTo=160';
const PETROL_POWER=POWER+'&fuel=petrol';
const PETROL_POWER_NEXT=PETROL_POWER.replace('page=1&','page=2&');
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(value,code)=>{if(!value)throw Error('japan_browser_'+code);};
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function japanPetrolPowerUrl(value,pageNumber=1){
 let url;try{url=new URL(value,ORIGIN);}catch{return false;}
 return url.origin===ORIGIN&&(url.pathname==='/cars/japan'||url.pathname==='/cars'&&url.searchParams.get('market')==='japan')
  &&url.searchParams.get('fuel')==='petrol'&&url.searchParams.get('powerTo')==='160'
  &&url.searchParams.get('city')===CITY&&Number(url.searchParams.get('page')||'1')===pageNumber;
}

export function japanReleaseBinding(oracle,release,nonce){
 need(/^[a-f0-9]{40}$/.test(release||'')&&/^[a-f0-9]{32}$/.test(nonce||''),'arguments');
 need(oracle?.version===1&&oracle.runtimeSha===release
  &&/^gen_china_[0-9]+_[0-9]+$/.test(oracle.expectedGeneration||'')
  &&/^[a-f0-9]{64}$/.test(oracle.generationManifestSha256||''),'oracle_binding');
 return {generationId:oracle.expectedGeneration,generationManifestSha256:oracle.generationManifestSha256};
}

export function verifyJapanPage(payload,status,now=Date.now()){
 need(status===200&&payload?.ok===true,'http');
 const observed=Date.parse(payload.observedAt||payload.generationId||'');
 need(payload.stale===false&&!payload.partial&&!payload.interrupted&&!payload.scanLimited,'unavailable_or_stale');
 need(Number.isFinite(observed)&&observed<=now+60_000&&now-observed<30*60_000,'observation_expired');
 need(Array.isArray(payload.items)&&payload.items.length>0&&payload.items.length<=24
  &&payload.items.every(row=>row.market==='japan'&&/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id||''))
  &&new Set(payload.items.map(row=>row.id)).size===payload.items.length,'rows');
 return {status,shown:payload.items.length,received:payload.received??null,observedAt:new Date(observed).toISOString(),
  ageSeconds:Number(((now-observed)/1000).toFixed(3)),stale:false,partial:false,
  total:Number.isSafeInteger(payload.total)?payload.total:null,hasMore:payload.hasMore===true};
}

/** Preserve only public response aggregates before validation can reject them.
 * An interrupted continuation must remain diagnosable without publishing rows,
 * supplier URLs, visitor data or arbitrary upstream error text. */
export function japanResponseObservation(payload,status){
 const natural=value=>Number.isSafeInteger(value)&&value>=0?value:null;
 const boolean=value=>typeof value==='boolean'?value:null;
 const sourceDate=payload?.observedAt||payload?.generationId;
 const observed=typeof sourceDate==='string'?Date.parse(sourceDate):NaN;
 return {status:Number.isInteger(status)&&status>=100&&status<=599?status:null,
  ok:boolean(payload?.ok),shown:Array.isArray(payload?.items)?payload.items.length:null,
  received:natural(payload?.received),observedAt:Number.isFinite(observed)?new Date(observed).toISOString():null,
  stale:boolean(payload?.stale),partial:boolean(payload?.partial),interrupted:boolean(payload?.interrupted),
  scanLimited:boolean(payload?.scanLimited),hasMore:boolean(payload?.hasMore),total:natural(payload?.total)};
}

export function verifyJapanWarmPage(first,second){
 need((first.observedAt||first.generationId)===(second.observedAt||second.generationId)
  &&JSON.stringify(first.items.map(row=>row.id))===JSON.stringify(second.items.map(row=>row.id)),'warm_changed');
 return {sameObservation:true,sameRows:true};
}

export function verifyJapanPowerPage(payload,pageNumber=1){
 need(Number.isSafeInteger(pageNumber)&&pageNumber>=1,'power_page_number');
 let localPower=0,supplierPower=0,unknownPower=0;
 for(const row of payload.items){
  if(positive(row.powerHp)){
   need(row.powerHp<=160&&!row.japanSupplierPower&&row.japanPowerUnknown!==true,'local_power');localPower++;
  }else if(row.japanSupplierPower){
   const power=row.japanSupplierPower;
   need(power.offerId===row.id&&power.unit==='hp'&&power.source==='ajes_pw'
    &&Number.isSafeInteger(power.hp)&&power.hp>0&&power.hp<=160&&row.japanPowerUnknown!==true,'supplier_power');supplierPower++;
  }else{need(row.japanPowerUnknown===true,'unknown_unlabelled');unknownPower++;}
 }
 const expected={shown:payload.items.length,localPower,supplierPower,unknownPower};
 need(payload.powerFilterSummary&&Object.entries(expected).every(([key,value])=>payload.powerFilterSummary[key]===value),'power_summary');
 // A supplier count is an upper bound until the local predicate is exhausted.
 if(payload.hasMore||pageNumber>1)need(payload.total===null&&(!payload.countSummary||payload.countSummary.upperBound===true),'false_exact_count');
 else need(payload.total===payload.items.length&&payload.countSummary?.total===payload.items.length&&payload.countSummary?.upperBound===false,'exhausted_count');
 return {...expected,unknownRetainedAndLabelled:true,countHonest:true};
}

export function japanVerificationRequestScope(url,method,resourceType){
 if(!['GET','HEAD'].includes(method))return 'mutation';
 let value,pathname;try{value=new URL(url);pathname=decodeURIComponent(value.pathname);}catch{return 'external';}
 if(value.username||value.password)return 'external';
 if(value.origin!==ORIGIN){
  // Japan photos are intentionally direct. Permit only the same immutable image
  // URL shapes accepted by ajesImageUrl, never supplier APIs or external scripts.
  const authority=/^https:\/\/([^/?#]*)/i.exec(url)?.[1];
  if(resourceType==='image'&&value.protocol==='https:'&&authority?.toLowerCase()===value.hostname
   &&!value.port&&!value.search&&!value.hash&&!/[?#]/.test(url)
   &&/^(?:7\.tru\.ru|7\.ajes\.com|8\.ajes\.com|9\.ajes\.com)$/.test(value.hostname)
   &&/^\/imgs?\/[A-Za-z0-9_-]+(?:&(?:h|w)=\d+)*$/.test(value.pathname))return 'supplier_image';
  return 'external';
 }
 if(/[\\\x00-\x1f\x7f]/.test(pathname)||/^(?:\/crm|\/admin|\/api\/(?:crm|admin|internal))(?:\/|$)/.test(pathname))return 'private';
 return 'allowed';
}

const CALCULATION_KEYS=new Set(['vehicleCategory','grossVehicleWeightKg','n1IceFuel','year','productionMonth','productionDay',
 'transportToBorderRub','engineCc','fuel','powerHp','powerKw','hybridKind','power30MinKw','power30MinHp',
 'icePowerKw','icePowerHp','deliveryCity','customsCalculationDate']);
const empty=value=>value===undefined||value==='';

/** One ephemeral, public calculation for the exact observed petrol listing.
 * The route validates a scenario and returns it without saving the offer,
 * encyclopedia, CRM or editorial data. No other POST receives this exception. */
export function japanCalculationReadGrant(row,city=CITY,detailHref=ORIGIN+'/cars/offer/'+row?.id){
 const power=row?.japanSupplierPower;
 need(row?.market==='japan'&&/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id||'')&&row.fuel==='petrol'
  &&power?.offerId===row.id&&power.source==='ajes_pw'&&power.unit==='hp'
  &&power.combustionPreviewEligible===true&&Number.isSafeInteger(power.hp)&&power.hp>0&&power.hp<=160
  &&!positive(row.powerHp)&&!positive(row.powerKw)
  &&row.japanPowerUnknown!==true&&city===CITY
  &&Number.isInteger(row.year)&&row.year>=2008&&row.year<=new Date().getUTCFullYear()+1
  &&Number.isInteger(row.engineCc)&&row.engineCc>=300&&row.engineCc<=3000
  &&row.sourceCurrency==='JPY'&&positive(row.sourcePrice),'calculation_binding');
 let detail;try{detail=new URL(detailHref,ORIGIN);}catch{}
 const offerPath='/cars/offer/'+row.id;
 need(detail?.origin===ORIGIN&&!detail.username&&!detail.password&&!detail.hash
  &&(detail.pathname===offerPath||detail.pathname.startsWith(offerPath+'/'))
  &&(!detail.searchParams.has('city')||detail.searchParams.get('city')===city),'calculation_detail_binding');
 return {offerId:row.id,powerHp:power.hp,year:row.year,engineCc:row.engineCc,
  sourceCurrency:row.sourceCurrency,sourcePrice:row.sourcePrice,detailUrl:detail.href,
  city,requests:0,bodySha256:null,body:null,response:null};
}

export function checkedJapanCalculationRead({url,method,resourceType,frameUrl,headers,body},grant){
 if(!grant||grant.requests>=2||method!=='POST'||!['fetch','xhr'].includes(resourceType)||typeof body!=='string'
  ||Buffer.byteLength(body)>4096)return null;
 const target=ORIGIN+'/api/catalog/offer/'+grant.offerId+'/calculate';
 let frame;try{frame=new URL(frameUrl);}catch{return null;}
 const offerPath='/cars/offer/'+grant.offerId;
 if(url!==target||frame.href!==grant.detailUrl||frame.origin!==ORIGIN
  ||!(frame.pathname===offerPath||frame.pathname.startsWith(offerPath+'/'))
  ||headers?.origin!==ORIGIN||!/^application\/json(?:\s*;|$)/i.test(headers?.['content-type']||''))return null;
 let draft;try{draft=JSON.parse(body);}catch{return null;}
 if(!draft||Array.isArray(draft)||typeof draft!=='object'||Object.keys(draft).some(key=>!CALCULATION_KEYS.has(key))
  ||Object.values(draft).some(value=>typeof value!=='string')||draft.fuel!=='petrol'
  ||draft.deliveryCity!==grant.city||Number(draft.powerHp)!==grant.powerHp
  ||Number(draft.year)!==grant.year||Number(draft.engineCc)!==grant.engineCc
  ||(!empty(draft.powerKw)&&(!positive(Number(draft.powerKw))||Math.abs(Number(draft.powerKw)-grant.powerHp*0.73549875)>0.00001))
  ||!['','M1',undefined].includes(draft.vehicleCategory)
  ||['grossVehicleWeightKg','n1IceFuel','transportToBorderRub','hybridKind','power30MinKw','power30MinHp',
    'icePowerKw','icePowerHp','customsCalculationDate'].some(key=>!empty(draft[key])))return null;
 for(const [key,max] of [['productionMonth',12],['productionDay',31]])if(!empty(draft[key])
  &&(!Number.isInteger(Number(draft[key]))||Number(draft[key])<1||Number(draft[key])>max))return null;
 if(!empty(draft.productionDay)&&empty(draft.productionMonth))return null;
 const canonical=JSON.stringify(Object.fromEntries(Object.entries(draft).sort(([a],[b])=>a.localeCompare(b))));
 if(grant.bodySha256&&grant.bodySha256!==sha(canonical))return null;
 return {draft,bodySha256:sha(canonical)};
}

export function verifyJapanDeliveredCalculation(value,status,grant){
 need(status===200&&value?.requiresConfirmation===true&&value?.customs?.status==='ready','calculation_response');
 const car=value.breakdown?.find(row=>row.id==='car');
 need(positive(value.totalRub)&&positive(car?.amountRub)&&value.totalRub>car.amountRub,'calculation_total');
 need(value.deliveryQuote?.city===grant.city&&positive(value.deliveryQuote?.amountRub)
  &&value.deliveryQuote?.status==='estimated','calculation_city');
 need(Array.isArray(value.breakdown)&&value.breakdown.length>1
  &&value.breakdown.every(row=>typeof row.id==='string'&&typeof row.amountRub==='number'&&Number.isFinite(row.amountRub)),
  'calculation_breakdown');
 need(value.currencyRate?.currency===grant.sourceCurrency&&value.currencyRate?.sourcePrice===grant.sourcePrice
  &&positive(value.currencyRate?.sourcePriceRub)&&Math.round(value.currencyRate.sourcePriceRub)===car.amountRub,
  'calculation_source_price');
 need(Math.abs(value.breakdown.reduce((total,row)=>total+row.amountRub,0)-value.totalRub)<0.01,'calculation_ledger');
 return {status,totalRub:value.totalRub,carRub:car.amountRub,city:grant.city,
  deliveryRub:value.deliveryQuote.amountRub,customsReady:true,requiresConfirmation:true};
}

export async function installReadFence(context,report,{getCalculationGrant}={}){
 report.blockedRequests={mutation:0,external:0,private:0,redirect:0};
 report.supplierImageRequests=0;
 if(getCalculationGrant)report.japanPreviewCalculationRequests=0;
 await context.route('**/*',async route=>{
  const request=route.request();let scope=japanVerificationRequestScope(request.url(),request.method(),request.resourceType());
  const grant=getCalculationGrant?.();let calculation;
  if(scope==='mutation'&&grant){
   let frameUrl;try{frameUrl=request.frame().url();}catch{}
   calculation=checkedJapanCalculationRead({url:request.url(),method:request.method(),resourceType:request.resourceType(),
    frameUrl,headers:request.headers(),body:request.postData()},grant);
   if(calculation)scope='calculation_read';
  }
  if(!['allowed','supplier_image','calculation_read'].includes(scope)){report.blockedRequests[scope]++;await route.abort('blockedbyclient');return;}
  let response;
  try{
   // The read fence must not impose a shorter deadline than the page check.
   if(scope==='supplier_image')report.supplierImageRequests++;
   if(scope==='calculation_read'){
    grant.requests++;grant.bodySha256=calculation.bodySha256;grant.body=calculation.draft;
    report.japanPreviewCalculationRequests++;
   }
   response=await route.fetch({maxRedirects:0,timeout:90_000});
   if(response.status()>=300&&response.status()<400&&response.status()!==304){
    report.blockedRequests.redirect++;await route.abort('blockedbyclient');
   }else{
    if(scope==='calculation_read'){
     const raw=await response.body();need(raw.length<=128*1024,'calculation_response_size');
     grant.response={status:response.status(),data:JSON.parse(raw.toString())};
    }
    await route.fulfill({response});
   }
  }catch{await route.abort('failed').catch(()=>{});}
  finally{if(response)await response.dispose().catch(()=>{});}
 });
 report.readOnlyBrowserFence=true;
}

async function readJson(context,url){
 need(url==='/api/health'||url===PLAIN||url===POWER||url===PETROL_POWER||url===PETROL_POWER_NEXT,'api_scope');
 const started=Date.now();
 const response=await context.request.get(ORIGIN+url,{timeout:45_000,maxRedirects:0,headers:{'Cache-Control':'no-cache'}});
 return {status:response.status(),data:await response.json().catch(()=>null),durationMs:Date.now()-started,requestedAt:started};
}

export async function runJapanBrowserAcceptance({oraclePath,releaseSha,nonce,outputFile,playwrightModule,chromeBin,codeScope=SCOPE}){
 const completion=codeScope===COMPLETION_SCOPE;
 const report={version:1,kind:'catalog-japan-browser-v1',codeScope,release:releaseSha,nonce,
  checkedAt:new Date().toISOString(),passed:false,japanFreshnessPassed:false,japanPowerApiPassed:false,
  japanUiPassed:false,japanVisibilityPassed:false,readOnlyBrowserFence:false,
  productionMutations:0,directSupplierApiRequests:0,supplierImageRequests:0,explicitJapanApiRequests:0,checks:{},screenshots:[]};
 if(completion)Object.assign(report,{japanPetrolPowerUiPassed:false,japanDetailPowerInputPassed:false,
  japanDeliveredCalculationPassed:false,japanPreviewCalculationRequests:0});
 let browser,context,currentPage,calculationGrant=null,stage='preconditions';
 const capture=async(page,name)=>{
  const relative=path.join('artifacts/catalog-japan-live',nonce,name+'.png');
  const file=path.join(ROOT,relative);await fs.mkdir(path.dirname(file),{recursive:true});
  const raw=await page.screenshot({path:file,fullPage:true,animations:'disabled',timeout:10_000});
  report.screenshots.push({path:relative,sha256:sha(raw)});
 };
 const health=async()=>{
  const value=await readJson(context,'/api/health');
  need(value.status===200&&value.data?.ok===true&&value.data.releaseSha===releaseSha,'release_changed');
  need(value.data.calculationVersion==='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90','calculation_changed');
 };
 try{
  need([SCOPE,COMPLETION_SCOPE].includes(codeScope),'code_scope');
  need(path.isAbsolute(outputFile),'output');
  try{await fs.access(outputFile);need(false,'report_exists');}catch(error){if(error?.code!=='ENOENT')throw error;}
  const raw=await fs.readFile(oraclePath),binding=japanReleaseBinding(JSON.parse(raw),releaseSha,nonce);
  report.generationManifestSha256=binding.generationManifestSha256;report.oracleSha256=sha(raw);
  const {chromium}=await import(playwrightModule||'playwright');
  browser=await chromium.launch({headless:true,executablePath:chromeBin,args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',locale:'ru-RU'});
  await installReadFence(context,report,completion?{getCalculationGrant:()=>calculationGrant}:{});await health();
  const plain=[];report.checks.freshness={observations:[]};report.checks.responses=[];
  for(let index=0;index<2;index++){
   stage=index?'plain_warm':'plain_first';report.explicitJapanApiRequests++;
   const response=await readJson(context,PLAIN);
   report.checks.responses.push({stage,...japanResponseObservation(response.data,response.status),durationMs:response.durationMs});
   const observation=verifyJapanPage(response.data,response.status);
   report.checks.freshness.observations.push({...observation,durationMs:response.durationMs,
    sourceObservedDuringRequest:Date.parse(observation.observedAt)>=response.requestedAt-1000});
   plain.push(response.data);
  }
  Object.assign(report.checks.freshness,verifyJapanWarmPage(...plain));report.japanFreshnessPassed=true;
  stage='power_api';report.explicitJapanApiRequests++;
  const power=await readJson(context,POWER);
  report.checks.responses.push({stage,...japanResponseObservation(power.data,power.status),durationMs:power.durationMs});
  report.checks.power={...verifyJapanPage(power.data,power.status),...verifyJapanPowerPage(power.data),durationMs:power.durationMs};
  report.japanPowerApiPassed=true;
  stage='power_ui';const page=await context.newPage();currentPage=page;
  let pageErrors=0;page.on('pageerror',()=>{pageErrors++;});
  const pageQuery=new URLSearchParams(QUERY);pageQuery.delete('market');pageQuery.set('powerTo','160');
  const start=Date.now(),response=await page.goto(ORIGIN+'/cars/japan?'+pageQuery,{waitUntil:'domcontentloaded',timeout:90_000});
  need(response?.status()===200,'power_page_http');
  const main=page.locator('main.ac-ajes-catalog');await main.waitFor({state:'visible',timeout:60_000});
  await main.locator('h2').filter({hasText:'Япония'}).waitFor({state:'visible',timeout:60_000});
  const cards=main.locator(CARD);await cards.nth(power.data.items.length-1).waitFor({state:'attached',timeout:60_000});
  need(await cards.count()===power.data.items.length,'ui_count');
  let supplierVisible=0,unknownVisible=0;
  for(const row of power.data.items){
   const card=cards.filter({has:page.locator('a[href*="'+row.id+'"]')});need(await card.count()===1,'ui_identity');
   if(row.japanSupplierPower){
    const label=card.locator('[data-japan-supplier-power="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes(row.japanSupplierPower.hp+' л.с.'),'ui_supplier_power');supplierVisible++;
   }else if(row.japanPowerUnknown===true){
    const label=card.locator('[data-japan-power-unknown="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes('Мощность не указана'),'ui_unknown_power');unknownVisible++;
   }
  }
  need(await main.getByText('Показаны сохранённые автомобили. Полный список пока недоступен.',{exact:true}).count()===0,'ui_stale');
  report.checks.ui={cards:await cards.count(),supplierVisible,unknownVisible,durationMs:Date.now()-start,city:CITY,
   powerTo:160,pageErrors};
  await capture(page,'japan-power-desktop');
  stage='power_list';
  await page.getByRole('button',{name:'Список',exact:true}).click();
  await main.locator('article.ac-catalog-list-row').first().waitFor({state:'visible',timeout:15_000});
  need(await main.locator('article.ac-catalog-list-row').count()===power.data.items.length,'list_count');
  for(const row of power.data.items){
   const card=main.locator('article.ac-catalog-list-row').filter({has:page.locator('a[href*="'+row.id+'"]')});
   if(row.japanSupplierPower){
    const label=card.locator('[data-japan-supplier-power="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes(row.japanSupplierPower.hp+' л.с.'),'list_supplier_power');
   }else if(row.japanPowerUnknown===true){
    const label=card.locator('[data-japan-power-unknown="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes('Мощность не указана'),'list_unknown_power');
   }
  }
  report.checks.ui.listCards=power.data.items.length;
  await capture(page,'japan-power-list');
  await page.getByRole('button',{name:'Плитка',exact:true}).click();
  await main.locator('article.ac-catalog-card').first().waitFor({state:'visible',timeout:15_000});
  const detailRow=power.data.items.find(row=>row.japanSupplierPower)||power.data.items.find(row=>row.japanPowerUnknown)||power.data.items[0];
  const detailHref=await cards.filter({has:page.locator('a[href*="'+detailRow.id+'"]')}).locator('a[href*="'+detailRow.id+'"]').first().getAttribute('href');
  const detailUrl=new URL(detailHref,ORIGIN);
  need(detailUrl.origin===ORIGIN&&detailUrl.pathname.startsWith('/cars/offer/')&&detailUrl.pathname.includes(detailRow.id),'detail_link');
  await page.setViewportSize({width:390,height:900});await cards.first().scrollIntoViewIfNeeded();
  await capture(page,'japan-power-mobile');need(pageErrors===0,'page_errors');
  stage='power_detail';
  const detailResponse=await page.goto(detailUrl.href,{waitUntil:'domcontentloaded',timeout:90_000});
  need(detailResponse?.status()===200,'detail_http');
  await page.locator('#offer-parameters').waitFor({state:'attached',timeout:60_000});
  if(detailRow.japanSupplierPower){
   const label=page.locator('[data-japan-supplier-power]').first();await label.scrollIntoViewIfNeeded();
   need(await label.isVisible()&&(await label.innerText()).includes(detailRow.japanSupplierPower.hp+' л.с.'),'detail_supplier_power');
  }else if(detailRow.japanPowerUnknown){
   // A detail read may supply a previously absent field; it must still disclose
   // the source or the absence rather than silently inventing calculation power.
   const label=page.locator('[data-japan-supplier-power],[data-japan-power-unknown]').first();
   await label.scrollIntoViewIfNeeded();need(await label.isVisible(),'detail_unknown_power');
  }
  report.checks.ui.detailOpened=true;report.checks.ui.detailSourceKind=detailRow.japanSupplierPower?'supplier':detailRow.japanPowerUnknown?'unknown':'local';
  await capture(page,'japan-detail-mobile');need(pageErrors===0,'detail_javascript');report.japanUiPassed=true;
  await page.close();currentPage=null;
  report.checks.visibility=[];
  for(const pathname of ['/','/cars']){
   stage=pathname==='/'?'home_visibility':'catalog_visibility';
   const view=await context.newPage();currentPage=view;let errors=0;view.on('pageerror',()=>{errors++;});
   const began=Date.now(),result=await view.goto(ORIGIN+pathname+'?'+new URLSearchParams({city:CITY}),{waitUntil:'domcontentloaded',timeout:90_000});
   need(result?.status()===200,'overview_http');
   const rail=view.locator('[data-japan-auction-rail="true"][data-status="ready"]');
   await rail.locator('h2').filter({hasText:'Япония'}).waitFor({state:'visible',timeout:60_000});
   await rail.locator(CARD).first().waitFor({state:'attached',timeout:60_000});
   const link=rail.locator('a[href*="/cars/japan"]').filter({hasText:'Все'}).first();
   need(await link.count()===1,'overview_link');
   const href=new URL(await link.getAttribute('href'),ORIGIN);
   need(href.pathname==='/cars/japan'&&href.searchParams.get('city')===CITY,'overview_city');
   await rail.scrollIntoViewIfNeeded();
   await capture(view,pathname==='/'?'japan-home-desktop':'japan-catalog-desktop');
   await view.setViewportSize({width:390,height:900});await rail.scrollIntoViewIfNeeded();
   await capture(view,pathname==='/'?'japan-home-mobile':'japan-catalog-mobile');
   need(errors===0,'overview_javascript');
   report.checks.visibility.push({path:pathname,headingVisible:true,cards:await rail.locator(CARD).count(),
    linkCityMatched:true,durationMs:Date.now()-began,pageErrors:errors});
   await view.close();currentPage=null;
  }
  report.japanVisibilityPassed=true;
  if(completion){
   stage='completion_city_hydration';
   await context.addCookies([{name:'avtocena_city',value:encodeURIComponent('Москва'),url:ORIGIN,sameSite:'Lax'}]);
   const view=await context.newPage();currentPage=view;let errors=0;view.on('pageerror',()=>{errors++;});
   await view.setViewportSize({width:390,height:900});
   // Seed the previous visitor choice once. A detail navigation must retain the
   // city adopted by the real catalog UI rather than reseeding storage again.
   await view.addInitScript(()=>{
    if(location.origin==='https://avtocena.com'&&!sessionStorage.getItem('japan-completion-city-seeded')){
     localStorage.setItem('avtocena_city','Москва');sessionStorage.setItem('japan-completion-city-seeded','1');
    }
   });
   const started=Date.now(),baseQuery=new URLSearchParams({fuel:'petrol',city:CITY});
   const initial=await view.goto(ORIGIN+'/cars/japan?'+baseQuery,{waitUntil:'domcontentloaded',timeout:90_000});
   need(initial?.status()===200,'petrol_page_http');
   const catalog=view.locator('main.ac-ajes-catalog');
   await catalog.locator(CARD).first().waitFor({state:'visible',timeout:60_000});
   await view.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
   const dialog=view.getByRole('dialog',{name:'Фильтры каталога',exact:true});
   await dialog.waitFor({state:'visible',timeout:15_000});
   const cityButton=dialog.locator('.ac-catalog-city-filter button').first();
   await cityButton.waitFor({state:'visible',timeout:15_000});
   need((await cityButton.innerText()).trim()===CITY&&new URL(view.url()).searchParams.get('city')===CITY,'city_hydration');
   stage='completion_petrol_power_toggle';
   const powerToggle=dialog.locator('input[type="checkbox"][name="powerTo"][value="160"]');
   need(!(await powerToggle.isChecked()),'petrol_initial_toggle');
   await powerToggle.check();
   await view.waitForURL(url=>url.searchParams.get('powerTo')==='160',{timeout:60_000});
   const toggled=new URL(view.url());
   need(japanPetrolPowerUrl(toggled.href),'petrol_toggle_query');
   if(await dialog.isVisible()){
    need(!/(?:^|\s)0\s+автомобил/u.test(await dialog.locator('.ac-mobile-filter-header [role="status"]').innerText()),'petrol_false_zero');
    need((await cityButton.innerText()).trim()===CITY,'city_after_toggle');
    await dialog.getByRole('button',{name:'Показать автомобили',exact:true}).click();
   }
   report.explicitJapanApiRequests++;
   let filtered=await readJson(context,PETROL_POWER);
   report.checks.responses.push({stage,...japanResponseObservation(filtered.data,filtered.status),durationMs:filtered.durationMs});
   const aggregate={...verifyJapanPage(filtered.data,filtered.status),...verifyJapanPowerPage(filtered.data)};
   need(filtered.data.items.every(row=>row.fuel==='petrol'),'petrol_api_fuel');
   const visibleCards=catalog.locator(CARD);
   await visibleCards.nth(filtered.data.items.length-1).waitFor({state:'visible',timeout:60_000});
   need(await visibleCards.count()===filtered.data.items.length,'petrol_ui_count');
   for(const row of filtered.data.items){
    const card=visibleCards.filter({has:view.locator('a[href*="'+row.id+'"]')});
    await card.waitFor({state:'attached',timeout:30_000});need(await card.count()===1,'petrol_ui_identity');
   }
   const shown=catalog.locator('p[role="status"]').filter({hasText:/^Показано\s+\d+/}).first();
   await shown.waitFor({state:'visible',timeout:15_000});
   need(new RegExp('^Показано\\s+'+filtered.data.items.length+'(?:\\s|$)').test((await shown.innerText()).trim()),'petrol_ui_shown');
   need(new URL(view.url()).searchParams.get('city')===CITY&&errors===0,'petrol_ui_city');
   report.checks.petrolPowerUi={...aggregate,city:CITY,previousCity:'Москва',cityPreserved:true,
    toggledThroughUi:true,cards:await visibleCards.count(),durationMs:Date.now()-started,pageErrors:errors};
   await visibleCards.first().scrollIntoViewIfNeeded();await capture(view,'japan-petrol-power-city-mobile');
   stage='completion_petrol_power_page_two';
   const firstIds=new Set(filtered.data.items.map(row=>row.id));
   const next=catalog.locator('nav.ac-pagination a[aria-label="Страница 2"]');
   await next.click();await view.waitForURL(url=>url.searchParams.get('page')==='2',{timeout:60_000});
   const nextUrl=new URL(view.url());
   need(japanPetrolPowerUrl(nextUrl.href,2),'petrol_page_two_query');
   report.explicitJapanApiRequests++;filtered=await readJson(context,PETROL_POWER_NEXT);
   report.checks.responses.push({stage,...japanResponseObservation(filtered.data,filtered.status),durationMs:filtered.durationMs});
   const nextAggregate={...verifyJapanPage(filtered.data,filtered.status),...verifyJapanPowerPage(filtered.data,2)};
   need(filtered.data.items.every(row=>row.fuel==='petrol'&&!firstIds.has(row.id)),'petrol_page_two_rows');
   for(const row of filtered.data.items){
    const card=visibleCards.filter({has:view.locator('a[href*="'+row.id+'"]')});
    await card.waitFor({state:'attached',timeout:30_000});need(await card.count()===1,'petrol_page_two_identity');
   }
   need(await visibleCards.count()===filtered.data.items.length,'petrol_page_two_count');
   report.checks.petrolPowerUi.pageTwo={...nextAggregate,cityPreserved:true,distinctRows:true,navigatedThroughLink:true};
   report.japanPetrolPowerUiPassed=true;
   await visibleCards.first().scrollIntoViewIfNeeded();await capture(view,'japan-petrol-power-page-two-mobile');
   const row=filtered.data.items.find(item=>item.japanSupplierPower?.combustionPreviewEligible===true
    &&!positive(item.powerHp)&&!positive(item.powerKw)&&!item.japanPowerUnknown
    &&positive(item.japanDeliveredPreview?.totalRub)
    &&item.sourceCurrency==='JPY'&&positive(item.sourcePrice)
    &&Number.isInteger(item.year)&&item.year>=2008&&item.year<=new Date().getUTCFullYear()+1
    &&Number.isInteger(item.engineCc)&&item.engineCc>=300&&item.engineCc<=3000
    &&(!item.vehicleCategory||item.vehicleCategory==='M1'||item.vehicleCategory==='unknown'));
   need(row,'petrol_calculation_sample');
   const selected=visibleCards.filter({has:view.locator('a[href*="'+row.id+'"]')});
   const cardPrice=selected.locator('[title="Предварительная стоимость под ключ по данным аукциона"] .ac-price');
   await cardPrice.waitFor({state:'visible',timeout:30_000});
   const listVisibleRub=Number((await cardPrice.innerText()).replace(/[^0-9]/g,''));
   need(positive(listVisibleRub),'petrol_catalog_delivered');
   const detailLink=selected.locator('a[href*="'+row.id+'"]').first();
   const href=await detailLink.getAttribute('href');
   const target=new URL(href,ORIGIN),offerPath='/cars/offer/'+row.id;
   need(target.origin===ORIGIN&&(target.pathname===offerPath||target.pathname.startsWith(offerPath+'/'))
    &&(!target.searchParams.has('city')||target.searchParams.get('city')===CITY),'petrol_detail_city_link');
   calculationGrant=japanCalculationReadGrant(row,CITY,target.href);
   stage='completion_detail_power';
   const calculationResponse=view.waitForResponse(response=>response.request().method()==='POST'
    &&response.url()===ORIGIN+'/api/catalog/offer/'+row.id+'/calculate',{timeout:90_000});
   // Observe the promise immediately so a failed detail navigation cannot leave
   // an unhandled response timeout while the report is being written.
   calculationResponse.catch(()=>{});
   await detailLink.click();await view.waitForURL(url=>url.href===target.href,{timeout:90_000});
   const detail=view.locator('main.ac-offer-page[data-offer-id="'+row.id+'"]');
   await detail.waitFor({state:'visible',timeout:60_000});
   const summary=detail.locator('summary[aria-label^="Мощность:"]');
   await summary.waitFor({state:'visible',timeout:60_000});await summary.click();
   const input=detail.locator('input[aria-label="Мощность, л.с."]');
   await input.waitFor({state:'visible',timeout:15_000});
   const detailPower=Number(await input.inputValue());
   need(detailPower===row.japanSupplierPower.hp,'detail_power_input');
   need((await detail.locator('[data-city-delivery]').innerText()).includes(CITY),'detail_city');
   report.checks.detailPower={offerIdentitySha256:sha(row.id),sourcePowerHp:row.japanSupplierPower.hp,
    inputPowerHp:detailPower,sameOffer:true,city:CITY};
   report.japanDetailPowerInputPassed=true;await summary.click();
   stage='completion_delivered_calculation';
   await calculationResponse;
   need(calculationGrant.response&&calculationGrant.requests>=1&&calculationGrant.requests<=2,'calculation_observed');
   const result=verifyJapanDeliveredCalculation(calculationGrant.response.data,calculationGrant.response.status,calculationGrant);
   const parameters=detail.locator('.ac-inline-parameters[data-share-year]');
   need(Number(await parameters.getAttribute('data-share-year'))===Number(calculationGrant.body.year)
    &&Number(await parameters.getAttribute('data-share-engine-cc'))===Number(calculationGrant.body.engineCc)
    &&await parameters.getAttribute('data-share-fuel')===calculationGrant.body.fuel
    &&Number(calculationGrant.body.powerHp)===detailPower,'calculation_parameters');
   const panel=detail.locator('.ac-offer-price-panel');
   await panel.locator('.ac-price-trend-label').filter({hasText:'Предварительно под ключ'}).waitFor({state:'visible',timeout:30_000});
   const visibleRub=Number((await panel.locator('.ac-price').innerText()).replace(/[^0-9]/g,''));
   need(visibleRub===Math.round(result.totalRub)&&listVisibleRub===visibleRub,'calculation_visible_total');
   need(Number(await detail.locator('[data-price-line="car"]').getAttribute('data-price-amount-rub'))===result.carRub,'calculation_visible_car');
   need((await detail.locator('[data-city-delivery]').innerText()).includes(CITY)&&errors===0,'calculation_visible_city');
   report.checks.deliveredCalculation={...result,requestPowerHp:Number(calculationGrant.body.powerHp),
    visibleRub,listVisibleRub,sourcePowerHp:row.japanSupplierPower.hp,ephemeral:true,saved:false};
   report.japanDeliveredCalculationPassed=true;
   await panel.scrollIntoViewIfNeeded();await capture(view,'japan-petrol-delivered-detail-mobile');
   calculationGrant=null;await view.close();currentPage=null;
  }
  stage='release_after';await health();
  report.passed=['japanFreshnessPassed','japanPowerApiPassed','japanUiPassed','japanVisibilityPassed','readOnlyBrowserFence',
   ...(completion?['japanPetrolPowerUiPassed','japanDetailPowerInputPassed','japanDeliveredCalculationPassed']:[])].every(key=>report[key]===true);
 }catch(error){
  report.error={stage,code:/^japan_browser_[a-z_]+$/.test(error?.message||'')?error.message:'japan_browser_check_failed',timeout:error?.name==='TimeoutError'};
  if(currentPage&&/^[a-f0-9]{32}$/.test(nonce||''))await capture(currentPage,'failure').catch(()=>{});
 }finally{
  if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await fs.writeFile(outputFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  need(process.argv.length===2,'arguments');
  const report=await runJapanBrowserAcceptance({oraclePath:process.env.ORACLE_PATH,releaseSha:process.env.EXPECTED_RELEASE_SHA,
   nonce:process.env.VERIFICATION_NONCE,outputFile:path.resolve(process.env.OUTPUT||path.join(ROOT,'catalog-next-japan-browser-report.json')),
   playwrightModule:process.env.PLAYWRIGHT_MODULE,chromeBin:process.env.CHROME_BIN,codeScope:process.env.CATALOG_CODE_SCOPE||SCOPE});
  console.log('JAPAN_BROWSER '+JSON.stringify(report));if(!report.passed)process.exitCode=1;
 }catch{console.error('japan_browser_report_failed');process.exitCode=1;}
}
