import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium,webkit,devices}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/china-cards';fs.mkdirSync(out,{recursive:true});
const next={name:'next-fixture',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',resolveDir:process.cwd(),contents:a.path.endsWith('navigation')?`export const useRouter=()=>({prefetch(){},push(){}});export const usePathname=()=>'/cars';export const useSearchParams=()=>new URLSearchParams();`:`import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}`}));}};
await build({entryPoints:['tests/browser/china-cards-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:out+'/app.js',tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[next]});
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/**/*.{ts,tsx}','tests/browser/china-cards-fixture.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;body{background:#111827;color:white}',{from:undefined});fs.writeFileSync(out+'/style.css',css.css);
const server=http.createServer((req,res)=>{const file=out+req.url;if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');}else if(fs.existsSync(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(file));}else res.end('{}');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const device of ['desktop','android','iphone']){
 const browser=device==='iphone'?await webkit.launch():await chromium.launch({executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
 try{const page=await browser.newPage(device==='iphone'?devices['iPhone 13']:device==='android'?devices['Pixel 7']:{viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.getByText('1.6L Комфорт 2 места фургон',{exact:true}).waitFor();await page.getByText('1.6L Комфорт 5 мест фургон',{exact:true}).waitFor();assert.equal(await page.getByText('Комплектация · фото модели',{exact:true}).count(),2);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${device}.png`,fullPage:true});console.log(device+': both distinct trims visible, no horizontal overflow, no runtime errors');
 }finally{await browser.close();}
}}finally{server.close();}
