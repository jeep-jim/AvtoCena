// Production Next.js layout with isolated, explicitly synthetic dealer data.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {defaultShowcase} from '../../apps/web/lib/dealers/showcase-model.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),dir=path.join(root,'apps/web/data'),out='artifacts/dealer-profile-production';
if(fs.existsSync(dir))throw Error('Refusing to overwrite existing web data');
fs.mkdirSync(out,{recursive:true});
const write=(p,v)=>{const f=path.join(dir,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v));};
const s=defaultShowcase('dealer_topavto');Object.assign(s,{profileEnabled:true,banner:'/dealers/topavto-banner-v3.webp',catalogMarkets:['japan','korea'],description:'Подбираем и доставляем автомобили. Поможем найти ваш автомобиль и рассчитать доставку.'});
s.offices=[{id:'office',city:'Новокузнецк',address:'ТРК Планета',phone:'',hours:'Ежедневно, 10:00–22:00',lat:null,lon:null,photos:[]}];
write('dealers/showcases/dealer_topavto.json',s);
const log=fs.openSync(path.join(out,'server.log'),'w');
const server=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p','3099'],{cwd:path.join(root,'apps/web'),env:{...process.env,JSON_STORAGE_DRIVER:'local'},stdio:['ignore',log,log]});
let browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:3099/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(theme=>{localStorage.setItem('avtocena_theme',theme);},theme);
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/api/catalog/search?**',r=>r.fulfill({json:{ok:true,total:0,items:[]}}));
  await page.goto('http://127.0.0.1:3099/nvkz/topavto');
  await page.locator('.dealer-profile').waitFor();await page.locator('.dealer-cover').evaluate(img=>img.decode());
  await page.locator('.dealer-stories img').first().evaluate(img=>img.decode());
  const consent=page.getByText('Только необходимые',{exact:true});if(await consent.isVisible())await consent.click();
  assert.equal(await page.locator('.ac-public-header').count(),1);
  assert.equal(await page.locator('.ac-public-footer-operator').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${out}/profile-${theme}-${width}.png`});
  assert.equal(await page.locator('.dealer-dock').isVisible(),width<768);
  assert.equal(await page.getByRole('link',{name:'Выйти на АвтоЦену'}).getAttribute('href'),'/cars');
  assert.ok(await page.locator('.dealer-shared-catalog .ac-catalog-filters').count() || await page.locator('.dealer-shared-catalog input').count());
  await page.getByRole('button',{name:'Информация о компании',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.screenshot({path:`${out}/office-${theme}-${width}.png`});await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  if(width>=768){
   const catalog=page.locator('.dealer-shared-catalog');
   await catalog.getByRole('button',{name:'Все рынки',exact:true}).click();
   const options=catalog.locator('.ac-filter-dropdown .ac-filter-option');
   assert.equal(await options.count(),3);assert.equal(await options.filter({hasText:'Китай'}).count(),0);
   await catalog.getByRole('button',{name:'Корея',exact:true}).click();
   await page.waitForURL(/market=korea/);
   assert.equal(new URL(page.url()).pathname,'/nvkz/topavto');
   assert.equal(await page.getByRole('link',{name:'Выйти на АвтоЦену'}).getAttribute('href'),'/cars');
  }
  await page.getByRole('button',{name:'О компании',exact:true}).click();await page.getByRole('heading',{name:'Направления доставки'}).waitFor();
  await page.locator('.dealer-profile-body').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/about-${theme}-${width}.png`});
  await page.locator('.ac-public-header .ac-catalog-nav:visible').click();await page.locator('.dealer-shared-catalog').waitFor({state:'visible'});
  assert.deepEqual(errors,[]);await page.close();console.log(`${width} ${theme}: real Next layout, shared header, private footer, modal and no overflow OK`);
 }
}finally{await browser?.close();server.kill('SIGTERM');fs.closeSync(log);fs.rmSync(dir,{recursive:true,force:true});}
