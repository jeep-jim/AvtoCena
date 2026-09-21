import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.CITY_BROWSER||'chromium';
const out=`artifacts/city-picker-${engine}`;fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/city-picker-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwindcss({content:['tests/browser/city-picker-fixture.tsx','apps/web/components/home/CitySelector.tsx','apps/web/components/leads/LeadCityField.tsx']}),autoprefixer]).process('@tailwind base;@tailwind components;@tailwind utilities;:root{--ac-surface:#202b38;--ac-surface-2:#2c3849;--ac-surface-3:#354359;--ac-text:#fff;--ac-muted:#abb5c3}html[data-theme=light]{--ac-surface:#fff;--ac-surface-2:#edf0f4;--ac-surface-3:#e1e5ed;--ac-text:#182333;--ac-muted:#596579}body{background:var(--ac-surface);color:var(--ac-text)}input{color:var(--ac-text);background:var(--ac-surface-2)}',{from:undefined});fs.writeFileSync(`${out}/fixture.css`,css.css);
const server=http.createServer((req,res)=>{const file=req.url?.split('?')[0];if(file==='/fixture.js'||file==='/fixture.css'){res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(path.join(out,file.slice(1))));return;}res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=engine==='webkit'?await webkit.launch():await chromium.launch({executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const results=[];
try{for(const width of [320,390,768,1440])for(const theme of ['dark','light']){
 const context=await browser.newContext({viewport:{width,height:844},hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 const home=page.getByRole('button',{name:/Выбрать город. Сейчас:/});await home.tap();
 let dialog=page.getByRole('dialog',{name:'Выбор города',exact:true}),input=dialog.getByRole('textbox',{name:'Поиск города'});await input.fill('Ново');
 const first=dialog.getByRole('button',{name:/Новоалтайск/});await first.waitFor();
 if(width<768){
  await page.evaluate(()=>{const viewport=new EventTarget();Object.assign(viewport,{height:420,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});window.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>document.querySelector('[data-city-picker]').getBoundingClientRect().height===420);
  const b=await input.boundingBox();assert.ok(b.y>=0&&b.y+b.height<180,'search stays above keyboard on first focus');
  const choices=dialog.getByLabel('Подсказки городов');const box=await choices.boundingBox();assert.ok(box.height>80&&box.y+box.height<=420,'suggestions fit visible viewport');
 }
 await first.tap();await dialog.waitFor({state:'hidden'});assert.match(await home.textContent(),/Новоалтайск/);assert.equal(await page.evaluate(()=>localStorage.getItem('avtocena_city')),'Новоалтайск');
 await page.getByRole('button',{name:'Оставить заявку',exact:true}).tap();const lead=page.getByRole('dialog',{name:'Заявка',exact:true});
 await lead.getByRole('textbox',{name:'Имя'}).fill('Имя сохранено');
 await lead.getByRole('button',{name:width<768?/Выбрать город. Сейчас:/:/Открыть выбор города/}).tap();
 dialog=page.getByRole('dialog',{name:'Выбор города',exact:true});input=dialog.getByRole('textbox',{name:'Поиск города'});await input.fill('Новокуз');await dialog.getByRole('button',{name:/Новокузнецк/}).tap();await dialog.waitFor({state:'hidden'});
 assert.equal(await lead.getByRole('textbox',{name:'Имя'}).inputValue(),'Имя сохранено');
 if(width<768)assert.match(await lead.getByRole('button',{name:/Выбрать город. Сейчас:/}).textContent(),/Новокузнецк/);else assert.equal(await lead.getByRole('textbox',{name:'Ваш город'}).inputValue(),'Новокузнецк');
 await lead.getByRole('button',{name:width<768?/Выбрать город. Сейчас:/:/Открыть выбор города/}).tap();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.ok(await lead.isVisible());
 assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${width}-${theme}.png`});results.push({width,theme,firstTap:true,formPreserved:true});
 }catch(e){await page.screenshot({path:`${out}/failure.png`});throw e;}finally{await context.close();}
}console.log(JSON.stringify({passed:true,engine,cases:results.length}));}finally{fs.writeFileSync(`${out}/results.json`,JSON.stringify(results));await browser.close();await new Promise(r=>server.close(r));}
