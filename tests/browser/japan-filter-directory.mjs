import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'japan-filter-directory-'));
await build({entryPoints:['tests/browser/model-suggestions-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:path.join(temporary,'app.js'),tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-logo',setup(b){
 b.onResolve({filter:/BrandLogoRail$/},()=>({path:'logo',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const BrandLogoVisual=()=>null;'}));
}}]});
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/VehicleModelSearch.tsx','apps/web/components/catalog/CatalogBrandMultiSelect.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
const server=http.createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(temporary,'app.js')));return;}
 if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const report={passed:false,scope:'Actual Japan brand/model controls with bounded local source fixtures; no production or supplier calls',cases:[]};
const openModels=async page=>{
 const input=page.getByRole('searchbox',{name:'Модель автомобиля',exact:true});
 await input.click();
 return await input.getAttribute('readonly')!==null?page.getByRole('searchbox',{name:'Поиск модели',exact:true}):input;
};
const closeModels=page=>page.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ru-RU',serviceWorkers:'block'}),page=await context.newPage();
  const requests=[],errors=[];let modelFailure=false,brandFailure=false,brandInvalid=false,brandStale=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin){await route.abort();return;}
   if(!url.pathname.startsWith('/api/')&&!url.pathname.includes('model-directory.')){await route.continue();return;}
   requests.push(url.pathname+url.search);
   if(url.pathname==='/api/catalog/brand-counts'){
    await route.fulfill(brandFailure?{status:503,json:{error:'japan_counts_unavailable'}}:{json:brandInvalid?{generationId:'invalid'}:{generationId:'fixture',counts:{MAZDA:12,TOYOTA:24},modelCounts:{},stale:brandStale}});return;
   }
   if(url.pathname==='/api/catalog/source-models'){
    assert.equal(url.searchParams.get('market'),'japan');
    const make=url.searchParams.get('make');
    const models=make==='MAZDA'?[['MAZDA','MAZDA3 FASTBACK',[],12]]:make==='TOYOTA'?[['TOYOTA','COROLLA 2WD',[],24]]:[];
    await route.fulfill(modelFailure?{status:503,json:{error:'directory_unavailable'}}:{json:{version:1,brands:[],models}});return;
   }
   // These tempting general/stock names must never be queried for auctions.
   await route.fulfill({json:{version:1,brands:[],models:[['Mazda','3',[],1],['Mazda','Stock only model',[],1]]}});
  });
  await page.goto(origin+'/?market=japan&facets=empty');
  await page.getByRole('button',{name:'Выбрать марки автомобилей'}).click();
  await page.locator('[data-facet-value="MAZDA"]').click();
  const search=await openModels(page);await search.fill('');
  await page.locator('[data-model-value="MAZDA3 FASTBACK"]').waitFor();
  assert.deepEqual(await page.locator('[data-model-value]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-model-value'))),['MAZDA3 FASTBACK']);
  await page.locator('[data-model-value="MAZDA3 FASTBACK"]').click();await closeModels(page);
  assert.equal(await page.getByLabel('Выбрано').textContent(),'MAZDA / MAZDA3 FASTBACK');
  assert.equal(requests.some(url=>url.includes('scope=inventory')||url.includes('model-directory.')||url.includes('stock=green')),false);
  report.cases.push({width,name:'source-options-only',passed:true});
  await page.getByRole('button',{name:'Выбрать марки автомобилей'}).click();
  await page.getByRole('button',{name:/^Любая марка/}).click();
  await page.getByRole('button',{name:'Выбрать марки автомобилей'}).click();
  await page.locator('[data-facet-value="TOYOTA"]').click();
  assert.equal(await page.getByLabel('Выбрано').textContent(),'TOYOTA / ');
  await (await openModels(page)).fill('');
  await page.locator('[data-model-value="COROLLA"]').waitFor();
  assert.equal(await page.locator('[data-model-value="MAZDA3 FASTBACK"]').count(),0);
  await closeModels(page);
  report.cases.push({width,name:'make-change-clears-old-models',passed:true});
  // A new page clears only browser fixture caches, leaving the production retry logic intact.
  modelFailure=true;await page.reload();
  await page.getByRole('button',{name:'Выбрать марки автомобилей'}).click();await page.locator('[data-facet-value="MAZDA"]').click();
  await (await openModels(page)).fill('3');
  await page.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).waitFor();
  assert.equal(await page.locator('[data-model-value]').count(),0);
  assert.equal(await page.getByText('Модель не найдена. Попробуйте часть названия',{exact:true}).count(),0);
  modelFailure=false;await page.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).click();
  await page.locator('[data-model-value="MAZDA3 FASTBACK"]').waitFor();
  await closeModels(page);report.cases.push({width,name:'model-directory-failure-and-retry',passed:true});
  brandFailure=true;await page.reload();
  await page.getByRole('button',{name:'Выбрать марки автомобилей'}).click();await page.getByPlaceholder('Найти марку').fill('Mazda');
  await page.getByRole('button',{name:'Не удалось загрузить марки. Повторить'}).waitFor();
  assert.equal(await page.locator('[data-facet-value]').count(),0);
  assert.equal(await page.getByText('Марка не найдена',{exact:true}).count(),0);
  brandFailure=false;brandInvalid=true;
  const invalidResponse=page.waitForResponse(response=>response.url().includes('/api/catalog/brand-counts'));
  await page.getByRole('button',{name:'Не удалось загрузить марки. Повторить'}).click();await invalidResponse;
  await page.getByRole('button',{name:'Не удалось загрузить марки. Повторить'}).waitFor();
  assert.equal(await page.getByText('Марка не найдена',{exact:true}).count(),0,'invalid HTTP200 metadata is not an authoritative empty directory');
  brandInvalid=false;brandStale=true;
  await page.getByRole('button',{name:'Не удалось загрузить марки. Повторить'}).click();
  await page.locator('[data-facet-value="MAZDA"]').waitFor();
  await page.getByRole('button',{name:'Не удалось загрузить марки. Повторить'}).waitFor();
  brandStale=false;
  const freshResponse=page.waitForResponse(response=>response.url().includes('/api/catalog/brand-counts'));
  await page.getByRole('button',{name:'Не удалось загрузить марки. Повторить'}).click();await freshResponse;
  await page.locator('[data-facet-value="MAZDA"]').waitFor();
  await page.getByRole('button',{name:'Не удалось загрузить марки. Повторить'}).waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  report.cases.push({width,name:'brand-directory-failure-and-retry',passed:true});
  await context.close();
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 fs.writeFileSync(process.env.JAPAN_FILTER_DIRECTORY_REPORT||path.join(os.tmpdir(),'japan-filter-directory-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));fs.rmSync(temporary,{recursive:true,force:true});
}
