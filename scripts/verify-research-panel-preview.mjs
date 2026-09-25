import {createRequire} from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const requireTools=createRequire('/tmp/research-preview-tools/package.json');
const pw=requireTools('playwright');
const output='artifacts/research-split';fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync('docs/prototypes/research-split-view.html');
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
(async()=>{
const results=[];
for(const name of ['chromium','firefox','webkit']){
 let browser;
 try{
  browser=await pw[name].launch({headless:true,executablePath:pw[name].executablePath()});
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const messages=[];page.on('console',m=>{if(/frame|Content Security|ancestor/i.test(m.text()))messages.push(m.text());});
  await page.goto('http://127.0.0.1:8765/research-split-view.html');
  await page.getByRole('button',{name:'Уточнить характеристики с ИИ',exact:true}).click();
  const sep=page.getByRole('separator'),panel=page.locator('.ac-research-panel');
  await sep.waitFor();const initial=await panel.boundingBox();assert.equal(initial.width,420);
  assert.equal((await page.locator('.ac-research-page').boundingBox()).width,1013);
  const handle=await sep.boundingBox();await page.mouse.move(handle.x+3,handle.y+200);await page.mouse.down();await page.mouse.move(handle.x-140,handle.y+200,{steps:12});await page.mouse.up();
  const after=await panel.boundingBox();assert(after.width>=555&&after.width<=565);
  await sep.focus();await page.keyboard.press('ArrowRight');assert.equal(Number(await sep.getAttribute('aria-valuenow')),after.width-24);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1440);
  await page.reload();await page.getByRole('button',{name:'Уточнить характеристики с ИИ',exact:true}).click();assert.equal((await panel.boundingBox()).width,after.width-24);
  await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
  assert.equal(await page.getByRole('button',{name:'Уточнить характеристики с ИИ',exact:true}).evaluate(e=>e===document.activeElement),true);
  await page.getByRole('button',{name:'Уточнить характеристики с ИИ',exact:true}).click();
  await sep.focus();await page.keyboard.press('Home');assert.equal(Number(await sep.getAttribute('aria-valuenow')),320);
  await page.keyboard.press('End');assert.equal(Number(await sep.getAttribute('aria-valuenow')),720);
  await sep.dblclick();assert.equal(Number(await sep.getAttribute('aria-valuenow')),420);
  if(name==='chromium'){
   await page.screenshot({path:`${output}/desktop.png`});
   await page.getByRole('button',{name:'Проверить встраивание Алисы',exact:true}).click();
   await page.waitForTimeout(15000);
   fs.writeFileSync(`${output}/alice-frame-console.json`,JSON.stringify({messages,frames:page.frames().map(f=>f.url())},null,2));
   await page.screenshot({path:`${output}/alice-frame-result.png`});
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.equal((await panel.boundingBox()).width,390);assert.equal(await page.locator('.ac-research-page').isVisible(),false);
  await page.getByRole('button',{name:'Закрыть панель ИИ',exact:true}).click();assert.equal(await page.locator('.ac-research-page').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  if(name==='chromium')await page.screenshot({path:`${output}/mobile.png`});
  results.push({engine:name,layout:'passed',drag:'passed',keyboard:'passed',savedWidth:'passed',mobile:'passed',focus:'passed'});
 }catch(e){results.push({engine:name,error:e.message});}finally{await browser?.close();}
}
server.close();
console.log(JSON.stringify(results,null,2));fs.writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));
if(results.some(result=>result.error))process.exitCode=1;
})();
