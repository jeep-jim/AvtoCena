import {isAssistantProvider} from '@/lib/team-assistant/providers';
import {browserReply,validChannel} from '@/lib/team-assistant/browser';
import {cleanImages,readAssistantBody} from '@/lib/team-assistant/media';
import {randomUUID} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {recordCrmActivity} from '@/lib/crm-activity';
import {assistantAllowed,assistantPageControlAllowed,assistantCodeAllowed,canFillPath,cleanContext,safePath} from '@/lib/team-assistant/policy';
import {providerStatus} from '@/lib/team-assistant/provider';
import {codeConnectionReady,createCodeReview} from '@/lib/team-assistant/repository';
import {readHistory,lockHistory,unlockHistory,mutateHistory,mutatePending,checkPhrase,changePhrase} from '@/lib/team-assistant/store';
import {runAssistant} from '@/lib/team-assistant/agent';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
export async function GET(request:Request){
 const user=await getCurrentUser();if(!user)return json({error:'Войдите в аккаунт команды.'},401);
 if(!assistantAllowed(user))return json({error:'Помощник доступен только команде Топ Авто.'},403);
 if(new URL(request.url).searchParams.get('capabilities')==='1')return json({owner:isPlatformOwner(user),canControlPage:assistantPageControlAllowed(user)});
 try{const path=safePath(new URL(request.url).searchParams.get('path')||'/crm')||'/crm';const s=await readHistory(user.id);return json({userId:user.id,name:user.displayName,owner:isPlatformOwner(user),canCode:assistantCodeAllowed(user),canControlPage:assistantPageControlAllowed(user),pageControl:assistantPageControlAllowed(user)&&s.pageControl===true,canFill:assistantPageControlAllowed(user)&&s.pageControl===true&&canFillPath(user,path),connected:await providerStatus(),codeConnected:codeConnectionReady(),messages:s.messages,revision:s.revision});}
 catch{return json({error:'Не удалось открыть переписку. Попробуйте ещё раз.'},503);}
}
export async function POST(request:Request){
 // Require a real browser origin; cross-site or origin-less mutations fail closed.
 const origin=request.headers.get('origin');if(!origin||!['https://avtocena.com','https://www.avtocena.com',new URL(request.url).origin].includes(origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Недопустимый источник запроса.'},403);
 const user=await getCurrentUser();if(!user)return json({error:'Войдите в аккаунт команды.'},401);
 if(!assistantAllowed(user))return json({error:'Нет доступа к помощнику.'},403);
 let lease='';
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Неверный формат запроса.'},400);
  const body=await readAssistantBody(request);
  if(!Number.isInteger(body.revision)||body.revision<0)throw Error('Откройте переписку заново.');
  if(body.op==='message'&&!validChannel(body.browserChannel)&&!await providerStatus())return json({error:'Подключение ChatGPT ещё не завершено. Владелец сможет включить ответы после авторизации.'},503);
  lease=await lockHistory(user.id,body.revision);
  if(body.op==='page_control'){
   if(!assistantPageControlAllowed(user))return json({error:'Управление страницей доступно владельцам и администраторам.'},403);
   if(typeof body.enabled!=='boolean')throw Error('Выберите состояние переключателя.');
   const s=await mutateHistory(user.id,s=>({...s,pageControl:body.enabled,revision:s.revision+1}));
   await recordCrmActivity(user,{type:'assistant_page_control',title:body.enabled?'Разрешена помощь с формами':'Помощь с формами отключена',visibility:'management'});
   return json({pageControl:s.pageControl,messages:s.messages,revision:s.revision});
  }
  if(body.op==='reset'){
   const state=await mutateHistory(user.id,s=>({...s,messages:[],revision:s.revision+1}));return json({messages:[],revision:state.revision});
  }
  if(body.op==='phrase'){
   if(!isPlatformOwner(user))return json({error:'Кодовую фразу меняет только владелец.'},403);
   if(typeof body.current!=='string'||body.current.length>120||!await checkPhrase(body.current))return json({error:'Неверная текущая кодовая фраза.'},403);
   await changePhrase(String(body.next||''));await recordCrmActivity(user,{type:'assistant_phrase_changed',title:'Изменена кодовая фраза помощника',visibility:'management'});return json({ok:true});
  }
  if(body.op==='action'){
   if(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/.test(body.id))throw Error('Предложение не найдено.');
   const control=assistantPageControlAllowed(user)&&(await readHistory(user.id)).pageControl===true;
   const pending=await mutatePending(user.id,body.id,p=>{
    if(p.state!=='ready')throw Error(p.state==='done'?'Действие уже выполнено.':'Действие уже выполняется. Проверьте результат перед повтором.');
    if(['fill','navigate'].includes(p.action.kind)&&!control)throw Error('Включите помощь с формами в настройках помощника.');
    if(p.action.kind==='navigate'&&(!safePath(p.action.destination)||body.path!==p.action.path))throw Error('Страница изменилась. Повторите запрос.');
    if(p.action.kind==='fill'&&(!canFillPath(user,p.action.path)||body.path!==p.action.path))throw Error('Откройте исходную форму.');
    if(p.action.kind==='code'&&!assistantCodeAllowed(user))throw Error('Нет права изменения оформления.');return p;
   });
   if(pending.action.kind==='code'){
    if(typeof body.phrase!=='string'||body.phrase.length>120||!await checkPhrase(body.phrase))return json({error:'Неверная кодовая фраза.'},403);
    if(!codeConnectionReady())return json({error:'Подключение репозитория ещё не настроено.'},503);
   }
   await mutatePending(user.id,body.id,p=>{if(p.state!=='ready')throw Error('Действие уже выполняется.');return {...p,state:'working'};});
   let url:string|undefined;
   if(pending.action.kind==='code')url=await createCodeReview(body.id,pending.base!,pending.action.files!,pending.action.summary);
   await mutatePending(user.id,body.id,p=>({...p,state:'done',url}));
   await recordCrmActivity(user,{type:'assistant_action',title:pending.action.kind==='navigate'?'Подтверждён переход на страницу':pending.action.kind==='fill'?'Помощник подготовил заполнение формы':'Подготовлены правки оформления',visibility:'management',text:pending.action.kind==='navigate'?'Пользователь подтвердил переход по ссылке открытой страницы.':pending.action.kind==='fill'?'Черновик полей передан в открытое окно. Сохранение формы выполняется отдельно.':'Создана отдельная проверяемая правка. Установка не выполнялась.',...(url?{href:url}:{})});
   const s=await mutateHistory(user.id,s=>({...s,revision:s.revision+1,messages:s.messages.map(m=>({...m,actions:m.actions?.map(a=>a.id===body.id?{...a,status:'done',url}:a)}))}));
   return json({action:{...pending.action,status:'done',url},messages:s.messages,revision:s.revision});
  }
  if(body.op!=='message')throw Error('Неизвестное действие.');
  const provider=body.provider??'gpt';if(!isAssistantProvider(provider))throw Error('Выберите помощника.');
  if(provider!=='gpt'&&!validChannel(body.browserChannel))throw Error('Подключите выбранного помощника.');
  const text=String(body.text||'').trim();if(!text||text.length>6000)throw Error('Напишите сообщение до 6000 символов.');
  const images=cleanImages(body.images),context=cleanContext(body.context),previous=await readHistory(user.id);
  const control=assistantPageControlAllowed(user)&&previous.pageControl===true;
  if(!control){context.fields=[];context.links=[];}
  const answer=await runAssistant(user,text,context,previous.messages,AbortSignal.any([request.signal,AbortSignal.timeout(110000)]),images,validChannel(body.browserChannel)?browserReply(user.id,body.browserChannel,lease):undefined,control);
  const s=await mutateHistory(user.id,s=>{if(s.lease!==lease)throw Error('Переписка обновилась. Откройте её заново.');return {...s,revision:s.revision+1,messages:[...s.messages,{id:randomUUID(),role:'user' as const,provider,text,at:new Date().toISOString(),...(images.length?{imageNames:images.map(i=>i.name)}:{})},{...answer,provider}].slice(-40)};});
  return json({messages:s.messages,revision:s.revision});
 }catch(error){const message=error instanceof Error?error.message:'';return json({error:/^[А-ЯЁ]/.test(message)?message.slice(0,240):'Не удалось завершить запрос. Попробуйте снова.'},400);}
 finally{if(lease)await unlockHistory(user.id,lease).catch(()=>{});}
}
