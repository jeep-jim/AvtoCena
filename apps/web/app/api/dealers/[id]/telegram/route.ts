import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readDealerTelegram,saveDealerTelegram} from '@/lib/dealers/telegram-settings';
import {getTelegramRuntimeConfig} from '@/lib/telegram-config';
const headers={'Cache-Control':'private, no-store'};
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!await canManageDealer(await getCurrentUser(),id))return Response.json({error:'Нет доступа к компании'},{status:403,headers});return Response.json(await readDealerTelegram(id),{headers});}
export async function PUT(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params,user=await getCurrentUser();
 if(!isCalculationOriginAllowed(req)||!await canManageDealer(user,id))return Response.json({error:'Нет доступа к компании'},{status:403,headers});
 try{const raw=await req.text();if(raw.length>2000)throw Error('Слишком большой запрос');const b=JSON.parse(raw),current=await readDealerTelegram(id);if(b.version!==current.version)throw Error('Настройки изменились. Обновите страницу');
 if(b.enabled===false)return Response.json(await saveDealerTelegram(id,{...current,enabled:false}),{headers});
 const chatId=String(b.chatId||'').trim(),title=String(b.title||'').trim();if(!/^-\d{5,20}$/.test(chatId)||!title||title.length>128)throw Error('Укажите ID и точное название закрытой группы');
 const config=await getTelegramRuntimeConfig();if(!config?.token)throw Error('Бот пока не подключён. Обратитесь к владельцу платформы');
 const telegram=async(method:string,body:any)=>{const r=await fetch(`https://api.telegram.org/bot${config.token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const v=await r.json();if(!r.ok||!v.ok)throw Error('Не удалось проверить группу. Проверьте ID и права бота');return v.result;};
 const me=await telegram('getMe',{}),chat=await telegram('getChat',{chat_id:chatId});if(String(chat.id)!==chatId||chat.title!==title||!['group','supergroup'].includes(chat.type)||chat.username||chat.active_usernames?.length)throw Error('ID и название должны соответствовать закрытой группе');
 const bot=await telegram('getChatMember',{chat_id:chatId,user_id:me.id});if(!['administrator','creator','member'].includes(bot.status)||bot.status==='member'&&chat.permissions?.can_send_messages===false)throw Error('Добавьте бота АвтоЦены в группу с правом отправлять сообщения');
 if(!isPlatformOwner(user)){if(!user?.telegramId)throw Error('Для подтверждения группы нужен вход через Telegram. Можно обратиться к владельцу платформы');const member=await telegram('getChatMember',{chat_id:chatId,user_id:user.telegramId});if(!['administrator','creator'].includes(member.status))throw Error('Подключить группу может её администратор');}
 return Response.json(await saveDealerTelegram(id,{version:current.version,enabled:true,chatId,title,verifiedAt:new Date().toISOString(),verifiedBy:user!.id}),{headers});
 }catch(e){return Response.json({error:e instanceof Error&&!/https?:/.test(e.message)?e.message:'Не удалось проверить Telegram. Попробуйте позже'},{status:400,headers});}
}
