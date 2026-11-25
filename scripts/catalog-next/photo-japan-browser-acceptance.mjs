import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const ORIGIN='https://avtocena.com';
const CARD='article.ac-catalog-card,article.ac-catalog-list-row';
const PLAIN_JAPAN='/api/catalog/search?market=japan&page=2&pageSize=3&sort=updatedAt';
const POWER_JAPAN='/api/catalog/search?market=japan&powerTo=160&page=1&pageSize=3&sort=updatedAt';
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(condition,code)=>{if(!condition)throw Error('photo_japan_browser_'+code);};
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function photoJapanBinding(oracle,releaseSha,nonce){
 need(/^[a-f0-9]{40}$/.test(releaseSha||'')&&/^[a-f0-9]{32}$/.test(nonce||''),'arguments');
 need(oracle?.version===1&&oracle.runtimeSha===releaseSha&&/^[a-f0-9]{64}$/.test(oracle.generationManifestSha256||'')
  &&/^gen_china_[A-Za-z0-9_]+$/.test(oracle.expectedGeneration||''),'oracle_binding');
 const query=new URLSearchParams({market:'china',make:'Hyundai',model:'Elantra',city:'Новокузнецк',
  budgetFrom:'1650000',budgetTo:'1750000',yearFrom:'2022',yearTo:'2023',mileageTo:'70000',
  sort:'totalRub',preparedCut:oracle.expectedGeneration,page:'1'});
 const api='/api/catalog/search?'+query;
 for(const key of ['market','make','model'])query.delete(key);
 return {generation:oracle.expectedGeneration,generationManifestSha256:oracle.generationManifestSha256,
  api,catalog:'/cars/china/Hyundai/Elantra?'+query};
}

export function selectChinaRecoveryPhoto(payload,generation){
 need(payload?.ok===true&&payload.generationId===generation&&Number.isSafeInteger(payload.total)&&payload.total>0&&Array.isArray(payload.items)
  &&payload.items.length>0&&payload.items.length<=Math.min(24,payload.total)&&payload.items.every(row=>row.market==='china'),'china_selection');
 const row=payload.items.find(item=>typeof item.cardImageUrl==='string'&&item.cardImageUrl.startsWith('/api/catalog/photo/'));
 need(row&&/^[a-f0-9]{24}$/.test(row.id)&&row.preparedChinaSelection?.generationId===generation,'china_photo_sample');
 // Exactly the rendition used by CatalogCover; the signed source is unchanged.
 const url=new URL(row.cardImageUrl,ORIGIN);
 need(url.origin===ORIGIN&&url.searchParams.get('market')==='china','china_photo_url');
 url.searchParams.set('view','card');
 return {id:row.id,url:url.href,relative:url.pathname+url.search};
}

export function japanObservation(payload,status,now=Date.now()){
 const observed=Date.parse(payload?.observedAt||payload?.generationId||'');
 return {status,sampled:Array.isArray(payload?.items)?payload.items.length:0,
  observedAt:Number.isFinite(observed)?new Date(observed).toISOString():null,
  ageSeconds:Number.isFinite(observed)?Number(((now-observed)/1000).toFixed(3)):null,
  stale:payload?.stale===true,partial:payload?.partial===true,interrupted:payload?.interrupted===true,
  scanLimited:payload?.scanLimited===true,countIncomplete:payload?.countIncomplete===true,
  total:Number.isSafeInteger(payload?.total)?payload.total:null};
}

export function verifyJapanFreshPage(payload,status,now=Date.now()){
 const observed=Date.parse(payload?.observedAt||payload?.generationId||'');
 need(status===200&&payload?.ok===true,'japan_http');
 need(payload.stale===false&&!payload.partial&&!payload.interrupted&&!payload.scanLimited,'japan_unavailable_or_stale');
 need(Number.isFinite(observed)&&observed<=now+60_000&&now-observed<30*60_000,'japan_observation_expired');
 need(Array.isArray(payload.items)&&payload.items.length>0&&payload.items.length<=3
  &&payload.items.every(row=>row.market==='japan'&&/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id||''))
  &&new Set(payload.items.map(row=>row.id)).size===payload.items.length,'japan_rows');
 return japanObservation(payload,status,now);
}

export function verifyJapanWarmReuse(first,second){
 need((first.observedAt||first.generationId)===(second.observedAt||second.generationId)
  &&same(first.items.map(row=>row.id),second.items.map(row=>row.id)),'japan_warm_changed');
 return {sameObservation:true,sameRows:true};
}

export function verifyJapanPowerPayload(payload){
 let confirmed=0,preliminary=0,unknown=0;
 for(const row of payload.items){
  const hint=row.japanPowerSearchHint;
  if(positive(row.powerHp)){
   need(row.powerHp<=160&&!hint&&row.japanPowerUnknown!==true,'japan_confirmed_power');confirmed++;
  }else if(hint){
   need(hint.offerId===row.id&&hint.source==='ajes_pw_first'&&hint.requiresConfirmation===true
    &&positive(hint.horsepower)&&hint.horsepower<=160&&row.japanPowerUnknown!==true,'japan_preliminary_power');preliminary++;
  }else{need(row.japanPowerUnknown===true,'japan_unknown_dropped');unknown++;}
 }
 need(payload.powerUnknownIncluded===true&&payload.powerUnknownCount===unknown&&payload.powerPreliminaryCount===preliminary,'japan_power_metadata');
 need(preliminary+unknown>0,'japan_power_evidence_absent');
 need(payload.powerIncomplete===true&&payload.countIncomplete===true&&payload.total===null,'japan_incomplete_count');
 return {sampled:payload.items.length,confirmed,preliminary,unknown,unknownIncluded:true,countIncomplete:true};
}

async function getJson(context,url){
 const response=await context.request.get(ORIGIN+url,{timeout:30_000,headers:{'Cache-Control':'no-cache'}});
 return {status:response.status(),data:await response.json().catch(()=>null)};
}
async function health(context,releaseSha){
 const response=await getJson(context,'/api/health');
 need(response.status===200&&response.data?.releaseSha===releaseSha,'release_changed');
}
async function poll(check,code,timeout=10_000){
 const deadline=Date.now()+timeout;
 do{
  if(await check())return;
  await new Promise(resolve=>setTimeout(resolve,50));
 }while(Date.now()<deadline);
 need(false,code);
}

export async function pausePhotoRecoveryTimers(page){
 // Keep native network/decode work running, but advance application timers
 // explicitly. Otherwise waiting for a cold control image can consume the
 // placeholder's 15-second automatic recovery and remove the manual button.
 // One second of headroom avoids asking the remote browser to pause in its past.
 await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
}

export async function decodedChinaPhotoControl(page,target){
 const images=page.locator(CARD).locator('img');
 const candidate=await images.evaluateAll((rows,selected)=>
  rows.findIndex(img=>img.src!==selected&&img.src.includes('/api/catalog/photo/')),target);
 need(candidate>=0,'china_healthy_candidate');
 await images.nth(candidate).scrollIntoViewIfNeeded();
 let control;
 // Node timers are deliberately used here: requestAnimationFrame-based page
 // polling is paused with the page clock, while real image I/O is not.
 await poll(async()=>{
  control=await images.evaluateAll((rows,selected)=>
   rows.find(img=>img.src!==selected&&img.complete&&img.naturalWidth>0&&img.src.includes('/api/catalog/photo/'))?.src||null,target);
  return Boolean(control);
 },'china_healthy_control',30_000);
 return control;
}

export async function runPhotoJapanBrowserAcceptance({oraclePath,releaseSha,nonce,outputFile,playwrightModule,chromeBin}){
 const report={version:1,kind:'china-photo-japan-browser-v1',release:releaseSha,nonce,checkedAt:new Date().toISOString(),
  passed:false,chinaPhotoPassed:false,japanFreshnessPassed:false,japanPowerApiPassed:false,japanUiPassed:false,
  productionMutations:0,directSupplierRequests:0,explicitJapanApiRequests:0,japanUiNavigations:0,checks:{},screenshots:[]};
 let browser,context,currentPage,stage='preconditions';
 const capture=async(page,name)=>{
  const relative=path.join('artifacts/catalog-photo-japan-live',nonce,name+'.png');
  const file=path.join(ROOT,relative);await fs.mkdir(path.dirname(file),{recursive:true});
  const bytes=await page.screenshot({path:file,fullPage:true,animations:'disabled',timeout:5000});
  report.screenshots.push({path:relative,sha256:sha(bytes)});
 };
 try{
  need(path.isAbsolute(outputFile),'output');
  try{await fs.access(outputFile);need(false,'report_exists');}catch(error){if(error?.code!=='ENOENT')throw error;}
  const rawOracle=await fs.readFile(oraclePath),oracle=JSON.parse(rawOracle);
  const binding=photoJapanBinding(oracle,releaseSha,nonce);
  report.generationManifestSha256=binding.generationManifestSha256;report.oracleSha256=sha(rawOracle);
  const {chromium}=await import(playwrightModule||'playwright');
  browser=await chromium.launch({headless:true,executablePath:chromeBin,args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',locale:'ru-RU'});
  stage='release_before';await health(context,releaseSha);report.checks.releaseBeforeMatched=true;

  stage='china_selection';
  const china=await getJson(context,binding.api);need(china.status===200,'china_http');
  const selected=selectChinaRecoveryPhoto(china.data,binding.generation);
  report.checks.chinaPhoto={total:china.data.total,cards:china.data.items.length,generationMatched:true,faultResponses:0};
  const page=await context.newPage();currentPage=page;
  let targetRequests=0,pageErrors=0;const imageRequests=new Map();
  page.on('pageerror',()=>{pageErrors++;});
  page.on('request',request=>{
   if(request.resourceType()==='image')imageRequests.set(request.url(),(imageRequests.get(request.url())||0)+1);
  });
  // Only this exact signed image is intercepted. Every other request remains native.
  await page.route(url=>url.href===selected.url,async route=>{
   targetRequests++;
   if(targetRequests<=3){report.checks.chinaPhoto.faultResponses++;await route.fulfill({status:503,
    headers:{'Cache-Control':'no-store','Retry-After':'15','X-Photo-Status':'photo_busy'},body:''});}
   else await route.continue();
  });
  await page.clock.install({time:new Date()});
  await page.addInitScript(target=>{
   window.__photoRecoveryErrors=0;
   window.addEventListener('error',event=>{
    if(event.target instanceof HTMLImageElement&&event.target.src===target)window.__photoRecoveryErrors++;
   },true);
  },selected.url);
  stage='china_initial_failure';
  const chinaPage=await page.goto(ORIGIN+binding.catalog,{waitUntil:'domcontentloaded',timeout:90_000});
  need(chinaPage?.status()===200,'china_page');
  await page.locator('.ac-catalog-city-filter').getByRole('button',{name:'Выбрать город. Сейчас: Новокузнецк',exact:true}).waitFor({state:'visible',timeout:60_000});
  report.checks.chinaPhoto.visibleCityMatched=true;
  const card=page.locator(CARD).filter({has:page.locator(`a[href*="${selected.id}"]`)});
  await card.waitFor({state:'visible',timeout:60_000});need(await card.count()===1,'china_card_ambiguous');
  await card.scrollIntoViewIfNeeded();
  const consent=page.getByRole('button',{name:'Хорошо',exact:true});if(await consent.isVisible())await consent.click();
  await page.waitForFunction(target=>{
   const image=[...document.images].find(img=>img.src===target);
   return window.__photoRecoveryErrors>=1&&image?.dataset.photoRetried===image?.getAttribute('src');
  },selected.url,{timeout:15_000});
  stage='china_bounded_retries';
  await pausePhotoRecoveryTimers(page);
  await page.clock.runFor(18_001);
  await poll(()=>page.evaluate(()=>window.__photoRecoveryErrors>=2),'china_first_retry');
  await page.clock.runFor(38_001);
  await poll(()=>page.evaluate(()=>window.__photoRecoveryErrors>=3),'china_second_retry');
  const retry=card.locator('[data-catalog-photo-retry]');
  await retry.waitFor({state:'visible',timeout:10_000});
  need(targetRequests===3&&await retry.evaluate(button=>button.closest('a')===null),'china_retry_button');
  // The source server may be cold after an atomic cutover. Do not mistake a
  // still-loading native image for proof that the neighbouring photos failed.
  // Scroll one unmodified image into view, then insist on real decoded pixels.
  let control;
  try {
   control=await decodedChinaPhotoControl(page,selected.url);
  } catch(error) {
   // Preserve the strict acceptance failure; add bounded, URL-free evidence.
   report.checks.chinaPhoto.controlImages=await page.locator(CARD).locator('img').evaluateAll((images,target)=>({
    eligible:images.filter(img=>img.src!==target&&img.src.includes('/api/catalog/photo/')).length,
    decoded:images.filter(img=>img.src!==target&&img.naturalWidth>0).length,
    pending:images.filter(img=>img.src!==target&&!img.complete).length
   }),selected.url);
   throw error;
  }
  need(control,'china_healthy_control');const controlRequests=imageRequests.get(control)||0;
  await capture(page,'china-before-retry');
  const before=page.url();
  stage='china_manual_recovery';
  await retry.click({timeout:5000});
  await poll(async()=>{const image=card.locator('img');return await image.count()===1&&await image.evaluate(img=>img.complete&&img.naturalWidth>0);},'china_image_not_recovered');
  const image=card.locator('img');
  need(await image.evaluate(img=>img.src)===selected.url&&page.url()===before,'china_retry_identity');
  need(targetRequests===4&&report.checks.chinaPhoto.faultResponses===3&&await retry.count()===0,'china_retry_request_count');
  need((imageRequests.get(control)||0)===controlRequests,'china_healthy_retried');
  await page.clock.resume();
  report.checks.chinaPhoto={...report.checks.chinaPhoto,targetRequests,successfulOriginalUrl:true,naturalWidth:await image.evaluate(img=>img.naturalWidth),
   sameUrl:true,noNavigation:true,retryOutsideLink:true,healthyControlRequests:controlRequests,healthyControlUnchanged:true,pageErrorsObserved:pageErrors};
  await capture(page,'china-recovered-desktop');
  await page.setViewportSize({width:390,height:900});await card.scrollIntoViewIfNeeded();
  await capture(page,'china-recovered-mobile');
  report.checks.chinaPhoto.pageErrorsObserved=pageErrors;need(pageErrors===0,'china_javascript_errors');
  report.chinaPhotoPassed=true;
  await page.close();currentPage=null;

  stage='japan_plain_first';
  report.checks.japanFreshness={observations:[]};const plain=[];
  for(let index=0;index<2;index++){
   stage=index?'japan_plain_warm':'japan_plain_first';
   const requestedAt=Date.now();report.explicitJapanApiRequests++;
   const result=await getJson(context,PLAIN_JAPAN),now=Date.now();
   const observed=japanObservation(result.data,result.status,now);
   report.checks.japanFreshness.observations.push({...observed,sourceObservationDuringRequest:
    Number.isFinite(Date.parse(observed.observedAt||''))&&Date.parse(observed.observedAt)>=requestedAt-1000&&Date.parse(observed.observedAt)<=now+1000});
   verifyJapanFreshPage(result.data,result.status,now);plain.push(result.data);
  }
  Object.assign(report.checks.japanFreshness,verifyJapanWarmReuse(plain[0],plain[1]));report.japanFreshnessPassed=true;

  stage='japan_power_api';report.explicitJapanApiRequests++;
  const power=await getJson(context,POWER_JAPAN);
  report.checks.japanPowerApi=japanObservation(power.data,power.status);
  verifyJapanFreshPage(power.data,power.status);
  Object.assign(report.checks.japanPowerApi,verifyJapanPowerPayload(power.data));report.japanPowerApiPassed=true;

  stage='japan_visible_page';
  const japanPage=await context.newPage();currentPage=japanPage;report.japanUiNavigations++;
  let japanPageErrors=0;report.checks.japanUi={pageErrorsObserved:0};
  japanPage.on('pageerror',()=>{japanPageErrors++;report.checks.japanUi.pageErrorsObserved=japanPageErrors;});
  await japanPage.mouse.move(0,0);
  const response=await japanPage.goto(ORIGIN+'/cars/japan?powerTo=160&page=1&pageSize=3&sort=updatedAt',{waitUntil:'domcontentloaded',timeout:90_000});
  need(response?.status()===200,'japan_page_http');
  const main=japanPage.locator('main.ac-ajes-catalog');await main.waitFor({state:'visible',timeout:60_000});
  const heading=main.locator('h2').filter({hasText:'Япония'});await heading.waitFor({state:'visible',timeout:60_000});
  const cards=main.locator(CARD);await cards.nth(power.data.items.length-1).waitFor({state:'attached',timeout:60_000});
  need(await cards.count()===power.data.items.length,'japan_ui_count');
  const notice=main.getByRole('status').filter({hasText:'Для поиска используем первое значение мощности поставщика'});
  await notice.waitFor({state:'visible',timeout:10_000});
  need((await heading.innerText()).includes('всего уточняется'),'japan_ui_incomplete_count');
  need(await main.getByText('Показаны сохранённые автомобили. Полный список пока недоступен.',{exact:true}).count()===0,'japan_ui_stale');
  let preliminaryVisible=0,unknownVisible=0;
  for(const row of power.data.items){
   const rendered=cards.filter({has:japanPage.locator(`a[href*="${row.id}"]`)});need(await rendered.count()===1,'japan_ui_identity');
   if(row.japanPowerSearchHint){
    const label=rendered.locator('[title="Предварительные данные мощности; проверьте по документам"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes('предварительно'),'japan_ui_preliminary');preliminaryVisible++;
   }else if(row.japanPowerUnknown===true){
    const label=rendered.locator('[data-japan-power-unknown="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes('Мощность не указана'),'japan_ui_unknown');unknownVisible++;
   }
  }
  need(preliminaryVisible+unknownVisible>0,'japan_ui_power_absent');
  report.checks.japanUi={visibleMarketHeading:true,cards:await cards.count(),preliminaryVisible,unknownVisible,incompleteCountVisible:true,sourceNoticeVisible:true,pageErrorsObserved:japanPageErrors};
  await capture(japanPage,'japan-desktop');
  await japanPage.setViewportSize({width:390,height:900});await cards.first().scrollIntoViewIfNeeded();
  await capture(japanPage,'japan-mobile');need(japanPageErrors===0,'japan_javascript_errors');report.japanUiPassed=true;
  stage='release_after';await health(context,releaseSha);report.checks.releaseAfterMatched=true;
  report.passed=report.chinaPhotoPassed&&report.japanFreshnessPassed&&report.japanPowerApiPassed&&report.japanUiPassed;
 }catch(error){
  report.error={stage,code:/^photo_japan_browser_[a-z_]+$/.test(error?.message||'')?error.message:'photo_japan_browser_check_failed',timeout:error?.name==='TimeoutError'};
  if(currentPage&&/^[a-f0-9]{32}$/.test(nonce||''))await capture(currentPage,'failure').catch(()=>{});
 }finally{
  if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await fs.writeFile(outputFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const report=await runPhotoJapanBrowserAcceptance({oraclePath:process.env.ORACLE_PATH,releaseSha:process.env.EXPECTED_RELEASE_SHA,
   nonce:process.env.VERIFICATION_NONCE,outputFile:path.resolve(process.env.OUTPUT||path.join(ROOT,'catalog-next-photo-japan-browser-report.json')),
   playwrightModule:process.env.PLAYWRIGHT_MODULE,chromeBin:process.env.CHROME_BIN});
  process.stdout.write('PHOTO_JAPAN_BROWSER '+JSON.stringify(report)+'\n');if(!report.passed)process.exitCode=1;
 }catch{process.stderr.write('photo_japan_browser_report_failed\n');process.exitCode=1;}
}
