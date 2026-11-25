import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const playwright=await import(process.env.PLAYWRIGHT_MODULE||pathToFileURL(require.resolve('playwright')).href);
const {chromium}=playwright.default||playwright;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'china-frozen-city-ui-'));
const observed={expectedRub:1500123,expectedCity:'Новокузнецк',storedCity:'Москва',cases:[]};
let server,browser;
const next={name:'local-next-stubs',setup(builder){
  builder.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));
  builder.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'jsx',resolveDir:process.cwd(),
    contents:args.path.endsWith('navigation')
      ? "export const usePathname=()=>location.pathname;export const useRouter=()=>({back(){},replace(){},refresh(){},push(){}});export const useSearchParams=()=>new URLSearchParams(location.search);"
      : "import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children);}"
  }));
}};
try {
  await build({entryPoints:['tests/browser/china-frozen-city-fixture.tsx'],bundle:true,format:'iife',platform:'browser',
    jsx:'automatic',tsconfig:'apps/web/tsconfig.json',
    loader:{'.module.css':'local-css','.css':'empty'},plugins:[next],
    define:{'process.env.NODE_ENV':'"production"'},outfile:path.join(tmp,'fixture.js')});
  server=http.createServer((req,res)=>{
    const url=new URL(req.url||'/', 'http://localhost');
    if(url.pathname==='/'){
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end('<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }else if(url.pathname==='/fixture.js'){
      res.setHeader('content-type','application/javascript');res.end(fs.readFileSync(path.join(tmp,'fixture.js')));
    }else if(url.pathname==='/fixture.css'){
      res.setHeader('content-type','text/css');const file=path.join(tmp,'fixture.css');res.end(fs.existsSync(file)?fs.readFileSync(file):'');
    }else if(url.pathname==='/api/catalog/rates'){
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({rates:[{currency:'CNY',effectiveRate:18,rateDate:'2026-11-25',rateSource:'cbr'}]}));
    }else if(url.pathname.endsWith('/calculate')){
      res.setHeader('content-type','application/json');res.end(JSON.stringify({totalRub:9999999}));
    }else{
      res.statusCode=404;res.end('not found');
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU',serviceWorkers:'block'});
    const page=await context.newPage();
    const calculations=[],pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error)));
    page.on('request',request=>{if(request.url().endsWith('/calculate'))calculations.push(request.url());});
    await page.addInitScript(()=>{
      localStorage.setItem('avtocena_city','Москва');
      document.cookie='avtocena_city='+encodeURIComponent('Москва')+'; Path=/';
    });
    await page.goto(origin+'/?pinned=1&city='+encodeURIComponent('Новокузнецк'),{waitUntil:'load'});
    const price=page.locator('.ac-offer-price-panel .ac-price');
    await price.waitFor({state:'visible'});
    const displayed=Number((await price.innerText()).replace(/[^0-9]/g,''));
    assert.equal(displayed,observed.expectedRub,'visible frozen price must equal saved catalog price');
    const city=page.locator('button[aria-label^="Выбрать город. Сейчас:"]');
    await city.waitFor({state:'attached'});
    assert.match((await city.getAttribute('aria-label'))||'',/Новокузнецк/,'URL-selected city must win over stored Moscow');
    // React's first effect, browser storage change, focus and newly published FX
    // must not silently turn the immutable published offer into a live estimate.
    await page.evaluate(()=>{
      localStorage.setItem('avtocena_city','Москва');
      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(950);
    assert.equal(Number((await price.innerText()).replace(/[^0-9]/g,'')),observed.expectedRub,'rendered price changed after hydration');
    assert.match((await city.getAttribute('aria-label'))||'',/Новокузнецк/,'selected city changed after hydration');
    assert.deepEqual(calculations,[],'an ordinary card must not recalculate a frozen catalog price');
    assert.deepEqual(pageErrors,[],'page errors');
    observed.cases.push({width,cityPinned:true,savedPriceMatched:true,automaticCalculationRequests:0});
    await context.close();
  }
  console.log(JSON.stringify({kind:'china-pinned-city-local-browser',passed:true,...observed}));
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(tmp,{recursive:true,force:true});
}
