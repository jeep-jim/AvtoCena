import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/customer-feedback'; fs.mkdirSync(out, {recursive: true});
await build({external:['/fonts/*','/brands/*'],entryPoints: ['tests/browser/account-entrance-fixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: `${out}/fixture.js`, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [{name: 'next', setup(b) {
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
 for(const width of [320,390,1440])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:1000}});let gets=0,posts=0,fail=false;let release;
 const client={key:'client',name:'Анна',manager:{name:'Стас Наумов',avatar:'/api/site-media/manager'},dealer:{name:'Top Avto'},reviewSummary:{rating:4.7,count:12},leads:[{id:'lead',title:'Changan V5',status:'Договор подписан',reviewAvailableAt:new Date().toISOString(),updatedAt:new Date().toISOString(),canReview:true}],reviews:[],documents:[],messages:[{id:'m1',author:'Стас Наумов',avatar:'/api/site-media/manager',text:'Здравствуйте! Договор подтверждён.',createdAt:new Date().toISOString()}]};
 await page.route('**/api/account/portal',async route=>{if(route.request().method()==='GET'){gets++;return route.fulfill({json:{clients:[client]}});}posts++;const b=route.request().postDataJSON();if(b.action==='message')await new Promise(r=>release=r);if(fail)return route.fulfill({status:500,json:{error:'Не удалось сохранить. Попробуйте ещё раз.'}});return route.fulfill({json:b.action==='review'?{review:{id:'r1',leadId:'lead',rating:b.rating,text:b.text,status:'published'}}:{message:{id:'m2',text:b.text,author:'Анна',mine:true,createdAt:new Date().toISOString()}}});});
 await page.goto(origin+'/account?tab=reviews');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 await page.getByText('Нам важно ваше мнение.',{exact:false}).waitFor();assert.equal(await page.locator('select').count(),0);
 await page.getByRole('button',{name:'Оценка 4',exact:true}).click();assert.equal(await page.getByLabel('Ваша оценка',{exact:true}).innerText(),'4.0');
 await page.getByRole('slider').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');assert.equal(await page.getByLabel('Ваша оценка',{exact:true}).innerText(),'4.2');
 await page.getByLabel('Отзыв о дилере').fill('Спасибо за помощь с документами!');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/reviews-${width}-${theme}.png`,fullPage:true});
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Опубликовать отзыв'}).click();assert.equal(posts,0);
 fail=true;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Опубликовать отзыв'}).click();await page.getByRole('alert').filter({hasText:'Не удалось сохранить'}).waitFor();assert.equal(await page.getByLabel('Отзыв о дилере').inputValue(),'Спасибо за помощь с документами!');
 fail=false;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Опубликовать отзыв'}).click();await page.getByText('4.2 ★ · Спасибо! Ваш отзыв опубликован').waitFor();assert.equal(await page.getByRole('slider').count(),0);assert.equal(gets,1);
 await page.getByRole('button',{name:'Чат',exact:true}).click();await page.getByText('Здравствуйте! Договор подтверждён.').waitFor();assert.equal(await page.locator('.portal-chat-row img').getAttribute('src'),'/api/site-media/manager');
 await page.getByLabel('Сообщение менеджеру').fill('Когда будет отправка?');await page.getByRole('button',{name:'Отправить',exact:true}).click();await page.getByText('Когда будет отправка?',{exact:true}).waitFor();assert.equal(await page.locator('.portal-chat-row.mine').count(),1);await page.waitForFunction(()=>document.querySelector('.portal-chat-row.mine small')?.textContent.includes('Отправляем'));while(!release)await new Promise(r=>setTimeout(r,10));release();await page.getByRole('button',{name:'Отправить',exact:true}).waitFor();assert.equal(gets,1);assert.equal(await page.locator('.portal-chat-row.mine').count(),1);
 await page.screenshot({path:`${out}/chat-${width}-${theme}.png`,fullPage:true});await page.getByRole('button',{name:'Заявки',exact:true}).click();await page.getByText('Подтверждено компанией',{exact:true}).waitFor();assert.equal(await page.locator('.portal-contract-check').count(),1);await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.portal-contract-check').evaluate(e=>getComputedStyle(e).animationName),'none');await page.screenshot({path:`${out}/applications-${width}-${theme}.png`,fullPage:true});
 for(const name of ['Документы','Оповещения','Профиль']){await page.getByRole('button',{name,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.ok(await page.locator('.portal-manager img').count()>0);}
 await page.close();
 }
 console.log('Feedback and chat: six viewport/theme combinations passed; decimal rating, draft retention, immediate pending message and no full reload verified.');
}finally{await browser.close();server.close();}
