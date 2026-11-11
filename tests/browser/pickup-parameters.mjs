import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/pickup-parameters';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/pickup-parameters-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/InlineOfferParameters.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;:root{--ac-surface:white;--ac-surface-2:#eee;--ac-text:#111;--ac-muted:#555}output{display:none}',{from:undefined});fs.writeFileSync(`${out}/app.css`,css.css);
const server=http.createServer((req,res)=>{const name=req.url.split('?')[0];if(['/fixture.js','/fixture.css','/app.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(out+name));return;}res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  for(const market of ['uae','korea','europe','georgia','japan','china']){
   await page.goto(`http://127.0.0.1:${server.address().port}/?market=${market}`);
   await page.locator(market==='china'?'summary[aria-label^="Полная масса пикапа"]':'summary[aria-label^="Категория и масса"]').click();
   if(market!=='china'){await page.getByRole('combobox',{name:'Категория транспортного средства'}).selectOption('N1');await page.locator('summary[aria-label^="Полная масса пикапа"]').click();}
   const mass=page.getByRole('spinbutton',{name:/Полная.*масса|Разрешённая.*масса/i});
   await mass.fill('2910');
   assert.equal(JSON.parse(await page.locator('[data-draft]').textContent()).grossVehicleWeightKg,'2910');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${out}/${market}-${width}.png`});
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Pickup category and mass: six market fixtures, 390/1440px passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
