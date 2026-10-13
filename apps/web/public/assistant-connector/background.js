const origins=new Set(['https://avtocena.com','https://www.avtocena.com']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pending=new Map(),connecting=new Map();
async function probe(binding,op='bind'){
 try{return await chrome.tabs.sendMessage(binding.tabId,{op,binding:binding.token,expectedPath:binding.path||''});}
 catch{
  try{await chrome.scripting.executeScript({target:{tabId:binding.tabId},files:['chatgpt.js']});return await chrome.tabs.sendMessage(binding.tabId,{op,binding:binding.token,expectedPath:binding.path||''});}
  catch{return {ok:false,error:'Нет связи с вкладкой ChatGPT. Дождитесь её загрузки. Проверьте в настройках расширения разрешение доступа к chatgpt.com.'};}
 }
}
async function connect(key,stored,m,sender){
 let binding=stored?.userId===m.userId&&stored.managed===2?stored:null,tab;
 if(binding){try{tab=await chrome.tabs.get(binding.tabId);}catch{}}
 if(!tab){
  // Only extension-created service windows. Never discover or reuse a user's chat.
  const win=await chrome.windows.create({url:'https://chatgpt.com/',type:'popup',focused:false,width:920,height:760});
  tab=win.tabs?.[0];if(!tab?.id)throw Error('Не удалось открыть служебный ChatGPT. Повторите подключение.');
  binding={userId:m.userId,tabId:tab.id,windowId:win.id,managed:2,token:crypto.randomUUID()};
  // Remember immediately: a timeout or interrupted retry must reuse this tab.
  await chrome.storage.session.set({[key]:binding});
 }
 if(tab.windowId!==binding.windowId)throw Error('Служебная вкладка перемещена. Отключите ИИ Бро и подключите заново.');
 let result;
 for(let n=0;n<50;n++){
  result=await probe(binding);
  if(result.ok){binding.path=result.path;await chrome.storage.session.set({[key]:binding});await chrome.windows.update(binding.windowId,{state:'minimized',focused:false}).catch(()=>{});return {ok:true,connected:true};}
  if(result.reason==='conversation'||result.reason==='draft'||result.reason==='busy')break;
  await sleep(500);
 }
 throw Error(result?.error||'ChatGPT ещё загружается. Дождитесь поля сообщения и нажмите «Подключить» снова — будет использована та же вкладка.');
}
async function handle(m,sender){
 if(sender.frameId!==0||!sender.tab||!origins.has(new URL(sender.url).origin))throw Error('Нет доступа к соединению.');
 if(m.op==='ping')return {ok:true,version:'1.0.2'};
 if(typeof m.userId!=='string'||!m.userId||m.userId.length>120)throw Error('Войдите в аккаунт команды.');
 const key='binding:'+sender.tab.id,stored=(await chrome.storage.session.get(key))[key],binding=stored?.userId===m.userId&&stored.managed===2?stored:null;
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
 pending.set(key,m.requestId);let timer;
 try{const result=await Promise.race([chrome.tabs.sendMessage(binding.tabId,{op:'send',binding:binding.token,input:m.input,requestId:m.requestId}),new Promise((_,reject)=>{timer=setTimeout(()=>{void chrome.tabs.sendMessage(binding.tabId,{op:'cancel',binding:binding.token,requestId:m.requestId}).catch(()=>{});reject(Error('Ответ не получен вовремя.'));},95000);})]);if(result?.ok&&result.path){binding.path=result.path;await chrome.storage.session.set({[key]:binding});}return result;}
 catch{throw Error('Связь с вкладкой ChatGPT прервана. Нажмите «Подключить»: повторно будет проверена та же вкладка.');}
 finally{clearTimeout(timer);if(pending.get(key)===m.requestId)pending.delete(key);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{handle(m,sender).then(reply).catch(e=>reply({ok:false,error:e.message}));return true;});
chrome.tabs.onRemoved.addListener(id=>{void (async()=>{const all=await chrome.storage.session.get(null);await chrome.storage.session.remove(Object.entries(all).filter(([key,b])=>key==='binding:'+id||key.startsWith('binding:')&&b.tabId===id).map(([key])=>key));})();});
