import {stage} from './errors.mjs';
import {chromium} from 'playwright';
const HOSTS=['yandex.ru','ya.ru','yandex.net','yastatic.net','yastat.net'];
export function allowedUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&HOSTS.some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}}
export async function openAlice(){
 const browser=await stage('launch',()=>chromium.launch({headless:true,chromiumSandbox:true,timeout:15000}));
 try {
 const context=await stage('context',()=>browser.newContext({viewport:{width:420,height:640},locale:'ru-RU',acceptDownloads:false,serviceWorkers:'block'}));
 await context.route('**/*',route=>allowedUrl(route.request().url())?route.continue():route.abort());
 const page=await context.newPage();page.on('popup',popup=>popup.close().catch(()=>{}));
 page.on('download',download=>download.cancel().catch(()=>{}));
 page.setDefaultTimeout(8000);
 async function check(){
  const text=await page.locator('body').innerText({timeout:3000});
  if(/showcaptcha|captcha|checkcaptcha/.test(new URL(page.url()).pathname)||/Подтвердите, что вы не робот|Verify you are human|Доступ ограничен|Доступ заблокирован/i.test(text))throw Error('provider_blocked');
 }
 async function send(text){
  if(typeof text!=='string'||!text.trim()||text.length>2500)throw Error('invalid_message');
  await stage('check',check);
  const input=page.getByRole('textbox',{name:'Спросите о чём угодно',exact:true});
  if(await input.count()!==1)throw Error('composer_missing');
  await stage('fill',()=>input.fill(text));
  await stage('submit',()=>page.getByRole('button',{name:'Отправить',exact:true}).click());
 }
 return {
  async start(prompt){
   await stage('navigate',()=>page.goto('https://alice.yandex.ru/',{waitUntil:'domcontentloaded',timeout:25000}));
   await stage('check',check);
   const essentials=page.getByRole('button',{name:'Allow essential cookies',exact:true});
   if(await essentials.isVisible())await essentials.click();
   await send(prompt);
  },send,
  async frame(){await stage('check',check);return page.screenshot({type:'jpeg',quality:65,timeout:5000});},
  async scroll(delta){if(!Number.isFinite(delta)||Math.abs(delta)>1000)throw Error('invalid_scroll');await page.mouse.move(210,320);await page.mouse.wheel(0,delta);},
  async close(){await browser.close();}
 };
 } catch(error) {await browser.close().catch(()=>{});throw error;}
}
