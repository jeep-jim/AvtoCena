// Real InlineOfferParameters component, application CSS, locally mocked calculation only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { chromium } from 'playwright';
const out='artifacts/wide-parameter-panels'; fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/recycling-power-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
const layout=fs.readFileSync('apps/web/app/layout.tsx','utf8');
const imports=[...layout.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve('apps/web/app',m[1]));
assert.ok(imports.length);
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/InlineOfferParameters.tsx','apps/web/components/catalog/RecyclingPower.tsx','tests/browser/recycling-power-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n'),{from:'apps/web/app/globals.css'});
fs.writeFileSync(`${out}/app.css`,css.css);
const html=`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><style>:root{--ac-text:#f7f8fa;--ac-muted:#a5acb8;--ac-surface:#1b2029;--ac-surface-2:#273242;--ac-border:#556070}html[data-theme=light]{--ac-text:#17202b;--ac-muted:#525c6a;--ac-surface:#fff;--ac-surface-2:#e3e7ed;--ac-border:#c7ced9}body{margin:0;font-family:Arial,sans-serif}</style><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server=http.createServer((req,res)=>{const name=(req.url||'/').split('?')[0];if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}const file=path.join(out,path.basename(name));if(fs.existsSync(file)){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
const results=[];
try{
 for(const theme of ['dark','light'])for(const width of [320,360,390,414,768,1280]){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<768});
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/catalog/offer/qa-118/calculate',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({json:{totalRub:4333490,customs:{vehicleCategory:'M1'},breakdown:[{id:'utilization-fee',title:'Утилизационный сбор',amountRub:900000}]}});});
  await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
  const grid=page.locator('[data-parameter-editor-grid]');await grid.waitFor();
  const summaries=grid.locator('[data-parameter-editor] > summary');assert.equal(await summaries.count(),4);
  const original=await summaries.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height};}));
  for(let i=0;i<4;i++){
   const trigger=summaries.nth(i);await trigger.click();
   const panel=grid.locator('[data-parameter-editor][open] [data-parameter-panel]');await panel.waitFor({state:'visible'});
   assert.equal(await grid.locator('[data-parameter-editor][open]').count(),1);
   const g=await grid.boundingBox(),b=await panel.boundingBox();
   assert.ok(Math.abs(b.x-g.x)<1&&Math.abs(b.width-g.width)<1,`full width ${theme}/${width}/${i}`);
   assert.ok(b.y>=g.y+g.height,`panel below grid ${theme}/${width}/${i}`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const now=await summaries.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height};}));
   assert.deepEqual(now,original,'opening cannot move or resize the four tiles');
   if(width===390&&(i===0||i===3))await page.screenshot({path:`${out}/${theme}-${width}-${i}.png`,fullPage:true});
  }
  await page.keyboard.press('Escape');assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0);
  await summaries.nth(0).click();await grid.getByRole('button',{name:'Закрыть: Дата выпуска',exact:true}).click();assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0);
  await summaries.nth(1).click();await summaries.nth(1).click();assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0);
  await summaries.nth(0).click();await grid.getByRole('spinbutton',{name:'Год выпуска',exact:true}).fill('2025');await page.waitForTimeout(850);assert.equal(requests.at(-1)?.powerKw,'118');
  await summaries.nth(3).click();await grid.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true}).fill('150');await page.waitForTimeout(850);assert.equal(requests.at(-1)?.powerKw,'');
  await page.getByRole('button',{name:'Вернуть исходные данные',exact:true}).click();await summaries.nth(3).locator('[data-recycling-power="paired"]').waitFor();
  assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0,'outside reset closes panel with one tap');
  assert.deepEqual(errors,[]);results.push({theme,width,panels:4,fullWidth:true,tilesUnchanged:true,oneOpenPanel:true,keyboardAndReset:true});await page.close();
 }
 fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({cases:results.length,panelOpenings:results.length*4,results}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
