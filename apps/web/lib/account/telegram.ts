import {randomBytes} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
import {accountPath,hash,normalizeAccountPhone,type CustomerAccount} from './auth';
const PATH='accounts/telegram-challenges.json';
type Challenge={hash:string;accountId:string;kind:'bind'|'reset';expires:number;telegramId?:string;approved?:boolean;used?:boolean};
const active=(rows:Challenge[])=>rows.filter(r=>r.expires>Date.now()&&!r.used).slice(-499);
export async function createCustomerChallenge(account:CustomerAccount|null,kind:'bind'|'reset'){
 const token=randomBytes(24).toString('hex');
 if(account&&!account.disabled&&(kind==='bind'||account.telegramId))await mutateDataJson<Challenge[]>(PATH,[],rows=>[...active(rows),{hash:hash(token),accountId:account.id,kind,expires:Date.now()+600000,telegramId:kind==='reset'?account.telegramId:undefined}]);
 return token;
}
export async function consumeCustomerChallenge(token:string,kind:'bind'|'reset'){if(!/^[a-f0-9]{48}$/.test(token))throw Error('Подтверждение недействительно.');let result:Challenge|undefined;
 await mutateDataJson<Challenge[]>(PATH,[],rows=>{result=undefined;return active(rows).map(r=>{if(r.hash===hash(token)&&r.kind===kind&&r.approved){result=r;return {...r,used:true};}return r;});});
 if(!result)throw Error('Подтвердите действие в Telegram. Ссылка действует 10 минут.');return result;
}
async function send(token:string,chat:string,text:string,reply_markup?:unknown){const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,reply_markup}),signal:AbortSignal.timeout(8000)});const p=await r.json();if(!r.ok||!p.ok)throw Error('telegram_delivery_failed');}
export async function handleCustomerAccountBot(update:any,token:string){const cb=update?.callback_query,m=cb?.message||update?.message,from=cb?.from||m?.from;if(m?.chat?.type!=='private'||String(m.chat.id)!==String(from?.id))return false;
 const chat=String(from.id);const start=String(m?.text||'').match(/^\/start(?:@\w+)?\s+account_([a-f0-9]{48})$/);const callback=String(cb?.data||'').match(/^account_ok:([a-f0-9]{32})$/);
 if(!start&&!callback&&!m?.contact)return false;
 const rows=active(await readDataJson<Challenge[]>(PATH,[]));
 if(start){const challenge=rows.find(r=>r.hash===hash(start[1]));if(!challenge){await send(token,chat,'Ссылка недействительна или истекла. Откройте новую ссылку из кабинета АвтоЦены.');return true;}
 const a=await readDataJson<CustomerAccount|null>(accountPath(challenge.accountId),null);
 if(!a||a.disabled||challenge.kind==='reset'&&a.telegramId!==chat){await send(token,chat,'Подтверждение недоступно. Используйте Telegram, подключённый в вашем кабинете.');return true;}
 if(challenge.kind==='reset'){await send(token,chat,'Подтвердить смену пароля кабинета АвтоЦены? Нажимайте только если вы сами начали восстановление на avtocena.com.',{inline_keyboard:[[{text:'Подтвердить восстановление',callback_data:'account_ok:'+challenge.hash.slice(0,32)}]]});}
 else{await mutateDataJson<Challenge[]>(PATH,[],stored=>active(stored).map(r=>r.hash===challenge.hash?{...r,telegramId:chat}:r));await send(token,chat,'Чтобы подключить восстановление доступа, подтвердите свой телефон кнопкой ниже.',{keyboard:[[{text:'Подтвердить мой телефон',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true});}return true;}
 if(callback){const c=rows.find(r=>r.hash.startsWith(callback[1])&&r.telegramId===chat&&r.kind==='reset');if(!c)return true;await mutateDataJson<Challenge[]>(PATH,[],stored=>active(stored).map(r=>r.hash===c.hash?{...r,approved:true}:r));await send(token,chat,'Подтверждено. Вернитесь на сайт и задайте новый пароль.');return true;}
 if(m?.contact){const c=rows.filter(r=>r.kind==='bind'&&r.telegramId===chat).at(-1);if(!c)return false;if(String(m.contact.user_id)!==chat){await send(token,chat,'Нужен ваш собственный контакт, отправленный кнопкой.');return true;}
 const a=await readDataJson<CustomerAccount|null>(accountPath(c.accountId),null);if(!a||normalizeAccountPhone(m.contact.phone_number)!==a.phone){await send(token,chat,'Телефон Telegram не совпадает с телефоном кабинета.');return true;}
 await mutateDataJson<CustomerAccount|null>(accountPath(a.id),null,current=>{if(!current||current.disabled||current.phone!==a.phone)throw Error('account_changed');return {...current,telegramId:chat,phoneVerifiedAt:new Date().toISOString()};});
 await mutateDataJson<Challenge[]>(PATH,[],stored=>active(stored).filter(r=>r.hash!==c.hash));await send(token,chat,'Telegram подключён. Теперь через него можно восстановить доступ к кабинету.',{remove_keyboard:true});return true;}
 return false;
}
