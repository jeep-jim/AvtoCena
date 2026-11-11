import {checkDealerPreview} from './dealer-preview-checks.mjs';
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
  res.end(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}${fs.readFileSync(`${out}/fixture.css`, 'utf8')}:root{--ac-page-bg:#edf0f6;--ac-bg:var(--ac-page-bg);--ac-surface:#fff;--ac-surface-2:#edf0f5;--ac-surface-3:#e3e7ee;--ac-text:#171b24;--ac-muted:#657080;--ac-border:#ccd0d6;--ac-accent:#c91f2d}[data-theme=dark]{--ac-page-bg:#1a2029;--ac-surface:#11141c;--ac-surface-2:#181b24;--ac-surface-3:#20232d;--ac-text:#edf3ff;--ac-muted:#9babc3;--ac-border:#ffffff22;--ac-accent:#ff303d}.account-cabinet-page .ac-public-header{position:fixed!important;inset:0 0 auto 0!important;width:100%!important}body{margin:0;padding:16px;background:var(--ac-surface);color:var(--ac-text)}#root{max-width:1120px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || undefined, headless: true, args: ['--no-sandbox']});
try{for(const width of [320,390,760,768,1440])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:900}});await page.goto(origin+'/login?scenes&header');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 await page.locator('.account-roles button').filter({hasText:'Автодилер'}).click();
 await page.locator('#staff-login').waitFor();await page.waitForTimeout(800);
 const position=await page.locator('#account-login-form').evaluate(n=>({top:n.getBoundingClientRect().top,header:document.querySelector('.ac-public-header').getBoundingClientRect().bottom}));
 assert.ok(Math.abs(position.top-position.header)<3,JSON.stringify({width,theme,position}));
 // Stop temporary layout alignment as a real visitor starts scrolling.
 await page.mouse.wheel(0,-100);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(150);
 if(width<=760){
  const divider=page.locator('.dealer-inline-preview .dealer-identity-divider');
  const center=await divider.evaluate(n=>{const r=n.getBoundingClientRect(),s=n.querySelector('span').getBoundingClientRect();return Math.abs(r.x+r.width/2-s.x-s.width/2)});assert.ok(center<2);
  const intro=await page.locator('.dealer-inline-preview .dealer-intro').evaluate(n=>({padding:getComputedStyle(n).paddingRight,max:getComputedStyle(n).maxWidth}));assert.equal(intro.padding,'0px');assert.equal(intro.max,'none');
  const dock=page.locator('.dealer-inline-preview .dealer-dock');assert.equal(await dock.evaluate(n=>getComputedStyle(n).borderTopLeftRadius),'24px');
  await page.locator('#staff-login').scrollIntoViewIfNeeded();await page.waitForTimeout(150);assert.equal(await dock.evaluate(n=>getComputedStyle(n).borderBottomLeftRadius),'24px');assert.equal(await dock.evaluate(n=>getComputedStyle(n).borderTopLeftRadius),'0px');
  await page.screenshot({path:`${out}/entry-fixed-${width}-${theme}.png`,fullPage:true});
 }else assert.equal(await page.locator('.entrance-dealer-preview iframe').count(),1);
 assert.ok((await page.locator('.account-entrance-heading p').innerText()).endsWith('Ниже вид страницы дилера.'));
 await page.close();console.log(JSON.stringify({width,theme,formAligned:true}));
}}finally{await browser.close();server.close();}
