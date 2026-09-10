import {stage} from './errors.mjs';
import {initialSearchQuery,researchSearchUrl} from './search-query.mjs';
import {chromium} from 'playwright';
const HOSTS=['yandex.ru','ya.ru','yandex.net','yastatic.net','yastat.net'];
export function allowedUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&HOSTS.some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}}
export async function openAlice(){
 const browser=await stage('launch',()=>chromium.launch({headless:true,chromiumSandbox:true,timeout:15000}));
 try {
 const context=await stage('context',()=>browser.newContext({viewport:{width:420,height:640},isMobile:true,hasTouch:true,locale:'ru-RU',acceptDownloads:false,serviceWorkers:'block'}));
 await context.route('**/*',route=>allowedUrl(route.request().url())?route.continue():route.abort());
 const page=await context.newPage();page.on('popup',popup=>popup.close().catch(()=>{}));
 page.on('download',download=>download.cancel().catch(()=>{}));
 page.setDefaultTimeout(8000);
 async function check(){
  const text=await page.locator('body').innerText({timeout:3000});
  if(/showcaptcha|captcha|checkcaptcha/.test(new URL(page.url()).pathname)||/Подтвердите, что вы не робот|Verify you are human|Доступ ограничен|Доступ заблокирован/i.test(text))throw Error('provider_blocked');
 }
 let vehicleQuery='';
 async function navigate(query){
  const response=await stage('navigate',()=>page.goto(query,{waitUntil:'domcontentloaded',timeout:25000}));
  await stage('check',check);
  if(response && !response.ok())throw Error('provider_unavailable');
 }
 async function send(text){
  if(typeof text!=='string'||!text.trim()||text.length>2500)throw Error('invalid_message');
  await navigate(researchSearchUrl(vehicleQuery,text));
 }
 return {
  async start(prompt){
   vehicleQuery=initialSearchQuery(prompt);
   await navigate(researchSearchUrl(vehicleQuery));
  },send,
  async frame(){await stage('check',check);return page.screenshot({type:'jpeg',quality:65,timeout:5000});},
  async scroll(delta){if(!Number.isFinite(delta)||Math.abs(delta)>1000)throw Error('invalid_scroll');await page.mouse.move(210,320);await page.mouse.wheel(0,delta);},
  async close(){await browser.close();}
 };
 } catch(error) {await browser.close().catch(()=>{});throw error;}
}
