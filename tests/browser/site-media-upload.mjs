import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';
import {createRequire} from 'node:module';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/site-media-upload'; fs.mkdirSync(out, {recursive: true});
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

const stored=new Map();globalThis.__mediaBrowserStorage=stored;
const apiBuild=await build({entryPoints:['apps/web/app/(crm)/api/crm/site-media/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'auth-fixture',setup(b){const mocks={
 '@/lib/auth':`export const getCurrentUser=async()=>({id:'owner',role:'owner',companyId:'dealer_topavto',status:'active'});`,
 '@/lib/data':`export const getJsonStorage=()=>({putBinary:async(k,data)=>globalThis.__mediaBrowserStorage.set(k,{data}),getBinary:async k=>globalThis.__mediaBrowserStorage.get(k),deleteBinary:async k=>globalThis.__mediaBrowserStorage.delete(k)});`
};b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const mod={exports:{}};new Function('require','module','exports',apiBuild.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
try{
 for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});const sizes=[];let saved;
 await page.route('**/api/crm/site-media',async route=>{
  const req=route.request();const bytes=req.postDataBuffer();sizes.push(bytes.length);
  const response=await mod.exports.POST(new Request('https://avtocena.com/api/crm/site-media',{method:'POST',headers:{...req.headers(),origin:'https://avtocena.com'},body:bytes}));
  await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
 });
 await page.route('**/api/site-media/*',async route=>{const id=route.request().url().split('/').pop();const file=stored.get('settings/account-media/'+id);return file?route.fulfill({body:file.data,contentType:'video/mp4'}):route.continue();});
 await page.route('**/api/crm/public-features',route=>{saved=route.request().postDataJSON();return route.fulfill({json:{ok:true,...saved}});});
 await page.goto(origin+'/crm/site');
 const original=fs.readFileSync('apps/web/public/account-media/loading-oct05.mp4'),free=Buffer.alloc(4*1024*1024);free.writeUInt32BE(free.length);free.write('free',4);
 await page.getByLabel('Добавить фото или видео в сцену файлов',{exact:true}).setInputFiles({name:'delivery.mp4',mimeType:'video/mp4',buffer:Buffer.concat([original,free])});
 const video=page.locator('section[aria-label="Фото и видео в сцене файлов"] video');await video.waitFor();
 await video.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForFunction(()=>document.querySelector('section[aria-label="Фото и видео в сцене файлов"] video').currentTime>0);
 assert.ok(Math.max(...sizes)<3.5*1024*1024);assert.ok(sizes.filter(n=>n>2*1024*1024).length>=2);
 await page.getByRole('button',{name:'Сохранить настройки',exact:true}).click();await page.getByRole('status').filter({hasText:'Настройки сайта сохранены'}).waitFor();
 assert.equal(saved.accountAppearance.customer.media[0].type,'video');assert.ok(saved.accountAppearance.customer.media[0].url.endsWith('.mp4'));
 await page.addInitScript(value=>window.__ACCOUNT_APPEARANCE__=value,saved.accountAppearance);
 await page.goto(origin+'/login?scenes');await page.getByRole('button',{name:/Сцена 4:/}).click();
 await page.getByRole('button',{name:'delivery',exact:true}).click();
 const surface=width<761?page.locator('.entrance-media-dialog'):page.locator('.entrance-media-preview');
 await surface.waitFor({state:'visible'});await surface.locator('video').evaluate(async v=>{v.muted=true;await v.play();});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.entrance-media-dialog video,.entrance-media-preview video')).some(v=>v.currentTime>0));
 await page.route('**/api/account/portal',r=>r.fulfill({json:{clients:[]}}));await page.goto(origin+'/account');
 const game=page.getByRole('button',{name:/Погнали/});await game.waitFor();
 for(const icon of await game.locator('span[aria-hidden]').all())assert.equal(await icon.evaluate(n=>getComputedStyle(n).transform),'matrix(-1, 0, 0, 1, 0, 0)');
 console.log(JSON.stringify({width,largeMp4Uploaded:true,playback:true,settingsSaved:true,gameIconsFlipped:true,maxRequest:Math.max(...sizes)}));await page.close();
 }
}finally{await browser.close();server.close();delete globalThis.__mediaBrowserStorage;}
