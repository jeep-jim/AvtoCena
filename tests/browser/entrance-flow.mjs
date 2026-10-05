import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/entrance-flow'; fs.mkdirSync(out, {recursive: true});
await build({external:['/fonts/*','/brands/*'],entryPoints: ['tests/browser/entrance-flow-fixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: `${out}/fixture.js`, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [{name: 'next', setup(b) {
  b.onResolve({filter: /^next\/(link|navigation)$/}, a => ({path: a.path, namespace: 'mock'}));
  b.onLoad({filter: /.*/, namespace: 'mock'}, a => ({contents: a.path === 'next/navigation' ? 'export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:()=>{},refresh:()=>{}});' : `import React from 'react';export default function Link(p){return React.createElement('a',p)}`, loader: 'jsx', resolveDir: process.cwd()}));
}}]});
const css = await postcss([tailwindcss({content: ['apps/web/components/**/*.tsx'], theme: {extend: {}}, plugins: []})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from: undefined});
const picture = await sharp({create: {width: 240, height: 280, channels: 4, background: '#4b654a'}}).webp().toBuffer();
const server = http.createServer((req, res) => {
  if (/^\/fonts\/inter-(latin|cyrillic)-wght-normal\.woff2$/.test(req.url)) {res.setHeader('Content-Type','font/woff2');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (/^\/avatars\/customers\/(?:character|city-cars|offroad-cars)-\d+\.svg$/.test(req.url)) {res.setHeader('Content-Type','image/svg+xml');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (req.url==='/dealers/default-cover.svg'||req.url==='/logo/avtocena-mark-dark.svg'||req.url==='/logo/avtocena-mark-light.svg') {res.setHeader('Content-Type','image/svg+xml');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (req.url.startsWith('/api/site-media/')&&req.url.endsWith('.mp4')) {res.setHeader('Content-Type','video/mp4');return res.end(fs.readFileSync('apps/web/public/account-media/loading-oct05.mp4'));}
  if (req.url.startsWith('/api/site-media/')) {res.setHeader('Content-Type', 'image/webp'); return res.end(picture);}
  if(req.url==='/key-logo.png'){res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync('apps/web/public/key-logo.png'));}
  if (req.url === '/fixture.js') {res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(`${out}/fixture.js`));}
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}${fs.readFileSync(`${out}/fixture.css`, 'utf8')}:root{--ac-surface:#fff;--ac-surface-2:#edf0f5;--ac-surface-3:#e3e7ee;--ac-text:#171b24;--ac-muted:#657080;--ac-border:#ccd0d6;--ac-accent:#c91f2d}[data-theme=dark]{--ac-surface:#11141c;--ac-surface-2:#181b24;--ac-surface-3:#20232d;--ac-text:#edf3ff;--ac-muted:#9babc3;--ac-border:#ffffff22;--ac-accent:#ff303d}.account-cabinet-page .ac-public-header{position:fixed!important;inset:0 0 auto 0!important;width:100%!important}body{margin:0;padding:16px;background:var(--ac-surface);color:var(--ac-text)}#root{max-width:1120px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || undefined, headless: true, args: ['--no-sandbox']});
try {
  for(const width of [390,1440]) for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    await page.clock.install();await page.goto(origin+'/login?scenes&header');await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const initialHeight=await page.locator('.account-welcome').evaluate(node=>node.getBoundingClientRect().height);
    await page.locator('.step-node').nth(1).click();await page.mouse.move(0,0);
    await page.clock.runFor(1500);
    assert.equal(await page.locator('[data-demo-id="contractViewer"]').evaluate(node=>node.classList.contains('is-active')),false);
    await page.clock.runFor(1000);assert.equal(await page.locator('[data-demo-id="contractViewer"]').evaluate(node=>node.classList.contains('is-active')),true);
    assert.equal(await page.locator('[data-demo-id="contractStatus"]').evaluate(node=>node.classList.contains('is-visible')),false);
    await page.clock.runFor(2200);
    const check=await page.locator('[data-demo-id="contractConfirmCheck"]').boundingBox(),paper=await page.locator('[data-demo-id="contractViewer"]').boundingBox();
    assert.ok(check.y>paper.y+paper.height*.65);assert.ok(Math.abs(check.x+check.width/2-paper.x-paper.width/2)<2);
    await page.clock.runFor(2000);assert.equal(await page.locator('.scene-contract.is-complete').count(),1);
    assert.equal(await page.locator('[data-demo-id="contractStatus"]').evaluate(node=>getComputedStyle(node).display),'flex');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.contract-handshake')).opacity==='1'&&getComputedStyle(document.querySelector('.contract-viewer')).opacity==='0');
    await page.screenshot({path:`${out}/handshake-${width}-${theme}.png`});
    await page.locator('.step-node').nth(2).click();await page.mouse.move(0,0);
    for(let stop=0;stop<5;stop++) {
      await page.clock.runFor(stop===0?100:2200);
      assert.equal(await page.locator('.track-point-wrap.is-active').getAttribute('data-index'),String(stop));
      assert.ok((await page.locator('[data-demo-id="trackArrival"]').innerText()).length>5);
      const x=await page.locator('[data-demo-id="trackTruck"]').evaluate(node=>parseFloat(node.style.left));
      await page.clock.runFor(100);assert.equal(await page.locator('[data-demo-id="trackTruck"]').evaluate(node=>parseFloat(node.style.left)),x,'car dwells at checkpoint');
      if(stop===1)await page.screenshot({path:`${out}/freight-${width}-${theme}.png`});
    }
    assert.equal(await page.locator('.account-welcome').evaluate(node=>node.getBoundingClientRect().height),initialHeight);
    await page.clock.resume();
    await page.locator('.account-roles button').filter({hasText:'Автодилер'}).click();
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.account-roles button').count(),4);
    assert.equal(await page.locator('.account-roles button[aria-pressed="true"] strong').innerText(),'Автодилер');
    if(width<761){
      const y=await page.locator('#account-login-form').evaluate(node=>node.getBoundingClientRect().top);
      const bottom=await page.locator('.ac-public-header').evaluate(node=>node.getBoundingClientRect().bottom);
      assert.ok(Math.abs(y-bottom)<3,`form ${y} header ${bottom}`);
    }else{
      const benefits=await page.locator('.account-dealer-benefits').boundingBox(),roles=await page.locator('.account-roles').boundingBox();assert.ok(benefits.x+benefits.width<roles.x);
    }
    await page.screenshot({path:`${out}/dealer-${width}-${theme}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.close();console.log(JSON.stringify({width,theme,contract:true,route:true,roles:true}));
  }
  const auto=await browser.newPage({viewport:{width:390,height:1000}});await auto.clock.install();await auto.goto(origin+'/login?scenes');await auto.mouse.move(0,0);await auto.clock.runFor(52000);assert.equal(await auto.locator('.step-node[aria-pressed="true"]').innerText(),'6');assert.equal(await auto.locator('.account-scenes').getAttribute('data-paused'),'true');await auto.clock.runFor(30000);assert.equal(await auto.locator('.step-node[aria-pressed="true"]').innerText(),'6');await auto.close();
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});await page.goto(origin+'/controls');
    for(const market of ['japan','china','korea']){
      await page.locator('[name="calcMarket"]').selectOption(market);await page.waitForURL(url=>url.searchParams.get('calcMarket')===market);
      assert.equal(new URL(page.url()).searchParams.get('calcPowerHp'),'150');assert.equal(new URL(page.url()).searchParams.get('calcSourcePrice'),'1000000');
      assert.ok(await page.getByText('Цена объявления, '+({japan:'JPY',china:'CNY',korea:'KRW'}[market]),{exact:true}).count());
    }
    if(width<1280){
      const anchor=page.locator('.ac-offer-contact-anchor'),button=page.getByRole('button',{name:'Связаться',exact:true});
      const y=await anchor.evaluate(node=>node.getBoundingClientRect().top+scrollY);
      await page.evaluate(y=>scrollTo(0,y+250),y);await page.waitForTimeout(100);assert.equal(await anchor.getAttribute('data-stuck'),'true');assert.ok(Math.abs((await button.boundingBox()).y-72)<2);
      await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);assert.equal(await anchor.getAttribute('data-stuck'),'false');assert.equal(await button.evaluate(node=>node.style.position),'');
    }
    await page.getByRole('button',{name:'АвтоРасчёт',exact:true}).click();await page.getByRole('link',{name:'Заполнить самостоятельно'}).click();await page.waitForURL('**/autocalc?manual=1#autocalc-parameters');await page.getByLabel('Марка автомобиля',{exact:true}).fill('Toyota');assert.equal(await page.getByLabel('Марка автомобиля',{exact:true}).inputValue(),'Toyota');await page.close();console.log(JSON.stringify({width,manual:true,market:true,sticky:true}));
  }
} finally {await browser.close();server.close();}
