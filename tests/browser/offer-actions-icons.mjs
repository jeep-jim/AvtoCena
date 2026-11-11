import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/offer-actions';fs.mkdirSync(out,{recursive:true});
const built=await build({entryPoints:['tests/browser/offer-actions-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const css=(await postcss([tailwindcss({content:['apps/web/components/catalog/OfferContactActions.tsx','apps/web/components/catalog/ShareLinkButton.tsx','apps/web/components/catalog/FavoriteToggle.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;body{background:#1a2029;color:white}',{from:undefined})).css;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><style>${css}</style></head><body><div id="root"></div><script>${built.outputFiles[0].text}</script></body></html>`)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{for(const width of [1280,1440,1920]){const page=await browser.newPage({viewport:{width,height:200}});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForSelector('[data-has-copy="true"][data-has-pdf="true"]');const boxes=await page.locator('.ac-offer-contact-button').evaluateAll(buttons=>buttons.map(b=>{const icon=b.querySelector('svg'),label=[...b.children].find(e=>e.tagName==='SPAN'&&!e.querySelector('svg'));const i=icon.getBoundingClientRect(),t=label.getBoundingClientRect();return {display:getComputedStyle(icon).display,width:i.width,height:i.height,iconRight:i.right,textLeft:t.left,scroll:b.scrollWidth,client:b.clientWidth}}));for(const b of boxes){assert.notEqual(b.display,'none');assert.ok(b.width>0&&b.height>0);assert.ok(b.textLeft>=b.iconRight+4,JSON.stringify(b));assert.ok(b.scroll<=b.client+1,JSON.stringify(b));}await page.screenshot({path:`${out}/${width}.png`});console.log(width,boxes);await page.close();}}finally{await browser.close();server.close();}
