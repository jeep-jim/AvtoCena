import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/hybrid-revision-sync';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/hybrid-revision-sync-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const server=http.createServer((req,res)=>{const name=req.url.split('?')[0];if(['/fixture.js','/fixture.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(out+name));return;}res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--ac-surface:white;--ac-surface-2:#eee;--ac-text:#111;--ac-muted:#555}body{max-width:450px;padding:16px}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/api/catalog/rates',r=>r.fulfill({json:{rates:[]}}));
 await page.route('**/api/catalog/offer/hybrid/calculate',r=>r.fulfill({json:{totalRub:2100000,breakdown:[]}}));
 await page.goto(origin);const power=page.getByRole('spinbutton',{name:'30-минутная мощность, кВт',exact:true});
 await page.locator('summary').filter({hasText:'Мощность гибрида'}).click();assert.equal(await power.inputValue(),'45');
 await page.evaluate(()=>{window.nextPower=60;dispatchEvent(new Event('avtocena:encyclopedia-updated'));});
 await page.waitForFunction(()=>document.querySelector('[aria-label="30-минутная мощность, кВт"]')?.value==='60');
 await page.evaluate(()=>{window.nextPower=45;dispatchEvent(new StorageEvent('storage',{key:'avtocena.encyclopedia-updated.v1',newValue:'next'}));});
 await page.waitForFunction(()=>document.querySelector('[aria-label="30-минутная мощность, кВт"]')?.value==='45');
 await power.fill('70');const refreshes=await page.evaluate(()=>window.refreshes);
 await page.evaluate(()=>{window.nextPower=80;dispatchEvent(new Event('avtocena:encyclopedia-updated'));});
 await page.waitForTimeout(250);assert.equal(await power.inputValue(),'70');assert.equal(await page.evaluate(()=>window.refreshes),refreshes,'unsaved user changes must block a route refresh');
 await page.goto(origin+'/?archive=1');await page.locator('summary').filter({hasText:'Мощность гибрида'}).click();
 await page.evaluate(()=>{window.nextPower=80;dispatchEvent(new Event('avtocena:encyclopedia-updated'));});await page.waitForTimeout(250);
 assert.equal(await power.inputValue(),'45');assert.equal(await page.evaluate(()=>window.refreshes||0),0,'shared archived inputs remain fixed');
 assert.deepEqual(errors,[]);console.log('PASS hybrid 45→60→45 with same saved version; cross-tab refresh; unsaved input and archive protection');
}finally{await browser.close();await new Promise(r=>server.close(r));}
