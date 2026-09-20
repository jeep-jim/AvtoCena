import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const live = process.env.LIVE_ORIGIN || '';
const out = `artifacts/attached-parameters-${live ? 'live' : 'local'}`;
fs.mkdirSync(out,{recursive:true});
let server, origin=live;
if(!live){
 await build({entryPoints:['tests/browser/attached-parameters-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
 const layouts=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx'];
 const sources=layouts.map(p=>({file:p,text:fs.readFileSync(p,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/catalog/InlineOfferParameters.tsx','apps/web/components/catalog/RecyclingPower.tsx','tests/browser/attached-parameters-fixture.tsx','apps/web/components/crm/CrmLiveAlerts.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
 fs.writeFileSync(`${out}/app.css`,css.css);
 const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
 server=http.createServer((req,res)=>{const name=(req.url||'/').split('?')[0];if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}let file=path.join(out,path.basename(name));if(!fs.existsSync(file)){const root=path.resolve('apps/web/public');file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
}
let pages=[['petrol','/?kind=petrol'],['hybrid','/?kind=hybrid'],['n1','/?kind=n1'],['missing-hybrid','/?kind=missing-hybrid']];
if(live){
 const response=await fetch(`${origin}/api/catalog/search?market=georgia&fuel=hybrid&pageSize=3`,{signal:AbortSignal.timeout(45000)});
 assert.ok(response.ok,'hybrid discovery must use actual public data');
 const data=await response.json();
 const hybrid=data.items?.find(o=>o.id);
 assert.ok(hybrid,'a real hybrid offer is required for verification');
 pages=[['petrol','/cars/offer/15691a619182935d97aa25c7'],['hybrid','/cars/offer/'+hybrid.id]];
 fs.writeFileSync(`${out}/live-pages.json`,JSON.stringify(pages,null,2));
}
const browser=process.env.PARAMETER_BROWSER==='webkit' ? await webkit.launch({headless:true}) : await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
function save(){fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));}
async function geometry(page,trigger,panel,grid){
 // Read all geometry in one frame: opening a mobile menu can adjust scroll position.
 const {g,t,b,spacing}=await trigger.evaluate(el=>{
  const editor=el.closest('[data-parameter-editor]'), tile=editor.parentElement;
  const rect=node=>node.getBoundingClientRect().toJSON();
  const t=rect(el),g=rect(tile.parentElement),b=rect(editor.querySelector('[data-parameter-panel]'));
  const pseudo=getComputedStyle(el,'::after');
  return {g,t,b,spacing:{rowGap:parseFloat(getComputedStyle(tile.parentElement).rowGap),editorBottom:rect(editor).bottom,tileBottom:rect(tile).bottom,bridgeTop:t.bottom-parseFloat(pseudo.bottom)-parseFloat(pseudo.height),bridgeBottom:t.bottom-parseFloat(pseudo.bottom)}};
 });
 assert.ok(g&&t&&b);
 assert.ok(Math.abs(b.x-g.x)<2&&Math.abs(b.width-g.width)<2,`must span exactly both columns ${JSON.stringify({g,t,b})}`);
 assert.ok(spacing.rowGap>0,'the original tile spacing must remain positive');
 const visibleTileBottom=Math.max(t.y+t.height,spacing.editorBottom);
 assert.ok(Math.abs(b.y-visibleTileBottom-spacing.rowGap)<1,`dropdown must leave the same gap after the visible tile edge, not touch its neighbour ${JSON.stringify({g,t,b,spacing,visibleTileBottom})}`);
 assert.ok(b.y-spacing.tileBottom>=spacing.rowGap-1,`dropdown must never overlap the grid tile ${JSON.stringify({g,t,b,spacing})}`);
 assert.ok(spacing.bridgeTop<=t.y+t.height+1&&spacing.bridgeBottom>=b.y,'only the active trigger must remain visually connected to its dropdown');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow');
 assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no panel horizontal overflow');
 return {width:b.width,height:b.height,anchorGap:b.y-t.y-t.height,tileGap:b.y-spacing.tileBottom,rowGap:spacing.rowGap};
}
try{
 for(const [kind,url] of pages){
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
  const page=await context.newPage();const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));
  if(live) await page.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  else await page.route('**/api/catalog/offer/qa-attached/calculate',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({json:{totalRub:4333490,customs:{vehicleCategory:kind==='n1'?'N1':'M1'},breakdown:[{id:'utilization-fee',title:'Утилизационный сбор',amountRub:900000}]}});});
  let theme='dark',width=390,index=-1;
  try{
   const response=await page.goto(origin+url,{waitUntil:'domcontentloaded',timeout:90000});assert.equal(response.status(),200);
   const grid=page.locator('[data-parameter-editor-grid]');await grid.waitFor({state:'visible',timeout:60000});
   await page.waitForFunction(()=>{const el=document.querySelector('[data-parameter-editor] > summary');return el&&Object.keys(el).some(k=>k.startsWith('__reactProps$'));});
   const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});
   if(await cookie.isVisible()) await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
   const triggers=grid.locator('[data-parameter-editor] > summary');
   for(theme of ['dark','light'])for(width of [320,360,390,414,768,1280]){
    await page.setViewportSize({width,height:900});await page.evaluate(v=>document.documentElement.dataset.theme=v,theme);await page.waitForTimeout(150);
    const original=await triggers.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y+scrollY,r.width,r.height].map(Math.round);}));
    const metrics=[];
    for(index=0;index<await triggers.count();index++){
     await page.keyboard.press('Escape');
     const trigger=triggers.nth(index);await trigger.click();
     const panel=grid.locator('[data-parameter-editor][open] > [data-parameter-panel]');await panel.waitFor({state:'visible'});
     assert.equal(await grid.locator('[data-parameter-editor][open]').count(),1);
     const box=await geometry(page,trigger,panel,grid);
     assert.deepEqual(await triggers.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y+scrollY,r.width,r.height].map(Math.round);})),original,'opening must not move closed controls');
     assert.equal(await panel.getByRole('button',{name:/^Закрыть:/}).count(),0,'no separate panel header');
     if(index===0){
      const control=panel.locator('[data-calculation-date-control]');
      const icon=control.locator('[data-calculation-calendar]');
      assert.equal(await icon.count(),1);assert.ok(await icon.isVisible(),'calendar visible in every viewport');
      const cb=await control.boundingBox(),ib=await icon.boundingBox();
      assert.ok(Math.abs(cb.x+cb.width-ib.x-ib.width-12)<1,'calendar keeps 12px right inset');
      assert.equal(await control.locator('input').evaluate(e=>getComputedStyle(e).backgroundImage),'none','date input must not inherit a select arrow');

      const fields=panel.locator('[data-parameter-date-fields] > label').filter({has:page.locator('select,input')});
      const positions=await fields.evaluateAll(els=>els.slice(0,3).map(e=>e.getBoundingClientRect()));
      assert.equal(positions.length,3);assert.ok(Math.max(...positions.map(p=>p.y))-Math.min(...positions.map(p=>p.y))<1,'date must have three columns');
      assert.ok(positions[0].x<positions[1].x&&positions[1].x<positions[2].x);
      assert.ok(box.height<=245,`compact date height: ${box.height}`);
      for(const el of await panel.locator('[data-parameter-date-fields] select,[data-parameter-date-fields] input').all())assert.ok(await el.evaluate(x=>{const a=x.getBoundingClientRect(),b=x.closest('[data-parameter-panel]').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right;}));
     }
     if(index===2){
      const buttons=panel.locator('[data-parameter-fuel-choices] > button');assert.equal(await buttons.count(),6);
      const boxes=await buttons.evaluateAll(els=>els.map(e=>e.getBoundingClientRect()));
      for(let row=0;row<3;row++){assert.ok(Math.abs(boxes[row*2].y-boxes[row*2+1].y)<1);assert.ok(boxes[row*2].x<boxes[row*2+1].x);}
      assert.ok(box.height<=275,`fuel must be 3 short rows, not a tall list: ${box.height}`);
      const body=panel.locator('.ac-attached-editor-body');
      assert.ok(await body.evaluate(el=>el.clientHeight>0 && getComputedStyle(el).overflowY==='auto'),'viewport-limited fuel menu must retain internal scrolling');
      if(await body.evaluate(el=>el.scrollHeight>el.clientHeight+1)){
       await body.hover();await page.mouse.wheel(0,300);await page.waitForTimeout(100);
       assert.ok(await body.evaluate(el=>el.scrollTop>0),'fuel choices remain reachable when viewport limits height');
       await body.evaluate(el=>el.scrollTop=0);
      }
     }
     if(width===390||width===1280){
      const r=await trigger.boundingBox();await page.evaluate(y=>scrollTo(0,Math.max(0,scrollY+y-145)),r.y);
      await page.screenshot({path:`${out}/${kind}-${theme}-${width}-${index}.png`});
     }
     metrics.push({index,...box});
     await trigger.click();assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0,'repeat click closes');
    }
    results.push({mode:live?'live':'fixture',kind,theme,width,attached:true,columns:true,panels:metrics,pageErrors:[...errors]});save();
   }
   if(!live&&kind==='petrol'){
    await triggers.nth(0).click();
    const date=grid.getByLabel('Дата таможенного расчёта',{exact:true});
    await date.fill('2026-09-24');await page.waitForTimeout(850);
    assert.equal(requests.at(-1)?.customsCalculationDate,'2026-09-24');
    assert.equal(requests.at(-1)?.year,'2026');
    assert.equal(requests.at(-1)?.powerKw,'118');
    await grid.getByRole('button',{name:'Считать таможню на сегодня',exact:true}).click();
    await page.waitForTimeout(100);
    assert.equal(await date.inputValue(),'');
    assert.equal(await page.getByRole('button',{name:'Вернуть исходные данные',exact:true}).count(),0,'return to today restores the initial scenario, including omitted optional fields');
    await page.keyboard.press('Escape');

    await triggers.nth(0).click();await grid.getByLabel('Год выпуска',{exact:true}).selectOption('2025');await page.waitForTimeout(850);assert.equal(requests.at(-1)?.powerKw,'118');
    await page.keyboard.press('Escape');await triggers.nth(3).click();await grid.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true}).fill('150');await page.waitForTimeout(850);assert.ok(Math.abs(Number(requests.at(-1)?.powerKw)-150*0.73549875)<1e-7);
    const hp=grid.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true});
    const kw=grid.getByRole('spinbutton',{name:'Мощность, кВт (если известна)',exact:true});
    await kw.fill('110');assert.ok(Math.abs(Number(await hp.inputValue())-110/0.73549875)<1e-7,'editing kW updates horsepower');
    await hp.fill('160');assert.ok(Math.abs(Number(await kw.inputValue())-160*0.73549875)<1e-7);
    await kw.fill('');assert.equal(await hp.inputValue(),'');
    await hp.fill('150');await hp.press('Enter');assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0,'Enter commits manual input and closes');
    await triggers.nth(3).click();if(await grid.getByRole('button',{name:'Выбрать: Мощность, л.с.',exact:true}).getAttribute('aria-expanded')==='false')await grid.getByRole('button',{name:'Выбрать: Мощность, л.с.',exact:true}).click();
    await grid.locator('[aria-label="Варианты: Мощность, л.с."]').getByRole('button',{name:'120',exact:true}).click();
    assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0,'preset closes the whole tile');
    await page.waitForTimeout(850);assert.equal(requests.at(-1)?.powerHp,'120');assert.ok(Math.abs(Number(requests.at(-1)?.powerKw)-120*0.73549875)<1e-7);
    await triggers.nth(2).click();await grid.getByRole('button',{name:'Дизель',exact:true}).click();
    assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0,'fuel choice closes tile');
    await triggers.nth(0).click();await grid.getByLabel('Месяц выпуска',{exact:true}).selectOption('3');
    assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0,'select closes tile');
    await page.setViewportSize({width:390,height:640});await triggers.nth(3).click();
    await page.waitForFunction(()=>document.documentElement.style.overflow!=='hidden' && document.body.style.overflow!=='hidden');
    const scrollBefore=await page.evaluate(()=>scrollY);await page.mouse.move(5,400);await page.mouse.wheel(0,400);await page.waitForTimeout(100);
    assert.ok(await page.evaluate(()=>scrollY)>scrollBefore,'page remains scrollable while mobile parameter panel is open');
    if(await grid.getByRole('button',{name:'Выбрать: Мощность, л.с.',exact:true}).getAttribute('aria-expanded')==='false')await grid.getByRole('button',{name:'Выбрать: Мощность, л.с.',exact:true}).click();
    const presets=grid.locator('[aria-label="Варианты: Мощность, л.с."]');
    await presets.hover();await page.mouse.wheel(0,200);await page.waitForTimeout(100);
    assert.ok(await presets.evaluate(el=>el.scrollTop>0),'long list scrolls inside the mobile menu');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.documentElement.style.overflow!=='hidden');
    assert.equal(await page.getByRole('button',{name:'Вернуть исходные данные',exact:true}).count(),0);assert.match(await triggers.nth(3).innerText(),/120 л.с./);assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0);
    await triggers.nth(2).click();await triggers.nth(3).click();assert.equal(await grid.locator('[data-parameter-editor][open]').count(),1,'same-row switching closes previous dropdown');
    await page.keyboard.press('Escape');await triggers.nth(0).click();await page.locator('[data-outside]').click();assert.equal(await grid.locator('[data-parameter-editor][open]').count(),0);
   }
   if(!live && kind==='hybrid'){
    await page.keyboard.press('Escape');await triggers.last().click();
    const motorKw=grid.getByRole('spinbutton',{name:'30-минутная мощность, кВт',exact:true});
    const motorHp=grid.getByRole('spinbutton',{name:'30-минутная мощность, л.с.',exact:true});
    const iceKw=grid.getByRole('spinbutton',{name:'Мощность ДВС, кВт',exact:true});
    const iceHp=grid.getByRole('spinbutton',{name:'Мощность ДВС, л.с.',exact:true});
    await motorKw.fill('10');assert.ok(Math.abs(Number(await motorHp.inputValue())-10/0.73549875)<1e-7);
    assert.equal(await iceKw.inputValue(),'100','electric motor input must not overwrite combustion power');
    await motorHp.fill('20');assert.ok(Math.abs(Number(await motorKw.inputValue())-20*0.73549875)<1e-7);
    await iceHp.fill('100');assert.ok(Math.abs(Number(await iceKw.inputValue())-100*0.73549875)<1e-7);
    await iceKw.fill('36');assert.ok(Math.abs(Number(await iceHp.inputValue())-36/0.73549875)<1e-7);
    await motorKw.fill('');assert.equal(await motorHp.inputValue(),'');assert.equal(await iceKw.inputValue(),'36');
    await grid.getByLabel('Тип гибрида для расчёта',{exact:true}).selectOption('series_hybrid');
    assert.equal(await grid.locator('[data-parameter-editor][open]').count(),1,'hybrid type selection keeps the related power inputs open');
    await page.keyboard.press('Escape');
   }
   if(!live && kind==='missing-hybrid'){
    await page.keyboard.press('Escape');await triggers.nth(0).click();
    const date=grid.getByLabel('Дата таможенного расчёта',{exact:true});
    assert.equal(await date.inputValue(),'');
    assert.ok(await grid.locator('[data-calculation-date-control]').getByText('Сегодня',{exact:true}).isVisible());
    await date.fill('2026-09-24');await page.waitForTimeout(750);
    assert.equal(await grid.getByLabel('Год выпуска',{exact:true}).inputValue(),'2026','calculation date cannot overwrite production year');
    assert.equal(requests.length,0,'missing power must not produce a guessed quote');
    assert.ok(await page.locator('.ac-offer-price-panel').getByText('Цена продавца',{exact:true}).isVisible(),'seller price must remain labelled and visible');
    assert.match(await page.locator('[data-parameter-calculation-status]').innerText(),/Мощность/);
    assert.equal(await date.inputValue(),'2026-09-24','date is saved even though the quote is blocked by power');
    await grid.getByRole('button',{name:'Считать таможню на сегодня',exact:true}).click();
    assert.equal(await date.inputValue(),'','today clears the override, not fixes a stale date');
    await page.keyboard.press('Escape');await triggers.nth(3).click();
    await grid.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true}).fill('150');await page.waitForTimeout(850);
    assert.equal(requests.at(-1)?.customsCalculationDate,'');
    assert.ok(await page.getByText('Стоимость под ключ',{exact:true}).isVisible());
    assert.equal(await page.getByRole('button',{name:'Вернуть исходные данные',exact:true}).count(),0);
    await grid.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true}).fill('');await page.waitForTimeout(100);
    assert.ok(await page.locator('.ac-offer-price-panel').getByText('Цена продавца',{exact:true}).isVisible());
   }
   if(!live)assert.deepEqual(errors,[]);
  }catch(error){fs.writeFileSync(`${out}/failure.json`,JSON.stringify({kind,url,theme,width,index,error:String(error),pageErrors:errors},null,2));await page.screenshot({path:`${out}/failure.png`,fullPage:true});throw error;}finally{await context.close();}
 }
 if(!live){
  for(const kind of ['saved-admin','saved-guest']){
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.addInitScript(()=>localStorage.setItem('avtocena_city','Москва'));
   let calculations=0,saves=0;
   await page.route('**/api/catalog/offer/qa-attached/calculate',async route=>{calculations++;await route.fulfill({json:{totalRub:2600000,breakdown:[{id:'car',amountRub:2000000}]}});});
   await page.route('**/api/catalog/offer/qa-attached/save',async route=>{saves++;const body=route.request().postDataJSON();assert.equal(body.version,'v1');assert.equal(body.draft.powerHp,'150');await route.fulfill({json:{version:'v2',savedAt:'2026-09-20T11:00:00Z',draft:body.draft,calculation:{totalRub:2600000}}});});
   await page.goto(origin+'/?kind='+kind);await page.waitForTimeout(850);
   assert.equal(calculations,0,'saved quote must not recalculate on open');
   assert.ok(await page.getByRole('button',{name:'Выбрать город. Сейчас: Новокузнецк'}).isVisible(),'saved delivery overrides browser city');
   assert.match(await page.locator('.ac-price').first().innerText(),/2[\s\u00a0]500[\s\u00a0]000/);
   await page.getByText('Структура цены',{exact:true}).first().click();
   assert.ok(await page.getByText('Обеспечительный платёж',{exact:true}).isVisible());
   const power=page.locator('[data-parameter-editor] > summary').nth(3);await power.click();
   await page.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true}).fill('150');await page.keyboard.press('Escape');await page.waitForTimeout(850);
   const button=page.getByRole('button',{name:'Сохранить расчёт для клиента'});
   if(kind==='saved-admin'){await button.click();await page.getByText('Сохранено. Можно отправить клиенту ссылку.').waitFor();assert.equal(saves,1);assert.equal(await button.count(),0);}
   else {assert.equal(await button.count(),0);assert.equal(saves,0);}
   await page.screenshot({path:`${out}/${kind}.png`,fullPage:true});await page.close();
  }
  const page=await browser.newPage();
  await page.addInitScript(()=>{localStorage.setItem('avtocena_crm_notifications_enabled','1');window.__beeps=0;window.AudioContext=class{state='running';currentTime=0;destination={};resume(){return Promise.resolve();}createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(){window.__beeps++;},stop(){}};}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}};});
  await page.route('**/api/crm/inbox',route=>route.fulfill({json:{newCount:1,leads:[{id:'new-1',status:'new',createdAt:'2026-09-20T12:00:00Z'}]}}));
  await page.goto(origin+'/?kind=alerts');await page.getByText('Новые заявки: 1').waitFor();
  await page.locator('body').click({position:{x:5,y:5}});await page.waitForTimeout(2400);
  assert.ok(await page.evaluate(()=>window.__beeps)>=2,'sound repeats while unacknowledged');
  await page.getByRole('button',{name:'Прочитано',exact:true}).click();const stopped=await page.evaluate(()=>window.__beeps);await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__beeps),stopped);
  await page.reload();await page.waitForTimeout(300);assert.equal(await page.getByText('Новые заявки: 1').count(),0);assert.equal(await page.getByRole('button',{name:/Заявки/}).getAttribute('aria-pressed'),'true','enabled preference survives reload');await page.close();
 }
 assert.equal(results.length,pages.length*12);console.log(JSON.stringify({mode:live?'live':'fixture',cases:results.length,openings:results.reduce((n,r)=>n+r.panels.length,0),passed:true}));
}finally{save();await browser.close();if(server)await new Promise(r=>server.close(r));}
