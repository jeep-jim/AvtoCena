import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { chromium } from 'playwright';
const out='artifacts/recycling-power'; fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/recycling-power-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
// Use current application styles, in their actual root-layout import order.
const layout=fs.readFileSync('apps/web/app/layout.tsx','utf8');
const imports=[...layout.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve('apps/web/app',m[1]));
assert.ok(imports.length>0,'application CSS imports must be discovered, not guessed');
const input=imports.map(p=>fs.readFileSync(p,'utf8')).join('\n');
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/InlineOfferParameters.tsx','apps/web/components/catalog/RecyclingPower.tsx','tests/browser/recycling-power-fixture.tsx']}),autoprefixer]).process(input,{from:'apps/web/app/globals.css'});
fs.writeFileSync(`${out}/app.css`,css.css);
const html=`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><style>:root{--ac-text:#f7f8fa;--ac-muted:#a5acb8;--ac-surface:#1b2029;--ac-surface-2:#273242;--ac-border:#556070}html[data-theme=light]{--ac-text:#17202b;--ac-muted:#525c6a;--ac-surface:#fff;--ac-surface-2:#e3e7ed;--ac-border:#c7ced9}body{margin:0;font-family:Arial,sans-serif}</style><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server=http.createServer((req,res)=>{const name=(req.url||'/').split('?')[0]; if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;} const file=path.join(out,path.basename(name));if(fs.existsSync(file)){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const metrics=[];
try{
for(const theme of ['dark','light'])for(const width of [320,360,390,414,768,1280]){
const page=await browser.newPage({viewport:{width,height:900}});const errors=[];const requests=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/api/catalog/offer/qa-118/calculate',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({json:{totalRub:4333490,customs:{vehicleCategory:'M1',ageBand:'up_to_3_years'},breakdown:[{id:'utilization-fee',title:'Утилизационный сбор',amountRub:900000}]}});});
await page.goto(`${origin}/?theme=${theme}`);await page.locator('[data-recycling-power="paired"]').first().waitFor();
assert.equal(await page.locator('[data-recycling-power="paired"]').count(),3);
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`page overflow ${theme}/${width}`);
for(const unit of await page.locator('[data-recycling-power="paired"] > span').all()){
const b=await unit.boundingBox();assert.ok(b&&b.x>=-1&&b.x+b.width<=width+1,`power text clipped ${theme}/${width}`);
}
for(const chip of await page.locator('[data-recycling-power-chip]').all()){
const boxes=await chip.evaluate(el=>{const a=el.closest('article').querySelector('[data-price-arrow]').getBoundingClientRect();const b=el.getBoundingClientRect();return {arrowBottom:a.bottom,chipTop:b.top};});assert.ok(boxes.chipTop>=boxes.arrowBottom,`arrow overlap ${theme}/${width}`);
}
const summary=page.locator('summary[aria-label^="Мощность:"]');
const s=await summary.boundingBox();const text=await summary.locator('[data-recycling-power]').boundingBox();assert.ok(s&&text&&text.y>=s.y&&text.y+text.height<=s.y+s.height,`power tile height overflow ${theme}/${width}`);
await page.screenshot({path:`${out}/${theme}-${width}.png`,fullPage:true});
await summary.click();await page.getByText('118 кВт > 117,68 кВт.',{exact:false}).first().waitFor({state:'visible'});
await page.keyboard.press('Escape');assert.equal(await summary.evaluate(el=>el.parentElement.open),false);
await page.getByText('Структура цены',{exact:true}).click();const help=page.locator('[data-recycling-fee-help] > summary').first();await help.focus();await page.keyboard.press('Enter');assert.equal(await help.evaluate(el=>el.parentElement.open),true);
await page.locator('summary[aria-label^="Дата выпуска:"]').click();await page.getByRole('spinbutton',{name:'Год выпуска',exact:true}).fill('2025');await page.waitForTimeout(850);assert.equal(requests.at(-1)?.powerKw,'118');
await summary.click();await page.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true}).fill('150');await page.waitForTimeout(850);assert.equal(requests.at(-1)?.powerKw,'');assert.equal(await summary.locator('[data-recycling-power="paired"]').count(),0);
await page.getByRole('button',{name:'Вернуть исходные данные'}).click();assert.equal(await summary.locator('[data-recycling-power="paired"]').count(),1);
assert.deepEqual(errors,[]);metrics.push({theme,width,overflow:false,arrowOverlap:false,pairedPowerVisible:true,yearEditPreservesKw:true,hpEditClearsKw:true,resetRestoresKw:true});await page.close();
}
fs.writeFileSync(`${out}/results.json`,JSON.stringify(metrics,null,2));console.log(JSON.stringify({cases:metrics.length,results:metrics},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
