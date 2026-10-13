(() => {
 if(globalThis.__avtocenaConnector105)return;globalThis.__avtocenaConnector105=true;
 let binding='',path='',busy=false,activeRequest=null;
 const provider=location.hostname==='chat.deepseek.com'?'deepseek':location.hostname==='alice.yandex.ru'?'alice':/^(www\.)?google\.com$/.test(location.hostname)?'googleai':'gpt';
 const label={deepseek:'DeepSeek',gpt:'ChatGPT',alice:'Алиса',googleai:'Google'}[provider];
 const initialPath=p=>(provider==='googleai'&&/^\/search\/?$/.test(p)&&new URLSearchParams(location.search).get('udm')==='50'&&!new URLSearchParams(location.search).has('q'))||({deepseek:/^\/$/,gpt:/^\/$/,alice:/^\/(?:chat)?\/?$/,googleai:/^\/ai\/?$/})[provider].test(p);
 const conversationPath=p=>({deepseek:/^\/a\/chat\/s\/[^/]+\/?$/,gpt:/^\/c\/[^/]+\/?$/,alice:/^\/chat\/[^/]+\/?$/,googleai:/^\/search\/?$/})[provider].test(p);
 function all(selector){const out=[],roots=[document];while(roots.length){const root=roots.shift();out.push(...root.querySelectorAll(selector));for(const el of root.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);}return [...new Set(out)];}
 const answerSelector=provider==='deepseek'?'.ds-markdown,[class*="ds-markdown"]':provider==='gpt'?'[data-message-author-role="assistant"],[data-turn="assistant"],[data-testid*="assistant"],[data-testid^="conversation-turn-"],[class*="markdown"],[class*="prose"]':provider==='alice'?'[data-message-author-role="assistant"],[data-testid*="assistant"],[class*="AssistantMessage"],[class*="assistant-message"],[class*="assistantMessage"],[class*="MessageContent"],[class*="message-content"],[class*="markdown"]':'[data-message-author-role="assistant"],[data-attrid="wa:/description"],[data-attrid^="wa:"],[data-container-id],[data-content-feature],[data-snhf],[role="article"],article,[class*="response"],[class*="answer"],[class*="markdown"],[class*="prose"]';
 const answers=()=>all(answerSelector).filter(x=>!x.closest('[contenteditable]')&&!x.querySelector('textarea,input,[contenteditable]'));

 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>5&&r.height>5&&s.display!=='none'&&s.visibility!=='hidden';};
 const composer=()=>all('#prompt-textarea,textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"][role="combobox"],[contenteditable="true"][aria-multiline="true"],.ProseMirror[contenteditable="true"],div[contenteditable="true"],input[name="q"]').filter(el=>(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement||el.isContentEditable)&&!el.disabled&&visible(el)).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0];
 const readiness=()=>({ready:!!composer(),empty:!answers().length&&!all('[data-message-author-role="user"]').length,path:location.pathname});
 const stop=()=>all('[data-testid="stop-button"],button[aria-label*="Stop" i],button[aria-label*="Останов" i],[aria-busy="true"]').some(visible);
 const sendButton=()=>all('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="Отправ" i],button[aria-label*="Submit" i],button[aria-label*="Ask" i],button[aria-label*="Search" i],button[class*="send" i],[role="button"][aria-label*="Send" i],[role="button"][aria-label*="Отправ" i],button[type="submit"]').find(x=>visible(x)&&!x.disabled&&x.getAttribute('aria-disabled')!=='true');
 const textOf=el=>(el?.innerText||el?.textContent||'').replace(/[\u200b-\u200d\ufeff]/g,'').trim();
 const structured=value=>{try{const p=JSON.parse(value.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));return !!p&&(typeof p.reply==='string'||typeof p.tool==='string');}catch{return false;}};
 const hasMarker=(el,marker)=>[el.innerText,el.textContent].some(t=>String(t||'').replace(/[\u200b-\u200d\ufeff]/g,'').includes(marker));
 function ownPrompt(marker){
  // The current ChatGPT shell can render its conversation outside <main>.
  // Search all rendered roots, including shadow roots, but accept only our UUID echo.
  const exact=all('[data-message-author-role="user"]').find(x=>hasMarker(x,marker));if(exact)return exact;
  return all('div,span,p,article,[role="article"]').filter(x=>!x.closest('[contenteditable],[data-message-author-role="assistant"],[data-turn="assistant"]')&&!x.querySelector('textarea,input,[contenteditable],[data-message-author-role="assistant"],[data-turn="assistant"]')&&hasMarker(x,marker)).sort((a,b)=>textOf(a).length-textOf(b).length)[0]||null;
 }
 async function send(m,resume=false){
  if(resume){if(busy)throw Error('Дождитесь текущего ответа.');binding=m.binding;path=m.expectedPath;}
  if(m.binding!==binding||(!resume&&location.pathname!==path))throw Error('Диалог изменился. Нажмите «Подключить» заново.');
  if(busy||(!resume&&stop()))throw Error('Дождитесь ответа в ChatGPT.');
  const el=composer();if(!resume&&!el)throw Error('Откройте вкладку ChatGPT и войдите в аккаунт.');
  if(!resume&&(el.value||textOf(el)).trim())throw Error('В ChatGPT есть неотправленный текст. Сначала отправьте или уберите его.');
  busy=true;const request=new AbortController();activeRequest={id:m.requestId,controller:request};
  const before=new Map((resume?[]:answers()).map(x=>[x,textOf(x)]));
  const started=m.started||Date.now();let wake;const observer=new MutationObserver(()=>wake?.());
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
  const changed=()=>new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);request.signal.removeEventListener('abort',done);wake=null;resolve();};wake=done;timer=setTimeout(done,500);request.signal.addEventListener('abort',done,{once:true});if(request.signal.aborted)done();});
  try{
   const marker='[ИИ Бро '+m.requestId+']',images=[],lines=[];
   if(!resume){
   for(const item of m.input){
    if(Array.isArray(item.content)){for(const c of item.content){if(c.type==='input_text')lines.push(c.text);else if(c.type==='input_image')images.push(c.image_url);}}
    else lines.push(String(item.role)+': '+String(item.content||''));
   }
   if(images.length){
    const dt=new DataTransfer();for(const [i,url] of images.entries()){
     if(!/^data:image\/jpeg;base64,/.test(url))throw Error('Изображение не поддерживается.');
     const bytes=Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0));dt.items.add(new File([bytes],'bro-'+m.requestId+'-'+i+'.jpg',{type:'image/jpeg'}));
    }
    const input=[...document.querySelectorAll('input[type=file]')].find(x=>!x.disabled&&(!x.accept||/image|\*/.test(x.accept)));
    if(!input)throw Error('ChatGPT не показал поле загрузки фото. Откройте вложения в его вкладке и повторите запрос.');
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    let attached=false;for(let n=0;n<40;n++){await sleep(250);if([...document.querySelectorAll('[aria-label], [title]')].some(x=>(x.getAttribute('aria-label')||x.getAttribute('title')||'').includes('bro-'+m.requestId))){attached=true;break;}}
    if(!attached)throw Error('Прикрепление фото не подтверждено. Проверьте вкладку ChatGPT; текст без фото не отправлен.');
   }
   request.signal.throwIfAborted();const prompt=marker+'\n'+lines.join('\n\n');el.focus();
   if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,prompt);el.dispatchEvent(new Event('input',{bubbles:true}));}
   else{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,prompt);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));}
   let button;for(let n=0;n<30;n++){button=sendButton();if(button&&!button.disabled)break;await sleep(200);}
   request.signal.throwIfAborted();if(button)button.click();else for(const type of ['keydown','keypress','keyup'])el.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,composed:true,cancelable:true}));}
   let last='',stable=0,echoSeen=false;
   while(Date.now()-started<90000){
    await changed();request.signal.throwIfAborted();
    const users=all('[data-message-author-role="user"]'),anchor=ownPrompt(marker);
    if(location.pathname!==path){
     if(initialPath(path)&&conversationPath(location.pathname)){if(!anchor)continue;path=location.pathname;}
     else throw Error('В служебном окне открыт другой диалог. Отключите ИИ Бро и подключитесь заново.');
    }
    if(!anchor)continue;echoSeen=true;
    if(users.some(x=>x!==anchor&&!x.contains(anchor)&&(anchor.compareDocumentPosition(x)&Node.DOCUMENT_POSITION_FOLLOWING)))throw Error('В ChatGPT отправлено другое сообщение. Ответ не перенесён.');
    const candidates=answers().filter(x=>!x.contains(anchor)&&!anchor.contains(x)&&!hasMarker(x,marker)&&(!before.has(x)||before.get(x)!==textOf(x))&&(anchor.compareDocumentPosition(x)&Node.DOCUMENT_POSITION_FOLLOWING));
    // Prefer the complete response container to a nested code block.
    const qualified=provider==='gpt'?candidates.filter(x=>x.matches('[data-message-author-role="assistant"],[data-turn="assistant"]')||structured(textOf(x))):candidates;
    const answer=qualified.filter(x=>!qualified.some(y=>y!==x&&y.contains(x))).at(-1);
    const value=textOf(answer);if(!value)continue;
    if(value!==last){last=value;stable=Date.now();}
    if(!stop()&&(structured(value)||Date.now()-stable>1800))return {ok:true,text:value.slice(0,100000),path};
   }
   throw Error(echoSeen?'ChatGPT ещё не завершил ответ. Откройте служебный ChatGPT и проверьте его. Повторной отправки не было.':'Не удалось подтвердить отправку сообщения. Откройте служебный ChatGPT и проверьте, появился ли запрос. Повторной отправки не было.');
  }finally{observer.disconnect();if(activeRequest?.id===m.requestId){activeRequest=null;busy=false;}}
 }
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||sender.tab)return;
  if(m.op==='cancel'){if(m.binding===binding&&activeRequest?.id===m.requestId)activeRequest.controller.abort();reply({ok:true});return;}
  if(m.op==='inspect'){const state=readiness();reply({ready:state.ready,diagnostic:{document:document.readyState,visibility:document.visibilityState,composer:state.ready,empty:state.empty,route:initialPath(location.pathname)?'start':conversationPath(location.pathname)?'conversation':'other',draft:!!(composer()?.value||textOf(composer())).trim(),busy:busy||stop(),fileInputs:all('input[type=file]').length}});return;}
  if(m.op==='bind'){
   const state=readiness(),input=composer();
   if(busy||stop()){reply({ok:false,reason:'busy',error:'Дождитесь текущего ответа в ChatGPT.'});return;}
   if(!state.ready){reply({ok:false,reason:'loading',error:'Поле сообщения ChatGPT пока не найдено. Дождитесь загрузки или войдите в аккаунт, затем повторите подключение.'});return;}
   if((!m.expectedPath&&(!initialPath(location.pathname)||!state.empty))||(m.expectedPath&&m.expectedPath!==location.pathname)){reply({ok:false,reason:'conversation',error:'В этой вкладке открыт другой диалог. Нажмите «Новый чат» в ChatGPT и повторите подключение.'});return;}
   if((input.value||textOf(input)).trim()){reply({ok:false,reason:'draft',error:'В ChatGPT есть неотправленный текст. Отправьте или уберите его, затем подключитесь.'});return;}
   binding=m.binding;path=location.pathname;reply({ok:true,path});return;
  }
  if(m.op==='probe'){reply({ok:!!binding&&binding===m.binding&&path===location.pathname&&!!composer(),path});return;}
  if(m.op==='send'||m.op==='resume'){send(m,m.op==='resume').then(reply).catch(e=>reply({ok:false,error:e.message.replaceAll('ChatGPT',label),path}));return true;}
 });
})();
