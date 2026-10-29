import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = "artifacts/dealer-selection";
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/browser/dealer-selection-fixture.tsx"],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: out,
  entryNames: "fixture",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [
    {
      name: "next",
      setup(b) {
        b.onResolve({ filter: /^next\/(link|navigation|dynamic)$/ }, (args) => ({
          path: args.path,
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents:
            args.path === "next/dynamic" ? `export default function dynamic(){return ()=>null;}` : args.path === "next/link"
              ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
              : `const navigate=(url)=>{const u=new URL(url,location.origin);if(new URLSearchParams(location.search).has("visitor"))u.searchParams.set("visitor","1");const commit=()=>{history.pushState({},"",u);window.dispatchEvent(new Event("fixture:navigate"));if(window.fixtureDelay)window.scrollTo({top:0,behavior:"instant"});};if(window.fixtureDelay)setTimeout(commit,window.fixtureDelay);else commit();};const router={push:navigate,replace:navigate,prefetch:()=>{},back:()=>{}};export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>router;`,
          loader: "jsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.tsx']})]).process(['globals.css','catalog-ui.css','select-controls.css','public-polish.css','flat-ui.css','public-regression-fixes.css','public-price-sheet-fix.css','catalog-filter-compact.css'].map(f=>fs.readFileSync('apps/web/app/'+f,'utf8')).join('\n')+'\n@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
let shares=[];let delay=0;
const server=http.createServer(async(req,res)=>{
 if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 if(/^\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(req.url)&&fs.existsSync(path.join(out,req.url.slice(1)))){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(out,req.url.slice(1))));return;}
 if(req.url==='/api/share'){let body='';for await(const c of req)body+=c;shares.push(JSON.parse(body));await new Promise(r=>setTimeout(r,delay));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:'/s/'+String(shares.length).padStart(16,'0')}));return;}
 if(req.url.startsWith('/api/catalog/colors')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,colors:['Белый','Чёрный']}));return;}
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({count:0,rating:null,items:[]}));return;}
 res.setHeader('Content-Type','text/html');res.end('<html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
async function openFilters(page,width){if(width===390)await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection-filters',{detail:{dealerId:'external'}})));}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.stack)});page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text())});
 try{
 await page.addInitScript(()=>{window.calls=[];document.cookie='avtocena_city='+encodeURIComponent('Москва')+';path=/';Object.defineProperty(navigator,'share',{value:async v=>window.calls.push(v)});Object.defineProperty(navigator,'clipboard',{value:{writeText:async v=>window.calls.push(v)}});});
 await page.goto(origin+'/test/dealer?make=Audi&budget=2500000&city=Новокузнецк&selection=1#catalog');
 const send=page.getByRole('button',{name:'Поделиться подборкой',exact:true});await send.waitFor();await page.locator('[data-city]').filter({hasText:'Новокузнецк'}).waitFor();
 await page.waitForFunction(()=>Math.abs(document.getElementById('catalog').getBoundingClientRect().top-90)<10);
 await send.click();await page.waitForFunction(()=>window.calls.length===1);const calls=await page.evaluate(()=>window.calls);const msg=typeof calls[0]==='string'?calls[0]:calls[0].text;assert.match(msg,/^Подборка вариантов по вашему запросу\nhttp:\/\/127\.0\.0\.1:\d+\/s\/[\w-]{16}$/);if(typeof calls[0]!=='string')assert.equal(calls[0].url,undefined);
 await page.getByRole('button',{name:'Текст подборки',exact:true}).click();
 const custom='Подборка Ауди из Китая 2023 года для Николая';
 await page.getByRole('textbox',{name:'Название подборки',exact:true}).fill(custom);
 await send.click();await page.waitForFunction(()=>window.calls.length===2);
 assert.equal(shares.at(-1).title,custom);
 assert.equal(await page.evaluate(()=>{const v=window.calls.at(-1);return (typeof v==='string'?v:v.text).split('\n')[0];}),custom);
 // Collapsing and dismissing preserve the caption, as do filtering and a reload.
 await page.getByRole('button',{name:'Текст подборки',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Название подборки',exact:true}).count(),0);
 await page.getByRole('button',{name:'Скрыть панель подборки'}).click();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection-open',{detail:{dealerId:'external'}})));
 await page.getByRole('button',{name:'Текст подборки',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Название подборки',exact:true}).inputValue(),custom);
 await page.evaluate(()=>window.selectionDocumentToken='same-document');
 await openFilters(page,width);
 const colorForm=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
 await colorForm.getByRole('button',{name:'Цвет: Любой цвет',exact:true}).click();
 await colorForm.getByRole('button',{name:'Белый',exact:true}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('color')==='Белый');
 assert.equal(await page.evaluate(()=>window.selectionDocumentToken),'same-document');
 if(width===390)await colorForm.locator('button[data-ac-mobile-close="1"]').click();
 assert.equal(await page.getByRole('textbox',{name:'Название подборки',exact:true}).inputValue(),custom);
 await send.click();await page.waitForFunction(()=>window.calls.length===3);
 assert.equal(new URL(shares.at(-1).path,origin).searchParams.get('color'),'Белый');assert.equal(shares.at(-1).title,custom);
 await page.getByRole('button',{name:'Скрыть панель подборки'}).click();
 await page.reload();await page.locator('#catalog').waitFor();
 await page.waitForTimeout(150);assert.equal(await send.count(),0);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection-open',{detail:{dealerId:'external'}})));await send.waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Название подборки',exact:true}).inputValue(),custom);
 await page.evaluate(()=>{window.calls=['preserved','custom'];});
 const intro=await page.locator('.dealer-intro').evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}));
 assert.ok(intro.height<=intro.line*2+1,JSON.stringify(intro));
 const home=page.locator('.ac-footer-dealer-home');assert.equal(await home.getAttribute('href'),'/');assert.equal(await home.innerText(),'АвтоЦена');
 // Fixture setup must finish before measuring geometry; global CSS uses smooth scroll.
 await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"}));
 const footerBox=await home.boundingBox(),panelBox=await page.locator('[data-selection-dock]').boundingBox();assert.ok(footerBox&&panelBox&&footerBox.y+footerBox.height<=panelBox.y,JSON.stringify({footerBox,panelBox}));
 await page.getByRole('textbox',{name:'Название подборки',exact:true}).fill('');
 await page.evaluate(()=>window.calls.pop());
 const target=new URL(shares.at(-1).path,origin);assert.equal(target.hash,'#catalog');assert.equal(target.searchParams.get('city'),'Новокузнецк');assert.equal(target.searchParams.get('budget'),'2500000');
 if(width===390){for(const method of ['button','back']){
  const beforeClose=await page.evaluate(()=>{window.scrollTo({top:900,behavior:'instant'});return window.scrollY;});assert.ok(beforeClose>500);await openFilters(page,width);await page.getByRole('dialog',{name:'Фильтры каталога'}).waitFor();
  await page.waitForFunction(()=>Boolean(history.state?.acOverlayStep));
  if(method==='button')await page.locator('button[data-ac-mobile-close="1"]').click();else await page.goBack();
  await page.getByRole('dialog',{name:'Фильтры каталога'}).waitFor({state:'hidden'});await page.waitForFunction(y=>Math.abs(scrollY-y)<3,beforeClose);console.log(`close ${method}: restored ${beforeClose}px`);
 }}
 await page.evaluate(()=>window.scrollTo({top:900,behavior:"instant"}));await openFilters(page,width);
 const filterForm=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
 await filterForm.waitFor({state:'visible'});if(width===390){await send.waitFor({state:'hidden'});assert.equal(await send.isVisible(),false);}
 const budget=filterForm.getByRole('textbox',{name:'Цена: до',exact:true});await budget.fill('3000000');await budget.press('Tab');
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('budget')==='3000000');assert.equal(new URL(page.url()).pathname,'/test/dealer');
 if(width===390){await page.keyboard.press('Escape');await send.waitFor({state:'visible'});assert.ok(await page.evaluate(()=>window.scrollY)>500);}
 await send.click();await page.waitForFunction(()=>window.calls.length===2);assert.equal(new URL(shares.at(-1).path,origin).searchParams.get('budget'),'3000000');await page.evaluate(()=>window.calls.pop());
 if(width===390){
  const y=await page.evaluate(()=>{window.scrollTo({top:900,behavior:'instant'});window.fixtureDelay=800;return scrollY;});
  await openFilters(page,width);
  const sheet=page.getByRole('dialog',{name:'Фильтры каталога'});await sheet.waitFor();
  await sheet.getByRole('textbox',{name:'Цена: до',exact:true}).fill('3100000');await sheet.getByRole('textbox',{name:'Цена: до',exact:true}).press('Tab');
  await page.waitForTimeout(250);await sheet.locator('button[data-ac-mobile-close="1"]').click();
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('budget')==='3100000');
  await page.waitForFunction(y=>Math.abs(scrollY-y)<3,y);console.log(`delayed response after close: restored ${y}px`);
  await page.evaluate(()=>window.fixtureDelay=0);
 }

 const dockBox=await page.locator('[data-selection-dock]').boundingBox();assert.ok(dockBox&&dockBox.y>=0&&dockBox.y+dockBox.height<=901&&dockBox.x>=-1&&dockBox.x+dockBox.width<=width+1,JSON.stringify(dockBox));
 await page.screenshot({path:`${out}/${width}.png`});
 await page.getByRole('button',{name:'Скрыть панель подборки'}).click();assert.equal(await send.count(),0);if(width===390)assert.equal(await page.locator('.dealer-dock').isVisible(),true);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection',{detail:{dealerId:'external',query:'make=Honda&city=Казань',pending:true,filtersOpen:false}})));await send.waitFor();await send.click();await page.waitForFunction(()=>window.calls.length===2);assert.match(shares.at(-1).path,/make=Honda/);assert.equal(new URL(shares.at(-1).path,origin).searchParams.get('city'),'Казань');
 // Changing the selection during preparation must never send the old selection.
 delay=400;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection',{detail:{dealerId:'external',query:'make=Honda&yearFrom=2024',pending:false,filtersOpen:false}})));await send.click();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection',{detail:{dealerId:'external',query:'make=Audi&yearFrom=2025',pending:false,filtersOpen:false}})));await page.getByText('Параметры изменились — поделитесь новой подборкой').waitFor();assert.equal(await page.evaluate(()=>window.calls.length),2);delay=0;
 // Categorical multiselection survives navigation, deselection and URL reload.
 await openFilters(page,width);
 const multiForm=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
 for(const [placeholder,names,key,values] of [
  ['Любая трансмиссия',['Автомат','Вариатор'],'transmission','automatic|cvt'],
  ['Любое топливо',['Бензин','Дизель'],'fuel','petrol|diesel'],
  ['Любой кузов',['Седан','Хэтчбек'],'bodyType','sedan|hatchback'],
  ['Любой привод',['Передний','Полный'],'drive','fwd|awd']
 ]){
  await multiForm.getByRole('button',{name:placeholder,exact:true}).click();
  for(const name of names)await multiForm.getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(([key,value])=>new URLSearchParams(location.search).get(key)===value,[key,values]);
  for(const name of names)assert.equal(await multiForm.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
  await multiForm.getByRole('button',{name:names.join(', '),exact:true}).click();
 }
 if(width===390)await multiForm.locator('button[data-ac-mobile-close="1"]').click();
 await page.reload();await page.locator('#catalog').waitFor();
 for(const [key,value] of [['transmission','automatic|cvt'],['fuel','petrol|diesel'],['bodyType','sedan|hatchback'],['drive','fwd|awd']])assert.equal(new URL(page.url()).searchParams.get(key),value);
 await openFilters(page,width);
 const reloadedMulti=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
 await reloadedMulti.getByRole('button',{name:'Автомат, Вариатор',exact:true}).click();
 await reloadedMulti.getByRole('button',{name:'Автомат',exact:true}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('transmission')==='cvt');
 assert.equal(await reloadedMulti.getByRole('button',{name:'Вариатор',exact:true}).count()>=1,true);
 if(width===390)await reloadedMulti.locator('button[data-ac-mobile-close="1"]').click();
 await page.screenshot({path:`${out}/multiselect-${width}.png`});
 // Each chosen market has its own removable chip and keeps the other choice.
 await openFilters(page,width);
 const chipForm=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
 const chipMarket=chipForm.locator('input[name="market"]').locator('..');
 await chipMarket.locator('button.ac-filter-control').click();
 await chipMarket.getByRole('button',{name:'Китай',exact:true}).click();
 await chipMarket.getByRole('button',{name:'Япония · Аукционы',exact:true}).click();
 await chipMarket.locator('button.ac-filter-control').click();
 const chipScope=width===390?chipForm:page.locator('.ac-catalog-selection');
 await chipScope.getByRole('button',{name:'Убрать Китай',exact:true}).waitFor();
 await chipScope.getByRole('button',{name:'Убрать Япония · Аукционы',exact:true}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('market')==='china');
 assert.equal(await chipScope.getByRole('button',{name:'Убрать Китай',exact:true}).count(),1);
 assert.equal(new URL(page.url()).pathname,'/test/dealer');
 if(width===390)await chipForm.locator('button[data-ac-mobile-close="1"]').click();
 // Green Corner's source gearbox codes cannot be reused as another market's types.
 const switchForm=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
 if(width===390)await openFilters(page,width);
 else await switchForm.getByRole('button',{name:'Вариатор',exact:true}).and(switchForm.locator('.ac-filter-control')).click();
 const marketInput=switchForm.locator('input[name="market"]');
 const marketRoot=marketInput.locator('..');
 await marketRoot.locator('button.ac-filter-control').click();
 await marketRoot.getByRole('button',{name:'Япония · Зелёный угол',exact:true}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('stock')==='green');
 assert.equal(new URL(page.url()).searchParams.has('transmission'),false);
 assert.equal(new URL(page.url()).searchParams.get('fuel'),'petrol|diesel');
 assert.equal(new URL(page.url()).searchParams.get('bodyType'),'sedan|hatchback');
 assert.equal(new URL(page.url()).searchParams.get('drive'),'fwd|awd');
 // Market is now multi-select: it stays open and a switch requires clearing the previous choice.
 if(await marketRoot.locator('button.ac-filter-control').getAttribute('aria-expanded')!=='true')await marketRoot.locator('button.ac-filter-control').click();
 await marketRoot.getByRole('button',{name:'Все рынки',exact:true}).click();
 await marketRoot.getByRole('button',{name:'Китай',exact:true}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('market')==='china');
 assert.equal(new URL(page.url()).searchParams.has('transmission'),false);
 assert.equal(new URL(page.url()).searchParams.get('selection'),'1');
 if(width===390)await switchForm.locator('button[data-ac-mobile-close="1"]').click();
 if(width===390){
  // Keep the original profile pathname instead of remounting via the canonical alias.
  await page.goto(origin+'/test/cabinet');
  await page.evaluate(()=>{history.pushState({},'', '/test/dealer?canonical=1&make=Audi&selection=1#catalog');});
  await page.reload();await page.locator('#catalog').waitFor();
  await page.evaluate(()=>{window.fixtureDelay=700;window.scrollTo({top:900,behavior:"instant"});});
  await openFilters(page,width);
  const canonicalForm=page.getByRole('dialog',{name:'Фильтры каталога'});await canonicalForm.waitFor();
  await canonicalForm.getByRole('textbox',{name:'Цена: до',exact:true}).fill('2700000');
  await page.waitForTimeout(240); // navigation intent sent, delayed route still pending
  await canonicalForm.locator('button[data-ac-mobile-close="1"]').click();
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('budget')==='2700000');
  await page.waitForTimeout(800);
  assert.equal(new URL(page.url()).pathname,'/test/dealer');
  assert.equal(new URL(page.url()).searchParams.get('budget'),'2700000');
  assert.equal(new URL(page.url()).searchParams.get('selection'),'1');
  await page.screenshot({path:`${out}/canonical-selection.png`});
 }
 await page.goto(origin+'/test/dealer?visitor=1&make=Audi&city=Новокузнецк&selection=1#catalog');await page.locator('#catalog').waitFor();assert.equal(await send.count(),0);assert.equal(await page.locator('[data-city]').textContent(),'Новокузнецк');assert.ok((await page.evaluate(()=>document.cookie)).includes(encodeURIComponent('Москва')));assert.deepEqual(errors,[]);console.log(`${width}: share, filters, city, anchor, dismissal, stale request and visitor visibility OK`);
 }catch(error){await page.screenshot({path:`${out}/failure-${width}.png`,fullPage:true});console.error(await page.evaluate(()=>({scrollY,scrollHeight:document.documentElement.scrollHeight,viewport:innerHeight,body:document.body.style.cssText,restoration:history.scrollRestoration,catalogTop:document.getElementById('catalog')?.getBoundingClientRect().top,margin:getComputedStyle(document.getElementById('catalog')).scrollMarginTop,scrollMode:getComputedStyle(document.documentElement).scrollBehavior})));console.error((await page.locator('body').innerText()).slice(-3000));throw error;}finally{await page.close();}
}}finally{await browser.close();server.close();}
