const providers={deepseek:{url:'https://chat.deepseek.com/',name:'DeepSeek'},gpt:{url:'https://chatgpt.com/',name:'ChatGPT'},alice:{url:'https://alice.yandex.ru/',name:'Алиса'},googleai:{url:'https://www.google.com/ai',name:'Google'}};
const origins=new Set(['https://avtocena.com','https://www.avtocena.com']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pending=new Map(),connecting=new Map();
async function bounded(task,ms=2500){
 let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Вкладка не ответила на проверку.')),ms);})]);}finally{clearTimeout(timer);}
}
async function probe(binding,op='bind'){
 try{return await bounded(chrome.tabs.sendMessage(binding.tabId,{op,binding:binding.token,expectedPath:binding.path||'',provider:binding.provider}));}
 catch{
  try{await bounded(chrome.scripting.executeScript({target:{tabId:binding.tabId},files:['chatgpt.js']}));return await bounded(chrome.tabs.sendMessage(binding.tabId,{op,binding:binding.token,expectedPath:binding.path||'',provider:binding.provider}));}
  catch{return {ok:false,error:'Нет связи с вкладкой ChatGPT. Дождитесь её загрузки. Проверьте в настройках расширения разрешение доступа к chatgpt.com.'};}
 }
}
async function connect(key,stored,m,sender){
 let binding=stored?.userId===m.userId&&stored.managed===3&&stored.provider===m.provider?stored:null,tab;
 if(binding){try{tab=await chrome.tabs.get(binding.tabId);}catch{}}
 if(!tab){
  // Only extension-created service windows. Never discover or reuse a user's chat.
  const win=await chrome.windows.create({url:providers[m.provider].url,type:'popup',focused:false,width:920,height:760});
  tab=win.tabs?.[0];if(!tab?.id)throw Error('Не удалось открыть служебный ChatGPT. Повторите подключение.');
  binding={userId:m.userId,tabId:tab.id,windowId:win.id,managed:3,provider:m.provider,token:crypto.randomUUID()};
  // Remember immediately: a timeout or interrupted retry must reuse this tab.
  await chrome.storage.session.set({[key]:binding});
  await chrome.windows.update(binding.windowId,{state:'minimized',focused:false}).catch(()=>{});
 }
 if(tab.windowId!==binding.windowId)throw Error('Служебная вкладка перемещена. Отключите ИИ Бро и подключите заново.');
 let result;const deadline=Date.now()+25000;
 while(Date.now()<deadline){
  result=await probe(binding);
  if(result.ok){binding.path=result.path;await chrome.storage.session.set({[key]:binding});await chrome.windows.update(binding.windowId,{state:'minimized',focused:false}).catch(()=>{});return {ok:true,connected:true};}
  if(result.reason==='conversation'||result.reason==='draft'||result.reason==='busy')break;
  await sleep(500);
 }
 throw Error(result?.error||'ChatGPT ещё загружается. Дождитесь поля сообщения и нажмите «Подключить» снова — будет использована та же вкладка.');
}
// A provider may navigate after sending (Google AI). Reattach to the same tab
// and observe its UUID-marked response; never resend the user's prompt.
async function exchange(binding,m,key){
 const started=Date.now(),payload={binding:binding.token,input:m.input,requestId:m.requestId,expectedPath:binding.path,started};
 let op='send';
 while(Date.now()-started<90000&&pending.get(key)===m.requestId){
  try{
   const tab=await chrome.tabs.get(binding.tabId),host=new URL(tab.url||'').hostname;
   const allowed=binding.provider==='gpt'?host==='chatgpt.com':binding.provider==='alice'?host==='alice.yandex.ru':binding.provider==='deepseek'?host==='chat.deepseek.com':/^(www\.)?google\.com$/.test(host);
   if(!allowed)return {ok:false,error:'Войдите в выбранный сервис через настройки помощника.'};
   if(op==='resume')await chrome.scripting.executeScript({target:{tabId:binding.tabId},files:['chatgpt.js']});
   const result=await chrome.tabs.sendMessage(binding.tabId,{...payload,op});
   if(result)return result;
  }catch{/* A page navigation closes its old content-script response port. */}
  op='resume';await sleep(500);
 }
 return {ok:false,error:'Ответ не получен. Запрос отправлен один раз; повторной отправки не было.'};
}
async function handle(m,sender){
 if(sender.frameId!==0||!sender.tab||!origins.has(new URL(sender.url).origin))throw Error('Нет доступа к соединению.');
 if(m.op==='ping')return {ok:true,version:'1.0.5'};
 if(typeof m.userId!=='string'||!m.userId||m.userId.length>120)throw Error('Войдите в аккаунт команды.');
 m={...m,provider:m.provider||'gpt'};if(!Object.hasOwn(providers,m.provider))throw Error('Выберите помощника.');
 const key='binding:'+sender.tab.id+':'+m.provider,stored=(await chrome.storage.session.get(key))[key],binding=stored?.userId===m.userId&&stored.managed===3&&stored.provider===m.provider?stored:null;
 if(m.op==='diagnose'){
  const diagnostic={version:'1.0.5',provider:m.provider,serviceTab:!!binding};
  if(!binding)return {ok:true,diagnostic:{...diagnostic,stage:'not-connected'}};
  let tab;try{tab=await bounded(chrome.tabs.get(binding.tabId));}catch{return {ok:true,diagnostic:{...diagnostic,stage:'tab-closed'}};}
  diagnostic.load=tab.status;diagnostic.discarded=!!tab.discarded;
  // Do not export URLs with conversation IDs, page text, prompts or account details.
  const result=await probe(binding,'inspect');
  return {ok:true,diagnostic:{...diagnostic,stage:result.ready?'composer-found':'not-ready',...(result.diagnostic||{}),...(result.error?{error:result.error}:{})}};
 }
 if(m.op==='open'){if(!binding)throw Error('Сначала нажмите «Подключить».');await chrome.windows.update(binding.windowId,{state:'normal',focused:true});await chrome.tabs.update(binding.tabId,{active:true});return {ok:true};}
 if(m.op==='cancel'){if(binding&&pending.get(key)===m.requestId){await chrome.tabs.sendMessage(binding.tabId,{op:'cancel',binding:binding.token,requestId:m.requestId}).catch(()=>{});pending.delete(key);}return {ok:true};}
 if(m.op==='disconnect'){await chrome.storage.session.remove(key);return {ok:true};}
 if(m.op==='status'){if(!binding)return {ok:true,connected:false};try{const state=await chrome.tabs.sendMessage(binding.tabId,{op:'probe',binding:binding.token});return {ok:true,connected:state.ok};}catch{return {ok:true,connected:false};}}
 if(m.op==='connect'){
  if(pending.has(key))throw Error('Дождитесь текущего ответа.');
  if(connecting.has(key))return connecting.get(key);
  const task=connect(key,stored,m,sender);connecting.set(key,task);
  try{return await task;}finally{connecting.delete(key);}
 }
 if(m.op!=='send'||!binding)throw Error('Нажмите «Подключить».');
 if(pending.has(key))throw Error('Дождитесь текущего ответа.');
 if(!Array.isArray(m.input)||JSON.stringify(m.input).length>4300000||typeof m.requestId!=='string')throw Error('Запрос слишком большой.');
 const target=await chrome.tabs.get(binding.tabId);if(target.windowId!==binding.windowId)throw Error('Служебная вкладка перемещена. Подключитесь заново.');
 await chrome.windows.update(binding.windowId,{state:'minimized',focused:false}).catch(()=>{});
 pending.set(key,m.requestId);let timer;
 try{const result=await Promise.race([exchange(binding,m,key),new Promise((_,reject)=>{timer=setTimeout(()=>{void chrome.tabs.sendMessage(binding.tabId,{op:'cancel',binding:binding.token,requestId:m.requestId}).catch(()=>{});reject(Error('Ответ не получен вовремя.'));},95000);})]);if(result?.path){binding.path=result.path;await chrome.storage.session.set({[key]:binding});}return result;}
 catch{throw Error('Связь с вкладкой ChatGPT прервана. Нажмите «Подключить»: повторно будет проверена та же вкладка.');}
 finally{clearTimeout(timer);if(pending.get(key)===m.requestId)pending.delete(key);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{handle(m,sender).then(reply).catch(e=>reply({ok:false,error:e.message.replaceAll('ChatGPT',providers[m.provider||'gpt']?.name||'помощник')}));return true;});
chrome.tabs.onRemoved.addListener(id=>{void (async()=>{const all=await chrome.storage.session.get(null);await chrome.storage.session.remove(Object.entries(all).filter(([key,b])=>key.startsWith('binding:'+id+':')||key.startsWith('binding:')&&b.tabId===id).map(([key])=>key));})();});
