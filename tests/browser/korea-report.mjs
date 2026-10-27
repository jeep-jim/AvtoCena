import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/korea-report';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/korea-report-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:out+'/app.js',loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/OfferSpecificationsDisclosure.tsx','apps/web/components/catalog/OfferUpdatedStatus.tsx','apps/web/components/catalog/KoreaReportPanel.tsx','tests/browser/korea-report-fixture.tsx']}),autoprefixer]).process('@tailwind base;@tailwind components;@tailwind utilities;:root{--ac-border:#d8dce5;--ac-surface:#fff;--ac-surface-2:#f3f5f8;--ac-text:#121826;--ac-muted:#677186;font-family:Arial}body{background:var(--ac-surface);color:var(--ac-text)}.dark{--ac-border:#3b4352;--ac-surface:#191f28;--ac-surface-2:#283342;--ac-text:#fff;--ac-muted:#b1bdcd}',{from:undefined});
const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(out+'/app.js'));return;}if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const calls={history:0,inspection:0};let frames=0,resolveReport;const held=new Promise(r=>resolveReport=r);
  const lot='43014653';
  const originalHref=kind=>kind==='history'?`https://fem.encar.com/cars/report/accident/${lot}`:`https://www.encar.com/md/sl/mdsl_regcar.do?method=inspectionViewNew&carid=${lot}`;
  const wrapper=kind=>`https://tru.ru/korea/fixture_${kind}_abcdefghijklmnopqrstuv`;
  await page.route('https://tru.ru/**',async route=>{frames++;await route.fulfill({contentType:'text/html',body:'<html lang="ko"><body>외부 보고서 — fixture</body></html>'});});
  await page.route('**/api/catalog/korea-report?*',async route=>{
   const p=new URL(route.request().url()).searchParams,kind=p.get('kind');
   assert.equal(p.get('lot'),lot);assert.equal(p.get('id'),'ajes-korea-fixture');calls[kind]++;
   if(kind==='history'&&calls.history===1){await held;await route.fulfill({status:503,json:{error:'unavailable'}});return;}
   if(kind==='inspection'&&calls.inspection===1){await route.fulfill({status:404,json:{error:'report_missing'}});return;}
   await route.fulfill({json:{version:2,offerId:'ajes-korea-fixture',lot,kind,href:wrapper(kind),originalHref:originalHref(kind)}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(t=>document.documentElement.className=t,theme);
  const trigger=page.locator('[data-korea-report-trigger]:visible');await trigger.waitFor();await page.waitForTimeout(150);
  assert.deepEqual(calls,{history:0,inspection:0});assert.equal(frames,0,'no external frame on card load');
  await trigger.click();
  const panel=page.locator('[data-korea-report-panel]:visible');
  await panel.getByText('Выберите отчёт.',{exact:false}).waitFor();assert.deepEqual(calls,{history:0,inspection:0},'outer disclosure does not request unseen reports');
  const history=panel.locator('[data-korea-report-section="history"]'),inspection=panel.locator('[data-korea-report-section="inspection"]');
  await history.getByRole('button',{name:'Страховая история',exact:true}).click();
  await history.getByRole('status').waitFor();
  await trigger.click();await trigger.click();assert.equal(calls.history,1,'pending request reused after closing');
  await inspection.getByRole('button',{name:'Осмотр автомобиля',exact:true}).click();
  await inspection.getByText('Для этого автомобиля ссылка на отчёт не предоставлена.',{exact:true}).waitFor();
  assert.equal(calls.inspection,1,'inspection is independent of pending history');
  resolveReport();await history.getByText('Не удалось получить ссылку на отчёт. Попробуйте ещё раз позже.',{exact:true}).waitFor();
  await history.getByRole('button',{name:'Повторить',exact:true}).click();
  await history.locator('iframe').waitFor();
  const newTab=history.getByRole('link',{name:'Открыть в новой вкладке'});
  assert.equal(await newTab.getAttribute('href'),wrapper('history'));assert.equal(await newTab.getAttribute('target'),'_blank');assert.match(await newTab.getAttribute('rel'),/noopener/);
  assert.equal(await history.locator('iframe').getAttribute('src'),wrapper('history'));assert.equal(await history.locator('iframe').getAttribute('referrerpolicy'),'no-referrer');
  assert.equal(await inspection.locator('iframe').count(),0,'missing inspection cannot fabricate a report');
  await inspection.getByRole('button',{name:'Повторить',exact:true}).click();await inspection.locator('iframe').waitFor();
  await trigger.click();await trigger.click();assert.deepEqual(calls,{history:2,inspection:2},'loaded links reused');
  assert.equal(await page.getByText('Страховых случаев нет',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  if(width>1280){const box=await trigger.boundingBox(),spec=await page.getByRole('button',{name:'Все характеристики',exact:true}).boundingBox();assert.ok(Math.abs(box.y-spec.y)<2&&box.x>spec.x,'history sits beside specifications');}
  // Even a frame failure leaves a usable new-tab link and the other section.
  await history.locator('iframe').dispatchEvent('error');await history.getByText('Отчёт не удалось показать внутри страницы.',{exact:false}).waitFor();
  assert.equal(await newTab.isVisible(),true);assert.equal(await inspection.locator('iframe').isVisible(),true);
  await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: desktop/mobile light/dark; no initial requests/frames; per-section lazy load; pending reuse; isolated missing/failure/retry; exact supplier link; frame failure leaves new-tab fallback; no overflow');
}finally{await browser.close();await new Promise(r=>server.close(r));}
