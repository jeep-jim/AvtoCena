const origins=new Set(['https://avtocena.com','https://www.avtocena.com']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pending=new Set();
async function handle(m,sender){
 if(sender.frameId!==0||!sender.tab||!origins.has(new URL(sender.url).origin))throw Error('Нет доступа к соединению.');
 if(m.op==='ping')return {ok:true,version:'1.0.0'};
 if(typeof m.userId!=='string'||!m.userId||m.userId.length>120)throw Error('Войдите в аккаунт команды.');
 const key='binding:'+sender.tab.id,stored=(await chrome.storage.session.get(key))[key];
 const binding=stored?.userId===m.userId?stored:null;
 if(m.op==='disconnect'){await chrome.storage.session.remove(key);return {ok:true};}
 if(m.op==='status'){
  if(!binding)return {ok:true,connected:false};
  try{const state=await chrome.tabs.sendMessage(binding.tabId,{op:'probe',binding:binding.token});return {ok:true,connected:state.ok};}catch{return {ok:true,connected:false};}
 }
 if(m.op==='connect'){
  if(pending.has(key))throw Error('Дождитесь текущего ответа.');
  if(binding){try{const state=await chrome.tabs.sendMessage(binding.tabId,{op:'probe',binding:binding.token});if(state.ok)return {ok:true,connected:true};}catch{}}
  // A new dedicated conversation uses the existing browser sign-in, never another chat's history.
  const tab=await chrome.tabs.create({url:'https://chatgpt.com/',active:true,windowId:sender.tab.windowId});
  const token=crypto.randomUUID();let ready=false;
  for(let n=0;n<16;n++){await sleep(500);try{const r=await chrome.tabs.sendMessage(tab.id,{op:'bind',binding:token});if(r.ok){ready=true;break;}}catch{}}
  if(!ready){await chrome.storage.session.set({[key]:{userId:m.userId,tabId:tab.id,token}});throw Error('Войдите в ChatGPT в открывшейся вкладке, затем нажмите «Подключить» ещё раз.');}
  await chrome.storage.session.set({[key]:{userId:m.userId,tabId:tab.id,token}});
  await chrome.tabs.update(sender.tab.id,{active:true});return {ok:true,connected:true};
 }
 if(m.op!=='send'||!binding)throw Error('Нажмите «Подключить».');
 if(pending.has(key))throw Error('Дождитесь текущего ответа.');
 if(!Array.isArray(m.input)||JSON.stringify(m.input).length>4300000||typeof m.requestId!=='string')throw Error('Запрос слишком большой.');
 pending.add(key);
 try{return await chrome.tabs.sendMessage(binding.tabId,{op:'send',binding:binding.token,input:m.input,requestId:m.requestId});}
 catch{await chrome.storage.session.remove(key);throw Error('Вкладка ChatGPT закрыта или обновлена. Подключитесь заново.');}
 finally{pending.delete(key);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{handle(m,sender).then(reply).catch(e=>reply({ok:false,error:e.message}));return true;});
chrome.tabs.onRemoved.addListener(id=>{void chrome.storage.session.remove('binding:'+id);});
