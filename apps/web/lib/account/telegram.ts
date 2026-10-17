import {randomBytes} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
import {accountPath,hash,normalizeAccountPhone,type CustomerAccount} from './auth';
import {issueTemporaryPassword} from './temporary-password';
const PATH='accounts/telegram-challenges.json';
type Challenge={hash:string;accountId:string;kind:'bind'|'reset';expires:number;version?:number;email?:string;telegramId?:string;approved?:boolean;used?:boolean};
const active=(rows:Challenge[])=>rows.filter(r=>r.expires>Date.now()&&!r.used).slice(-499);
export async function createCustomerChallenge(account:CustomerAccount|null,kind:'bind'|'reset',email?:string){
 const token=randomBytes(24).toString('hex');
 if(account&&!account.disabled)await mutateDataJson<Challenge[]>(PATH,[],rows=>[...active(rows),{hash:hash(token),accountId:account.id,kind,version:account.sessionVersion,email,expires:Date.now()+600000}]);
 return token;
}
// Kept for old browser tabs: only fresh, phone-verified challenges may be consumed.
export async function approvedCustomerChallenge(token:string){if(!/^[a-f0-9]{48}$/.test(token))throw Error('Ссылка недействительна.');const c=active(await readDataJson<Challenge[]>(PATH,[])).find(r=>r.hash===hash(token)&&r.kind==='reset'&&r.approved&&r.email&&r.version!==undefined);if(!c)throw Error('Сначала подтвердите номер в Telegram.');return c;}
export async function consumeCustomerChallenge(token:string,kind:'bind'|'reset'){if(!/^[a-f0-9]{48}$/.test(token))throw Error('Подтверждение недействительно.');let result:Challenge|undefined;
 await mutateDataJson<Challenge[]>(PATH,[],rows=>{result=undefined;return active(rows).map(r=>{if(r.hash===hash(token)&&r.kind===kind&&r.approved){result=r;return {...r,used:true};}return r;});});
 if(!result)throw Error('Подтвердите свой телефон в Telegram. Ссылка действует 10 минут.');return result;
}
async function send(token:string,chat:string,text:string,reply_markup?:unknown){const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,reply_markup}),signal:AbortSignal.timeout(8000)});const p=await r.json();if(!r.ok||!p.ok)throw Error('telegram_delivery_failed');}
export async function handleCustomerAccountBot(update:any,token:string){
 const callback=update?.callback_query;
 const phoneButton=String(callback?.data||'').match(/^account:phone:([a-f0-9]{40})$/);
 const m=phoneButton?callback.message:update?.message,from=phoneButton?callback.from:m?.from;
 if(m?.chat?.type!=='private'||String(m.chat.id)!==String(from?.id))return false;
 const chat=String(from.id),start=String(m?.text||'').match(/^\/start(?:@\w+)?\s+account_([a-f0-9]{48})$/);
 if(!start&&!m?.contact&&!phoneButton)return false;
 const rows=active(await readDataJson<Challenge[]>(PATH,[]));
 if(phoneButton){
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:callback.id}),signal:AbortSignal.timeout(3000)}).catch(()=>{});
  const c=rows.filter(r=>r.telegramId===chat).at(-1);
  if(!c||!c.hash.startsWith(phoneButton[1])){await send(token,chat,'Ссылка недействительна или истекла. Начните снова на avtocena.com.');return true;}
  await send(token,chat,'Нажмите «Подтвердить мой телефон» на клавиатуре под полем сообщения и разрешите отправить свой контакт. Если кнопка скрыта, откройте клавиатуру бота значком рядом с полем сообщения. Вводить номер вручную не нужно.',{keyboard:[[{text:'Подтвердить мой телефон',request_contact:true}]],resize_keyboard:true,is_persistent:true,one_time_keyboard:false,input_field_placeholder:'Нажмите «Подтвердить мой телефон»'});
  return true;
 }
 if(start){const c=rows.find(r=>r.hash===hash(start[1]));if(!c){await send(token,chat,'Ссылка недействительна или истекла. Начните восстановление снова на avtocena.com.');return true;}
 const a=await readDataJson<CustomerAccount|null>(accountPath(c.accountId),null);
 if(!a||a.disabled||c.version===undefined){await send(token,chat,'Начните восстановление снова на avtocena.com.');return true;}
 let claimed=false;await mutateDataJson<Challenge[]>(PATH,[],stored=>{claimed=false;return active(stored).map(r=>{if(r.hash!==c.hash||r.telegramId&&r.telegramId!==chat)return r;claimed=true;return {...r,telegramId:chat};});});
 if(!claimed){await send(token,chat,'Начните восстановление снова на avtocena.com.');return true;}
 await send(token,chat,c.kind==='reset'?`Чтобы получить временный пароль АвтоЦены${c.email?' на почту '+c.email:' в этом чате'}, нажмите «Подтвердить мой телефон» под этим сообщением. Затем Telegram покажет кнопку отправки вашего контакта. Номер должен совпадать с номером регистрации. Продолжайте, только если вы сами начали восстановление${c.email?' и указали именно эту почту':''}.`:'Чтобы подключить Telegram, нажмите «Подтвердить мой телефон» под этим сообщением. Затем отправьте свой контакт кнопкой Telegram. Номер должен совпадать с номером регистрации.',{inline_keyboard:[[{text:'Подтвердить мой телефон',callback_data:'account:phone:'+c.hash.slice(0,40)}]]});return true;}
 const c=rows.filter(r=>r.telegramId===chat).at(-1);if(!c)return false;
 if(String(m.contact.user_id)!==chat){await send(token,chat,'Нужен ваш собственный контакт, отправленный кнопкой «Подтвердить мой телефон».');return true;}
 const a=await readDataJson<CustomerAccount|null>(accountPath(c.accountId),null);let matches=false;try{matches=!!a&&!a.disabled&&normalizeAccountPhone(m.contact.phone_number)===a.phone;}catch{}
 if(!a||!matches){await send(token,chat,'Телефон Telegram не совпадает с номером регистрации. Если номер изменился, обратитесь в поддержку АвтоЦены.');return true;}
 if(c.kind==='reset'){
  if(c.version===undefined){await send(token,chat,'Начните восстановление снова на сайте.');return true;}
  if(c.email){await mutateDataJson<Challenge[]>(PATH,[],stored=>active(stored).map(r=>r.hash===c.hash?{...r,approved:true}:r));await send(token,chat,'Номер подтверждён. Вернитесь на сайт и нажмите «Отправить пароль на почту». Привязка Telegram или почты не создавалась.',{remove_keyboard:true});return true;}
  let credential;try{credential=await issueTemporaryPassword(a.id,c.version,c.hash);}catch(e){await send(token,chat,e instanceof Error?e.message:'Начните восстановление снова.');return true;}
  await send(token,chat,`Временный пароль АвтоЦены: ${credential.password}\n\nВойдите на https://avtocena.com/account с номером регистрации. Пароль действует 10 минут и подходит для одного входа. Затем откройте «Ваш профиль» → «Изменить пароль». Никому не пересылайте пароль.`,{remove_keyboard:true});
  await mutateDataJson<Challenge[]>(PATH,[],stored=>active(stored).filter(r=>r.hash!==c.hash));return true;
 }
 await mutateDataJson<CustomerAccount|null>(accountPath(a.id),null,current=>{if(!current||current.disabled||current.phone!==a.phone||current.sessionVersion!==c.version)throw Error('account_changed');return {...current,telegramId:chat,phoneVerifiedAt:new Date().toISOString()};});
 await send(token,chat,'Telegram подключён.',{remove_keyboard:true});await mutateDataJson<Challenge[]>(PATH,[],stored=>active(stored).filter(r=>r.hash!==c.hash));return true;
}
