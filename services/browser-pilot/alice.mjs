import {stage} from './errors.mjs';
import {initialSearchQuery,researchSearchUrl} from './search-query.mjs';
import {chromium} from 'playwright';
import {pageKind,replayPointer,VIEWPORT} from './controls.mjs';
const HOSTS=['yandex.ru','ya.ru','yandex.net','yastatic.net','yastat.net'];
export function allowedUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&HOSTS.some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}}
export async function openAlice(){
 const browser=await stage('launch',()=>chromium.launch({headless:true,chromiumSandbox:true,timeout:15000}));
 try {
 const context=await stage('context',()=>browser.newContext({viewport:VIEWPORT,isMobile:true,hasTouch:true,locale:'ru-RU',acceptDownloads:false,serviceWorkers:'block'}));
 await context.route('**/*',route=>allowedUrl(route.request().url())?route.continue():route.abort());
 const page=await context.newPage();page.on('popup',popup=>popup.close().catch(()=>{}));
 page.on('download',download=>download.cancel().catch(()=>{}));
 page.setDefaultTimeout(8000);
 let view='page';
 async function check(){
  if(!allowedUrl(page.url()))throw Error('provider_unavailable');
  const text=await page.locator('body').innerText({timeout:3000});
  view=pageKind(page.url(),text);
  if(view==='blocked')throw Error('provider_blocked');
  // A human may complete a challenge using the displayed page. Never solve or dismiss it automatically.
 }
 async function input(text,submit){
  if(typeof text!=='string'||!text.trim()||text.length>2500||typeof submit!=='boolean')throw Error('invalid_message');
  for(const frame of page.frames()){
   if(!allowedUrl(frame.url()))continue;
   const field=frame.locator('input:focus, textarea:focus, [contenteditable="true"]:focus').first();
   if(!await field.count())continue;
   const type=await field.getAttribute('type');
   if(type==='password')throw Error('sensitive_input');
   if(!await field.isEditable())continue;
   await field.fill(text,{timeout:3000});
   if(submit)await field.press('Enter',{timeout:3000});
   return;
  }
  throw Error('input_not_focused');
 }
 let vehicleQuery='';
 async function navigate(query){
  const response=await stage('navigate',()=>page.goto(query,{waitUntil:'domcontentloaded',timeout:25000}));
  await stage('check',check);
  if(response && !response.ok() && view!=='challenge')throw Error('provider_unavailable');
 }
 async function send(text){
  if(typeof text!=='string'||!text.trim()||text.length>2500)throw Error('invalid_message');
  await navigate(researchSearchUrl(vehicleQuery,text));
 }
 return {
  async start(prompt){
   vehicleQuery=initialSearchQuery(prompt);
   await navigate(researchSearchUrl(vehicleQuery));
  },send,input,
  info(){return {view};},
  async interact(points){await replayPointer(page,points);},
  async frame(){await stage('check',check);return page.screenshot({type:'jpeg',quality:65,timeout:5000});},
  async scroll(delta){if(!Number.isFinite(delta)||Math.abs(delta)>1000)throw Error('invalid_scroll');await page.mouse.move(210,320);await page.mouse.wheel(0,delta);},
  async close(){await browser.close();}
 };
 } catch(error) {await browser.close().catch(()=>{});throw error;}
}
