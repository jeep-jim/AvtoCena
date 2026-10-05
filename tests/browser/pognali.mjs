import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/pognali';fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PognaliArena} from './apps/web/components/crm/PognaliArena';createRoot(document.getElementById('root')).render(<PognaliArena user={{name:'Ян'}} userId="fixture"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',jsx:'automatic',outfile:out+'/fixture.js',define:{'process.env.NODE_ENV':'"production"'},tsconfig:'apps/web/tsconfig.json'});
let runs=0,finishes=0,ratingRequests=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://'+req.headers.host);
 if(url.pathname==='/api/account/game'){
  res.setHeader('Content-Type','application/json');let input={};if(req.method==='POST'){const b=[];for await(const c of req)b.push(c);input=JSON.parse(Buffer.concat(b));}
  if(input.action==='start'){assert.ok(['hills','battle'].includes(input.mode));runs++;return res.end(JSON.stringify({run:{id:'run-'+runs,mode:input.mode}}));}
  if(input.action==='finish'){finishes++;return res.end(JSON.stringify({result:{score:123}}));}
  if(ratingRequests++===0)return res.end('{}');
  return res.end(JSON.stringify({playerId:'fixture',team:[{id:'fixture',name:'Ян',best:{hills:{score:123}}},{id:'other',name:'Антон',best:{battle:{score:456}}}]}));
 }
 if(url.pathname==='/games/pognali.html'){res.setHeader('Content-Type','text/html');return res.end(fs.readFileSync('apps/web/public/games/pognali.html'));}
 if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(out+'/fixture.js'));}
 res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#1a2029;color:#fff;font:16px Arial;--ac-surface:#222b38;--ac-surface-2:#2b3544;--ac-border:#465167;--ac-text:#fff;--ac-muted:#b9c5d9}h2,p{margin:0}button{cursor:pointer}#root{padding:16px;max-width:1000px;margin:auto}${fs.readFileSync(out+'/fixture.css','utf8')}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const [width,height] of [[390,844],[320,640],[1280,800]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<600,isMobile:width<600}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  if(width===390){await page.getByRole('status').filter({hasText:'Не удалось загрузить рейтинг'}).waitFor();await page.getByRole('button',{name:'Обновить',exact:true}).click();}
  await page.getByRole('heading',{name:'🏆 Общий рейтинг'}).waitFor();assert.equal(await page.getByRole('button',{name:'Кольцо',exact:true}).count(),0);
  await page.getByRole('button',{name:'Погнали!',exact:true}).click();const frame=page.frameLocator('iframe');await frame.locator('#btnStart').waitFor();
  assert.ok(await frame.locator('#scrMenu .panel').evaluate(e=>e.scrollHeight<=e.clientHeight+1));
  assert.ok(await frame.locator('#btnStart').evaluate(e=>{const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;}));
  for(const id of ['themeList','carList','weaponList','colorList'])assert.ok(await frame.locator('#'+id).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
  await page.screenshot({path:out+'/menu-'+width+'.png'});
  await frame.getByRole('button',{name:'🚀 Бой',exact:true}).click();await frame.locator('#btnStart').click();await frame.locator('#hud.on').waitFor();await frame.locator('#btnGas').dispatchEvent('pointerdown',{pointerId:1});await page.waitForTimeout(2500);await frame.locator('#btnGas').dispatchEvent('pointerup',{pointerId:1});
  assert.equal(await frame.locator('#rivalRadar span').count(),4);await page.screenshot({path:out+'/race-'+width+'.png'});
  await frame.locator('#btnPause').click();await frame.locator('#pauseOverlay').waitFor();await frame.locator('#btnResume').click();await frame.locator('#btnQuit').click();await frame.locator('#resultNotice').filter({hasText:'В рейтинг'}).waitFor();
  await page.screenshot({path:out+'/result-'+width+'.png'});await frame.locator('#btnExit').click();await page.getByRole('button',{name:'Погнали!',exact:true}).waitFor();assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal(runs,3);assert.equal(finishes,3);console.log('PASS: 320/390/1280, one-screen menu, battle with four visible rivals, pause, finish/save, exit; no production writes');
}finally{await browser.close();await new Promise(r=>server.close(r));}
