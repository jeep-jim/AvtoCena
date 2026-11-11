import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

const out='artifacts/currency-observer-scope';fs.mkdirSync(out,{recursive:true});
const baseline=process.env.CURRENCY_OBSERVER_BASE_REF;
const modes=baseline?['before','after']:['after'];
for(const mode of modes)await build({entryPoints:['tests/browser/currency-observer-scope-fixture.tsx'],bundle:true,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',outfile:`${out}/${mode}.js`,define:{'process.env.NODE_ENV':'"production"'},plugins:[
 {name:'controlled-rate-snapshot',setup(b){b.onLoad({filter:/public-rates-client\.ts$/},()=>({contents:'export async function loadPublicRates(){window.__rateCalls++;return window.__fixtureRates;}',loader:'js'}));}},
 ...(mode==='before'?[{name:'accepted-observers',setup(b){b.onLoad({filter:/(CurrencyChartEnhancer|PublicUiEnhancer)\.tsx$/},a=>({contents:execFileSync('git',['show',`${baseline}:${path.relative(process.cwd(),a.path)}`],{encoding:'utf8'}),loader:'tsx',resolveDir:path.dirname(a.path)}));}}]:[])
]});
if(process.env.CURRENCY_OBSERVER_BUILD_ONLY==='1'){
 console.log(JSON.stringify({built:modes,bytes:Object.fromEntries(modes.map(mode=>[mode,fs.statSync(`${out}/${mode}.js`).size]))}));
 process.exit(0);
}

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=http.createServer((req,res)=>{
 const match=/^\/(before|after)\.js$/.exec(req.url||'');
 if(match){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(`${out}/${match[1]}.js`));return;}
 const mode=req.url?.includes('before')?'before':'after';
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="charts"><section id="initial"><svg aria-label="Изменение курса USD"></svg></section></div><div id="cards"></div><div id="cms"></div><div id="root"></div><script src="/${mode}.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
const rates=[{currency:'USD',effectiveRate:91,previousEffectiveRate:90,rateDate:'2026-11-11',previousRateDate:'2026-11-10'},
 {currency:'JPY',effectiveRate:.6,previousEffectiveRate:.5,rateDate:'2026-11-11',previousRateDate:'2026-11-10'},
 {currency:'KRW',effectiveRate:.07,previousEffectiveRate:.06,rateDate:'2026-11-11',previousRateDate:'2026-11-10'}];
try{
 for(const mode of modes)for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.__fixtureRates=[];window.__rateCalls=0;
   const probe=window.__currencyProbe={active:false,documentScans:[],callbacks:0,created:0,disconnected:0,externalObservers:0};
   const query=Document.prototype.querySelectorAll;
   Document.prototype.querySelectorAll=function(selector){
    if(probe.active&&['[data-ac-rate-segment]','svg[aria-label^="Изменение курса "]'].includes(selector))probe.documentScans.push(selector);
    return query.call(this,selector);
   };
   const Observer=window.MutationObserver;
   window.MutationObserver=class extends Observer{
    connected=true;
    constructor(callback){
     // Playwright also creates observers in the page. Only this fixture's
     // bundled components belong to its lifecycle and callback assertions.
     const stack=new Error().stack||'';
     const component=['before','after'].some(mode=>stack.includes(`${location.origin}/${mode}.js:`));
     super((records,observer)=>{if(component&&probe.active)probe.callbacks++;callback(records,observer);});
     this.component=component;
     if(component)probe.created++;else probe.externalObservers++;
    }
    disconnect(){if(this.connected){this.connected=false;if(this.component)probe.disconnected++;}super.disconnect();}
   };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
  await page.waitForFunction(()=>window.__currencyFixture&&document.getElementById('ac-currency-ui-enhancements')&&document.getElementById('ac-currency-chart-polish'));
  assert.equal(await page.locator('.ac-rate-point-deltas').count(),0,'empty rates create no fabricated annotations');
  await page.evaluate(()=>{
   const transient=document.createElement('section');transient.innerHTML='<svg aria-label="Изменение курса USD"></svg>';document.getElementById('charts').append(transient);
   window.__removedChart=transient;
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{window.__removedChart.remove();requestAnimationFrame(resolve);} )));
  await page.evaluate(value=>{window.__fixtureRates=value;document.dispatchEvent(new Event('visibilitychange'));},rates);
  await page.waitForFunction(()=>document.querySelector('#initial .ac-rate-point-deltas span:last-child')?.textContent==='+1');
  assert.equal(await page.evaluate(()=>window.__removedChart.querySelector('.ac-rate-point-deltas')===null),true,'rates recovery ignores removed charts');

  await page.evaluate(()=>{window.__currencyProbe.active=true;window.__currencyProbe.documentScans=[];window.__currencyProbe.callbacks=0;});
  await page.evaluate(async()=>{
   for(let i=0;i<25;i++){
    const card=document.createElement('article');card.className='catalog-card';card.innerHTML='<div><img alt="Фото автомобиля"><span>Карточка</span></div>';document.getElementById('cards').append(card);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   }
  });
  const mutations=await page.evaluate(()=>{window.__currencyProbe.active=false;return {documentScans:window.__currencyProbe.documentScans.length,observerCallbacks:window.__currencyProbe.callbacks};});
  if(mode==='after')assert.equal(mutations.documentScans,0,'unrelated catalog mutations must not rescan the document');
  else assert.ok(mutations.documentScans>=25,'the accepted baseline must reproduce global scans');

  await page.evaluate(()=>{
   const wrapper=document.createElement('div');wrapper.innerHTML='<section id="late"><svg aria-label="Изменение курса JPY"></svg></section><div><i data-ac-rate-segment>старый сегмент</i></div>';
   document.getElementById('cms').append(wrapper);
   const direct=document.createElement('i');direct.dataset.acRateSegment='';document.getElementById('cms').append(direct);
  });
  await page.waitForFunction(()=>document.querySelector('#late .ac-rate-point-deltas span:last-child')?.textContent==='+10'&&!document.querySelector('[data-ac-rate-segment]'));
  await page.evaluate(()=>document.querySelector('#initial svg').setAttribute('aria-label','Изменение курса KRW'));
  await page.waitForFunction(()=>document.querySelector('#initial .ac-rate-point-deltas span:last-child')?.textContent==='+10');
  await page.evaluate(()=>{window.__removedAnnotation=document.querySelector('#initial .ac-rate-point-deltas');window.__removedAnnotation.remove();});
  await page.waitForFunction(()=>{const current=document.querySelector('#initial .ac-rate-point-deltas');return current&&current!==window.__removedAnnotation&&current.children.length===5;});
  await page.evaluate(()=>{window.__currencyProbe.active=true;window.__currencyProbe.callbacks=0;});
  await page.waitForTimeout(150);const settled=await page.evaluate(()=>window.__currencyProbe.callbacks);
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__currencyProbe.callbacks),settled,'real observer self-mutations must settle');
  await page.evaluate(()=>{window.__currencyProbe.active=false;document.documentElement.dataset.theme='light';});
  assert.equal(await page.locator('#ac-currency-ui-enhancements').count(),1);assert.equal(await page.locator('#ac-currency-chart-polish').count(),1);

  await page.evaluate(()=>{window.__fixtureRates=[];document.dispatchEvent(new Event('visibilitychange'));});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  await page.evaluate(()=>{const node=document.createElement('section');node.id='resume';node.innerHTML='<svg aria-label="Изменение курса USD"></svg>';document.getElementById('charts').append(node);});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await page.locator('#resume .ac-rate-point-deltas').count(),0);
  await page.evaluate(value=>{window.__fixtureRates=value;document.dispatchEvent(new Event('visibilitychange'));},rates);
  await page.waitForFunction(()=>document.querySelector('#resume .ac-rate-point-deltas span:last-child')?.textContent==='+1');

  await page.evaluate(()=>window.__currencyFixture.unmount());
  await page.waitForFunction(()=>!document.getElementById('ac-currency-ui-enhancements')&&!document.getElementById('ac-currency-chart-polish'));
  const cleanup=await page.evaluate(()=>({created:window.__currencyProbe.created,disconnected:window.__currencyProbe.disconnected,externalObservers:window.__currencyProbe.externalObservers,rateCalls:window.__rateCalls}));
  assert.equal(cleanup.created,2,'both component observers are included in lifecycle assertions');
  assert.equal(cleanup.created,cleanup.disconnected,'all component observers disconnect on unmount');
  await page.evaluate(()=>{window.__currencyProbe.active=true;window.__currencyProbe.callbacks=0;document.getElementById('cards').append(document.createElement('div'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__currencyProbe.callbacks),0);assert.equal(await page.evaluate(()=>window.__rateCalls),cleanup.rateCalls);
  assert.deepEqual(errors,[]);
  results.push({mode,width,unrelatedMutationFrames:25,...mutations,lateCharts:true,lateSegments:true,labelChange:true,annotationReplacement:true,emptyRatesRecovery:true,observerSettled:true,cleanup,errors});
  await page.close();
 }
 fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
