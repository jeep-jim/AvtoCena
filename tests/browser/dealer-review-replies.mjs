import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/dealer-reviews'; fs.mkdirSync(out, {recursive: true});
await build({external:['/fonts/*','/brands/*'],entryPoints: ['tests/browser/dealer-review-fixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: `${out}/fixture.js`, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [{name: 'next', setup(b) {
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
try{
 for(const width of [320,390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:850}});let fail=true,deleted=0;
  await page.route('**/api/dealers/*/reviews',route=>{const b=route.request().postDataJSON();return route.fulfill(fail?{status:500,json:{error:'Не удалось сохранить ответ.'}}:{json:{reply:{text:b.text,createdAt:'2026-10-05T00:00:00Z'}}});});
  await page.route('**/api/account/review-moderation',route=>{deleted++;return route.fulfill({json:{ok:true}});});
  await page.goto(origin+'/?role=visitor');await page.getByText('Стас',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Ответить',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Удалить',exact:true}).count(),0);
  await page.goto(origin+'/?role=dealer');await page.getByRole('button',{name:'Ответить',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Удалить',exact:true}).count(),0);
  await page.goto(origin+'/?role=owner');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.getByRole('button',{name:'Ответить',exact:true}).click();await page.getByLabel('Ответ компании',{exact:true}).fill('Благодарим за отзыв! Рады были помочь.');await page.getByRole('button',{name:'Опубликовать ответ'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Ответ компании',{exact:true}).inputValue(),'Благодарим за отзыв! Рады были помочь.');
  fail=false;await page.getByRole('button',{name:'Опубликовать ответ'}).click();await page.getByText('Ответ Top Avto',{exact:true}).waitFor();assert.equal(await page.getByText('Благодарим за отзыв! Рады были помочь.',{exact:true}).count(),1);
  const box=await page.locator('.dealer-review-score').boundingBox(),name=await page.locator('.dealer-review-author-row>strong').boundingBox();assert.ok(box.x>name.x+name.width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.screenshot({path:`${out}/review-${width}-${theme}.png`,fullPage:true});
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Удалить',exact:true}).click();assert.equal(deleted,0);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Удалить',exact:true}).click();await page.locator('.dealer-customer-review').waitFor({state:'detached'});assert.equal(deleted,1);await page.close();
 }
 console.log('Dealer review cards: visitor/dealer/owner controls, reply drafts, publication, deletion and six viewport/theme combinations passed.');
}finally{await browser.close();server.close();}
