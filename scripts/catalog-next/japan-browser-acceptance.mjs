import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const ORIGIN='https://avtocena.com';
const SCOPE='catalog-japan-recovery-v1';
const CARD='article.ac-catalog-card,article.ac-catalog-list-row';
const CITY='Новокузнецк';
const QUERY=new URLSearchParams({market:'japan',page:'1',pageSize:'24',city:CITY});
const PLAIN='/api/catalog/search?'+QUERY;
const POWER=PLAIN+'&powerTo=160';
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(value,code)=>{if(!value)throw Error('japan_browser_'+code);};
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;

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

export function verifyJapanPowerPage(payload){
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
 if(payload.hasMore)need(payload.total===null&&(!payload.countSummary||payload.countSummary.upperBound===true),'false_exact_count');
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

export async function installReadFence(context,report){
 report.blockedRequests={mutation:0,external:0,private:0,redirect:0};
 report.supplierImageRequests=0;
 await context.route('**/*',async route=>{
  const request=route.request(),scope=japanVerificationRequestScope(request.url(),request.method(),request.resourceType());
  if(scope!=='allowed'&&scope!=='supplier_image'){report.blockedRequests[scope]++;await route.abort('blockedbyclient');return;}
  let response;
  try{
   // The read fence must not impose a shorter deadline than the page check.
   if(scope==='supplier_image')report.supplierImageRequests++;
   response=await route.fetch({maxRedirects:0,timeout:90_000});
   if(response.status()>=300&&response.status()<400&&response.status()!==304){
    report.blockedRequests.redirect++;await route.abort('blockedbyclient');
   }else await route.fulfill({response});
  }catch{await route.abort('failed').catch(()=>{});}
  finally{if(response)await response.dispose().catch(()=>{});}
 });
 report.readOnlyBrowserFence=true;
}

async function readJson(context,url){
 need(url==='/api/health'||url===PLAIN||url===POWER,'api_scope');
 const started=Date.now();
 const response=await context.request.get(ORIGIN+url,{timeout:45_000,maxRedirects:0,headers:{'Cache-Control':'no-cache'}});
 return {status:response.status(),data:await response.json().catch(()=>null),durationMs:Date.now()-started,requestedAt:started};
}

export async function runJapanBrowserAcceptance({oraclePath,releaseSha,nonce,outputFile,playwrightModule,chromeBin}){
 const report={version:1,kind:'catalog-japan-browser-v1',codeScope:SCOPE,release:releaseSha,nonce,
  checkedAt:new Date().toISOString(),passed:false,japanFreshnessPassed:false,japanPowerApiPassed:false,
  japanUiPassed:false,japanVisibilityPassed:false,readOnlyBrowserFence:false,
  productionMutations:0,directSupplierApiRequests:0,supplierImageRequests:0,explicitJapanApiRequests:0,checks:{},screenshots:[]};
 let browser,context,currentPage,stage='preconditions';
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
  need(path.isAbsolute(outputFile),'output');
  try{await fs.access(outputFile);need(false,'report_exists');}catch(error){if(error?.code!=='ENOENT')throw error;}
  const raw=await fs.readFile(oraclePath),binding=japanReleaseBinding(JSON.parse(raw),releaseSha,nonce);
  report.generationManifestSha256=binding.generationManifestSha256;report.oracleSha256=sha(raw);
  const {chromium}=await import(playwrightModule||'playwright');
  browser=await chromium.launch({headless:true,executablePath:chromeBin,args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',locale:'ru-RU'});
  await installReadFence(context,report);await health();
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
  report.japanVisibilityPassed=true;stage='release_after';await health();
  report.passed=['japanFreshnessPassed','japanPowerApiPassed','japanUiPassed','japanVisibilityPassed','readOnlyBrowserFence'].every(key=>report[key]===true);
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
   playwrightModule:process.env.PLAYWRIGHT_MODULE,chromeBin:process.env.CHROME_BIN});
  console.log('JAPAN_BROWSER '+JSON.stringify(report));if(!report.passed)process.exitCode=1;
 }catch{console.error('japan_browser_report_failed');process.exitCode=1;}
}
