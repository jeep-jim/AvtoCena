import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/catalog-single-loader';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/catalog-single-loader.tsx'],bundle:true,format:'iife',outfile:`${out}/fixture.js`,jsx:'automatic',plugins:[{name:'next-fixture',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"const router={prefetch(url){(window.__prefetches||=[]).push(url)}};export const useRouter=()=>router;export const usePathname=()=>'/cars';export const useSearchParams=()=>new URLSearchParams();"}));}}]});
const server=http.createServer((req,res)=>{res.end(req.url==='/fixture.js'?fs.readFileSync(`${out}/fixture.js`):'<!doctype html><style>.opacity-0{opacity:0}.opacity-100{opacity:1}.fixed{position:fixed}.top-0{top:0}.pointer-events-none{pointer-events:none}</style><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});
try {
 for (const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__loaderQueries=0;
   const query=Document.prototype.querySelector;
   Document.prototype.querySelector=function(selector){if(selector.startsWith('[data-catalog-'))window.__loaderQueries++;return query.call(this,selector)};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.ac-route-loader').waitFor({state:'attached'});
  const visible=()=>page.locator('.ac-route-loader').evaluateAll(nodes=>nodes.filter(n=>n.getAttribute('aria-hidden')!=='true').length);
  await page.getByText('Filter',{exact:true}).click();
  await page.locator('[data-catalog-filter-pending="true"]').waitFor({state:'attached'});
  await page.waitForTimeout(150);assert.equal(await visible(),0,'filters use local feedback');
  await page.getByText('Stream',{exact:true}).click();await page.waitForTimeout(150);
  assert.equal(await visible(),0,'streaming filter results must not restart the header');
  await page.getByLabel('Цена').fill('2000000');await page.getByText('Submit filter',{exact:true}).click();
  await page.waitForTimeout(150);assert.equal(await visible(),0,'Enter/submit inside filters stays local');
  const scans=await page.evaluate(()=>window.__loaderQueries);
  await page.evaluate(()=>{for(let i=0;i<100;i++){const row=document.createElement('span');row.textContent='photo '+i;document.getElementById('unrelated-updates').append(row)}});
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__loaderQueries),scans,'unrelated cards/photos must not rescan document');
  await page.getByText('Filter',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ac-route-loader[aria-hidden="false"]'));
  assert.equal(await visible(),1,'initial streamed page still has one loader');
  await page.getByText('Stream',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ac-route-loader[aria-hidden="true"]'));
  const link=page.getByText('Plain car link',{exact:true});
  await link.dispatchEvent('pointerdown',{pointerType:'touch'});
  await link.dispatchEvent('pointerover',{pointerType:'touch'});
  await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>window.__prefetches||[]),[],'touch scrolling does not start detail requests');
  await link.dispatchEvent('pointerdown',{pointerType:'mouse'});
  assert.deepEqual(await page.evaluate(()=>window.__prefetches),['/cars/offer/fixture']);
  assert.equal(await page.locator('.ac-route-loader').count(),1);
  assert.deepEqual(errors,[]);await page.close();
  console.log(`PASS ${width}: local filters, streamed-page feedback, no body scans for unrelated mutations, no touch prefetch`);
 }
} finally {await browser.close();server.close();}
