import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/power30';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/power30-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',outdir:out,entryNames:'fixture',define:{'process.env.NODE_ENV':'"production"'}});
const css=['select-controls.css','globals.css','catalog-ui.css','public-polish.css','flat-ui.css','public-regression-fixes.css'].map(f=>fs.readFileSync('apps/web/app/'+f,'utf8')).join('\n');
fs.writeFileSync(`${out}/app.css`,(await postcss([tailwindcss({content:[]})]).process(css,{from:undefined})).css);
const server=http.createServer((req,res)=>{const file=({'/fixture.js':'fixture.js','/fixture.css':'fixture.css','/app.css':'app.css'})[req.url];if(file){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(`${out}/${file}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{
 for(const width of [320,390,1440])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/power30?*',async route=>{
   const url=new URL(route.request().url()).searchParams.get('url');
   if(url.includes('missing'))return route.fulfill({status:404,json:{error:'Объявление не найдено. Проверьте ссылку.'}});
   if(url.includes('slow'))await new Promise(r=>setTimeout(r,500));
   const ice=url.includes('ice');
   return route.fulfill({json:{id:ice?'ice':'ev',title:ice?'Example ICE':'Example EV',href:'/cars/offer/ev',image:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#31304b"/></svg>'),inputs:{kind:ice?'ICE':'BEV',peak:ice?'':'150',torque:'',rpm:'',voltage:''},inputSources:{peak:'Мощность электромобиля из карточки'},certified:ice?undefined:{kw:60,source:'COC:test'},notes:[]}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const url=page.getByLabel('Ссылка на автомобиль с АвтоЦены');
  await url.fill('https://avtocena.com/cars/offer/ev');await page.getByRole('button',{name:'Загрузить',exact:true}).click();
  await page.getByText('≈ 112,5 кВт',{exact:true}).waitFor();assert.equal(await page.getByRole('img').count(),1);
  const peak=page.getByLabel('Пиковая мощность электромоторов, кВт',{exact:false});await peak.fill('200');assert.equal(await page.getByText('≈ 112,5 кВт',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Рассчитать оценку',exact:true}).click();await page.getByText('≈ 150 кВт',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No horizontal clipping');
  assert.equal(await page.locator('main').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(25, 24, 45)','Reference background survives site light theme');
  await url.fill('https://avtocena.com/cars/offer/ice');assert.equal(await page.getByText('≈ 150 кВт',{exact:true}).count(),0);await page.getByRole('button',{name:'Загрузить',exact:true}).click();await page.getByText('Для ДВС без тягового электромотора этот показатель не применяется.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Рассчитать оценку',exact:true}).count(),0);
  await url.fill('https://avtocena.com/cars/offer/missing');await page.getByRole('button',{name:'Загрузить',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('img').count(),0);
  await url.fill('https://avtocena.com/cars/offer/slow');await page.getByRole('button',{name:'Загрузить',exact:true}).click();await url.fill('https://avtocena.com/cars/offer/missing');await page.getByRole('button',{name:'Загрузить',exact:true}).click();await page.getByRole('alert').waitFor();await page.waitForTimeout(600);assert.equal(await page.getByText('≈ 112,5 кВт',{exact:true}).count(),0,'Late response cannot restore previous car');
  await url.evaluate(el=>{const data=new DataTransfer();data.setData('text','https://avtocena.com/cars/offer/ev');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});await page.getByText('≈ 112,5 кВт',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('power30: mobile/desktop, both themes, auto-paste, estimate, edits, ICE, missing listing and stale responses passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
