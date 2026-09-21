import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='artifacts/crm-mobile';fs.mkdirSync(out,{recursive:true});
const mock=path.resolve('tests/browser/crm-mobile-mocks.ts');
await build({entryPoints:['tests/browser/crm-mobile-fixture.tsx'],bundle:true,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',outfile:out+'/fixture.js',loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-services',setup(b){
 b.onResolve({filter:/^@\/lib\/(auth|data|crm-users|business-settings|avtocena|effective-market-settings|crm-notifications|crm-read-state|catalog\/customs-pricing|catalog\/estimated-market-config)$/},()=>({path:mock}));
 b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-test'}));
 b.onLoad({filter:/.*/,namespace:'next-test'},args=>({contents:args.path.endsWith('navigation')?`export const redirect=()=>{throw Error('redirect')};export const usePathname=()=>'/crm';export const useRouter=()=>({refresh(){},push(){}});`:`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children);}`,loader:'jsx',resolveDir:process.cwd()}));
}}]});
const layouts=['apps/web/app/layout.tsx','apps/web/app/(crm)/layout.tsx'];
const sources=layouts.map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
const inline=sources.flatMap(({text})=>[...text.matchAll(/const publicUiCorrections = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
const css=await postcss([tailwindcss({content:['apps/web/components/crm/**/*.{tsx,ts}','apps/web/app/(crm)/**/*.tsx','apps/web/components/leads/PhoneInput.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
fs.writeFileSync(out+'/app.css',css.css);
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark';localStorage.setItem('avtocena_theme',document.documentElement.dataset.theme)</script><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server=http.createServer((req,res)=>{const name=(req.url||'/').split('?')[0];if(name==='/'){res.setHeader('content-type','text/html');res.end(html);return;}let file=path.join(out,path.basename(name));if(!fs.existsSync(file)){const root=path.resolve('apps/web/public');file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('content-type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[],failures=[];
try{
 for(const theme of ['dark','light'])for(const width of [320,390,768,1440])for(const kind of ['overview','leads','team','settings','clients']){
  const page=await browser.newPage({viewport:{width,height:850}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/**',r=>r.fulfill({json:{ok:true,leads:[],readReceipts:[],state:{eventKey:'test'}}}));
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}/?kind=${kind}&theme=${theme}`);
   await page.locator('.crm-content').waitFor();
   assert.equal(await page.locator('.crm-header .ac-staff-leads').count(),0,'no duplicated requests shortcut');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow');
   if(width<=390)assert.ok(await page.locator('.crm-header').evaluate(e=>e.getBoundingClientRect().height)<155,'compact header');
   await page.getByRole('button',{name:'Кабинет сотрудника'}).click();
   assert.ok(await page.getByRole('link',{name:'Мой профиль',exact:true}).isVisible());
   assert.equal(await page.locator('.ac-staff-menu a[href="/crm/leads"]').count(),0);
   await page.keyboard.press('Escape');assert.equal(await page.locator('.ac-staff-menu').count(),0);
   if(kind==='overview'&&width<=390){const boxes=await page.locator('.crm-metrics>div').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));assert.equal(boxes[0].y,boxes[1].y);assert.ok(boxes[2].y>boxes[0].y);}
   if(kind==='leads'){
    if(width<=390)assert.ok(await page.locator('.crm-lead-summary').first().evaluate(e=>e.getBoundingClientRect().height)<165,'lead summary is compact');
    await page.locator('.crm-lead-summary').first().click();assert.ok(await page.getByRole('combobox',{name:'Статус заявки',exact:true}).first().isVisible());
   }
   if(kind==='settings'){
    assert.equal(await page.locator('.crm-calculator-disclosure').getAttribute('open'),null);
    await page.locator('.crm-calculator-disclosure>summary').click();
    assert.equal(await page.locator('select[name="calcPowertrain"]').isVisible(),true);
    const fields=await page.locator('.crm-calculation-fields>label').evaluateAll(els=>els.slice(0,2).map(e=>e.getBoundingClientRect().toJSON()));assert.equal(fields[0].y,fields[1].y);
    assert.equal(await page.locator('form[action="/api/crm/settings/markets"]').count(),6,'all six market forms retained');
   }
   if(kind==='clients'){await page.locator('.crm-calculator-disclosure>summary').click();assert.ok(await page.getByPlaceholder('ФИО клиента').isVisible());}
   for(const select of await page.locator('select:visible').all()){assert.equal(await select.evaluate(e=>getComputedStyle(e).backgroundPosition),'right 16px center');assert.ok(await select.evaluate(e=>parseFloat(getComputedStyle(e).paddingRight)>=40));}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow after disclosure');
   if(width===390||width===1440)await page.screenshot({path:`${out}/${kind}-${theme}-${width}.png`,fullPage:false});
   await page.mouse.move(width-4,400);await page.mouse.wheel(0,500);await page.waitForTimeout(150);
   assert.ok(await page.locator('.crm-header').evaluate(e=>Math.abs(e.getBoundingClientRect().top)<1),'header remains at top');
   assert.deepEqual(errors,[]);results.push({kind,width,theme,passed:true});
  }catch(e){fs.writeFileSync(`${out}/failure-${kind}-${theme}-${width}.json`,JSON.stringify({kind,width,theme,error:String(e),errors},null,2));await page.screenshot({path:`${out}/failure-${kind}-${theme}-${width}.png`,fullPage:true}).catch(()=>{});failures.push({kind,width,theme,error:String(e),errors});}finally{await page.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify({results,failures},null,2));assert.deepEqual(failures,[]);console.log(JSON.stringify({cases:results.length,passed:true}));
}finally{await browser.close();server.close();}
