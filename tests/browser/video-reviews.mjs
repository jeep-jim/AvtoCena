import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/video-reviews'; fs.mkdirSync(out, {recursive: true});
await build({entryPoints:['tests/browser/video-reviews-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,define:{'process.env.NODE_ENV':'"production"'}});
const css = await postcss([tailwindcss({content:['apps/web/components/dealers/VideoReviews.tsx'],theme:{extend:{}},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
const server = http.createServer((req,res) => {
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(`${out}/fixture.js`));}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}:root{--ac-surface:white;--ac-text:#171b24;--ac-muted:#657080;--ac-border:#ccd0d6}[data-theme=dark]{--ac-surface:#1a2029;--ac-text:#edf3ff;--ac-muted:#a2b0c3;--ac-border:#ffffff22}body{margin:0;padding:16px;background:var(--ac-surface);color:var(--ac-text)}#root{max-width:960px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try {
 for(const width of [320,390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:850}});
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  // Only tests layout/integration; these responses do not assert vendor availability.
  await page.route(/^https:\/\//,route => route.request().resourceType()==='media'
    ?route.fulfill({status:200,contentType:'video/mp4',body:fs.readFileSync('apps/web/public/account-media/loading-oct05.mp4')})
    :route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><body style="margin:0;background:#111;color:white;display:grid;place-items:center;height:100vh;font:20px sans-serif">▶ Видеообзор</body>'}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.waitForSelector('iframe');
  assert.equal(await page.locator('iframe').count(),8);
  assert.equal(await page.locator('button').count(),0,'player needs no intermediate click');
  assert.equal(await page.locator('a[target="_blank"]').count(),10);
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
  assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
  for(const frame of await page.locator('iframe').all()){
   const box=await frame.boundingBox();assert.ok(Math.abs(box.width/box.height-16/9)<0.02);
   assert.ok(box.x>=0&&box.x+box.width<=width);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${out}/${width}-${theme}.png`});
  await page.locator('video').dispatchEvent('error');
  assert.equal(await page.getByText('Не удалось загрузить видео. Попробуйте открыть его по ссылке.').count(),1);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: eight immediate players, native video, source links, stable 16:9, six width/theme combinations, error fallback');
} finally {await browser.close();await new Promise(r=>server.close(r));}
