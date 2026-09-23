import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/owner-polish';fs.mkdirSync(out,{recursive:true});
let server,origin;
{
 await build({entryPoints:['tests/browser/owner-polish-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'next-fixture',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({contents:args.path.endsWith('navigation')?`export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>'/cars';export const useRouter=()=>({back(){},replace(){},refresh(){}});`:`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children);}`,loader:'jsx',resolveDir:process.cwd()}));}}],outfile:`${out}/fixture.js`,loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
 const layouts=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx','apps/web/app/(crm)/layout.tsx'];
 const sources=layouts.map(p=>({file:p,text:fs.readFileSync(p,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/home/CitySelector.tsx','apps/web/components/catalog/FavoriteToggle.tsx','apps/web/components/catalog/CatalogBrandMultiSelect.tsx','apps/web/components/catalog/OfferUpdatedStatus.tsx','apps/web/components/catalog/OfferContactActions.tsx','apps/web/components/catalog/ShareLinkButton.tsx','apps/web/components/crm/CrmPushControl.tsx','apps/web/components/catalog/InlineOfferParameters.tsx','apps/web/components/catalog/RecyclingPower.tsx','tests/browser/owner-polish-fixture.tsx','apps/web/components/crm/CrmLiveAlerts.tsx','apps/web/components/layout/PublicHeader.tsx','apps/web/components/catalog/OfferSpecificationsDisclosure.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
 fs.writeFileSync(`${out}/app.css`,css.css);
 const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
 server=http.createServer((req,res)=>{const name=(req.url||'/').split('?')[0];if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}let file=path.join(out,path.basename(name));if(!fs.existsSync(file)){const root=path.resolve('apps/web/public');file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
}
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const results=[];
async function checkActionGeometry(row){
 const geometry=await row.evaluate(e=>Array.from(e.querySelectorAll(':scope > button, [data-offer-pdf-slot] button')).map(b=>{
  const r=b.getBoundingClientRect(),icon=b.querySelector('svg')?.getBoundingClientRect(),label=b.querySelector(':scope > span:last-child');
  return {height:r.height,contact:b.classList.contains('ac-offer-contact-button'),font:label&&getComputedStyle(label).fontSize,iconLeft:icon&&icon.left-r.left,iconCenter:icon&&icon.top+icon.height/2-r.top,overflow:b.scrollWidth>b.clientWidth+1};
 }));
 for(const b of geometry){assert.equal(b.height,56,'uniform action height');assert.equal(b.overflow,false,'action content fits');if(b.contact){assert.equal(b.font,'16px','large labels in every layout');assert.ok(Math.abs(b.iconLeft-20)<1,'consistent icon inset');assert.ok(Math.abs(b.iconCenter-28)<1,'icon vertically centered');}}
}
try {
 for(const width of [320,390,1440]) for(const theme of ['light','dark']) for(const staff of [false,true]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/**',route=>{
   const url=route.request().url();
   const json=url.includes('/auth/me')?{user:staff?{id:'owner',role:'owner',displayName:'Owner',avatarUrl:'/logo/avtocena-mark-light.svg'}:null}:url.includes('brand-counts')?{counts:{Abarth:1,Acura:1},modelCounts:{Abarth:1,Acura:1}}:{ok:true,leads:[],pending:[],recent:[]};
   return route.fulfill({json});
  });
  try {
   await page.goto(origin+'/?theme='+theme+'&staff='+(staff?'1':'0'));
   assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).clipPath),'none','heading must not clip the first letters');
   const star=page.locator('.ac-offer-favorite:visible');await star.waitFor();
   assert.equal(await star.locator('svg').getAttribute('fill'),'none');
   await star.click();assert.equal(await star.locator('svg').getAttribute('fill'),'currentColor');
   assert.equal(await page.locator('.ac-favorite-nav svg').getAttribute('fill'),'currentColor');
   await star.click();assert.equal(await page.locator('.ac-favorite-nav svg').getAttribute('fill'),'none');
   const share=page.getByRole('button',{name:width<768?'Поделиться':'Поделиться ссылкой',exact:true});
   assert.ok(await share.locator('svg').isVisible(),'share icon remains visible on mobile');
   const a=await star.boundingBox(),b=await share.boundingBox();assert.ok(Math.abs(a.y-b.y)<3,'favorite beside share');
   if(staff){const pdf=page.getByRole('button',{name:'PDF текущей карточки'});await pdf.waitFor();const c=await pdf.boundingBox();assert.ok(Math.abs(c.y-a.y)<3&&c.x<a.x,'PDF before favorite');}
   assert.ok(await share.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'share label fits');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
   await checkActionGeometry(page.locator('.ac-offer-action-row:visible'));
   if(width>=1280){
    await page.locator('[data-spec-desktop]').evaluate(e=>e.dataset.open='true');
    const row=page.locator('.ac-offer-actions-sidebar');assert.ok(await row.isVisible());await checkActionGeometry(row);
    assert.ok(await row.locator('.ac-offer-contact-button').nth(1).evaluate(e=>e.scrollWidth<=e.clientWidth+1),'sidebar share fits');
    const left=await row.locator('.ac-offer-contact-button').nth(1).boundingBox(),right=await row.locator('.ac-offer-favorite').boundingBox();assert.ok(Math.abs(left.y-right.y)<3,'sidebar favorite beside share');
    await page.locator('[data-spec-desktop]').evaluate(e=>e.dataset.open='false');
   }
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.getByRole('button',{name:/Выбрать город. Сейчас:/}).click();const input=page.getByRole('textbox',{name:'Поиск города'});const hint=await input.evaluate(e=>({color:getComputedStyle(e,'::placeholder').color,fill:getComputedStyle(e,'::placeholder').webkitTextFillColor,text:getComputedStyle(e).color}));assert.equal(hint.fill,hint.color);assert.notEqual(hint.fill,hint.text,'placeholder is muted in both themes');await input.fill('Ново');
   const ink=await input.evaluate(e=>({fill:getComputedStyle(e).webkitTextFillColor,color:getComputedStyle(e).color}));assert.equal(ink.fill,ink.color);if(theme==='light')assert.notEqual(ink.fill,'rgb(255, 255, 255)');
   await page.getByRole('button',{name:'Закрыть выбор города'}).click();
   if(staff){
    const account=page.getByRole('button',{name:'Кабинет сотрудника'});assert.equal(await account.locator('img').count(),1);
    const trigger=width>=768?page.getByRole('button',{name:'Последние заявки',exact:true}):account;
    await trigger.click();assert.ok(await page.locator('.ac-staff-menu').isVisible());await trigger.click();assert.equal(await page.locator('.ac-staff-menu').isVisible(),false);
   }
   await page.getByRole('button',{name:'Выбрать марки автомобилей'}).click();const rows=page.locator('[data-facet-value]');await rows.first().waitFor();const r1=await rows.nth(0).boundingBox(),r2=await rows.nth(1).boundingBox();assert.ok(r2.y-r1.y-r1.height>=2,'brand spacing');
   assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${width}-${theme}-${staff?'staff':'guest'}.png`});results.push({width,theme,staff});
   if(staff){
    await page.goto(origin+'/?crm=1&staff=1&theme='+theme);
    const docs=page.getByRole('button',{name:'Документы',exact:true});await docs.waitFor();
    assert.equal(await docs.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(245, 158, 11)');
    const d=await docs.boundingBox(),tg=await page.getByRole('link',{name:'Telegram',exact:true}).boundingBox();assert.ok(d.x>tg.x&&Math.abs(d.y-tg.y)<1,'Documents follows Telegram');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'CRM fits viewport');
    await page.screenshot({path:`${out}/crm-${width}-${theme}.png`});
   }
  }catch(e){await page.screenshot({path:`${out}/failure-${width}-${theme}-${staff}.png`});throw e;}finally{await context.close();}
 }
 console.log(JSON.stringify({passed:true,cases:results.length}));
} finally {fs.writeFileSync(`${out}/results.json`,JSON.stringify(results));await browser.close();await new Promise(r=>server.close(r));}
