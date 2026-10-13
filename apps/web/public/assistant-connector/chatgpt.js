(() => {
 if(globalThis.__avtocenaConnector103)return;globalThis.__avtocenaConnector103=true;
 let binding='',path='',busy=false,activeRequest=null;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>5&&r.height>5&&s.display!=='none'&&s.visibility!=='hidden';};
 const composer=()=>[...document.querySelectorAll('#prompt-textarea,textarea[name="prompt-textarea"],main [contenteditable="true"][role="textbox"],main .ProseMirror[contenteditable="true"],form textarea')].find(el=>(el instanceof HTMLTextAreaElement||el.isContentEditable)&&!el.disabled&&visible(el));
 const readiness=()=>{const input=composer(),empty=!document.querySelector('[data-message-author-role]');return {ready:!!input,empty,path:location.pathname};};
 const stop=()=>[...document.querySelectorAll('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Остановить генерацию"]')].some(visible);
 const sendButton=()=>[...document.querySelectorAll('[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Отправить запрос"]'),...(composer()?.closest('form')?.querySelectorAll('button[type="submit"]')||[])].find(visible);
 const textOf=el=>(el?.innerText||el?.textContent||'').trim();
 const conversationPath=p=>/^\/c\/[^/]+\/?$/.test(p);
 function ownPrompt(marker){
  const users=[...document.querySelectorAll('[data-message-author-role="user"]')];
  const exact=users.find(x=>textOf(x).includes(marker));if(exact)return exact;
  // As in OSMINOG, require the unique sent marker even if the user-role wrapper is absent.
  // Never treat the composer, an assistant answer or a whole conversation as the echo.
  const root=document.querySelector('main,[role="main"]');if(!root)return null;
  return [...root.querySelectorAll('div,span,p,article')].filter(x=>!x.closest('[contenteditable],form,[data-message-author-role="assistant"]')&&!x.querySelector('textarea,input,[contenteditable],[data-message-author-role="assistant"]')&&textOf(x).includes(marker)).sort((a,b)=>textOf(a).length-textOf(b).length)[0]||null;
 }
 async function send(m){
  if(m.binding!==binding||location.pathname!==path)throw Error('Диалог изменился. Нажмите «Подключить» заново.');
  if(busy||stop())throw Error('Дождитесь ответа в ChatGPT.');
  const el=composer();if(!el)throw Error('Откройте вкладку ChatGPT и войдите в аккаунт.');
  if((el.value||textOf(el)).trim())throw Error('В ChatGPT есть неотправленный текст. Сначала отправьте или уберите его.');
  busy=true;const request=new AbortController();activeRequest={id:m.requestId,controller:request};
  const before=new Set(document.querySelectorAll('[data-message-author-role="assistant"]'));
  const started=Date.now();let wake;const observer=new MutationObserver(()=>wake?.());
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
  const changed=()=>new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);request.signal.removeEventListener('abort',done);wake=null;resolve();};wake=done;timer=setTimeout(done,500);request.signal.addEventListener('abort',done,{once:true});if(request.signal.aborted)done();});
  try{
   const marker='[ИИ Бро '+m.requestId+']',images=[],lines=[];
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
   if(el instanceof HTMLTextAreaElement){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,prompt);el.dispatchEvent(new Event('input',{bubbles:true}));}
   else{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,prompt);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));}
   let button;for(let n=0;n<30;n++){button=sendButton();if(button&&!button.disabled)break;await sleep(200);}
   if(!button||button.disabled)throw Error('ChatGPT пока не готов отправить сообщение. Проверьте его вкладку.');
   request.signal.throwIfAborted();button.click();let last='',stable=0,echoSeen=false;
   while(Date.now()-started<90000){
    await changed();request.signal.throwIfAborted();
    const users=[...document.querySelectorAll('[data-message-author-role="user"]')],anchor=ownPrompt(marker);
    if(location.pathname!==path){
     if(path==='/'&&conversationPath(location.pathname)){if(!anchor)continue;path=location.pathname;}
     else throw Error('В служебном окне открыт другой диалог. Отключите ИИ Бро и подключитесь заново.');
    }
    if(!anchor)continue;echoSeen=true;
    if(users.some(x=>x!==anchor&&!x.contains(anchor)&&(anchor.compareDocumentPosition(x)&Node.DOCUMENT_POSITION_FOLLOWING)))throw Error('В ChatGPT отправлено другое сообщение. Ответ не перенесён.');
    const answer=[...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(x=>!before.has(x)&&(anchor.compareDocumentPosition(x)&Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    const value=textOf(answer);if(!value)continue;
    if(value!==last){last=value;stable=Date.now();}
    let structured=false;try{const parsed=JSON.parse(value.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));structured=!!parsed&&(typeof parsed.reply==='string'||typeof parsed.tool==='string');}catch{}
    if(!stop()&&(structured||Date.now()-stable>1800))return {ok:true,text:value.slice(0,100000),path};
   }
   throw Error(echoSeen?'ChatGPT ещё не завершил ответ. Откройте служебный ChatGPT и проверьте его. Повторной отправки не было.':'Не удалось подтвердить отправку сообщения. Откройте служебный ChatGPT и проверьте, появился ли запрос. Повторной отправки не было.');
  }finally{observer.disconnect();if(activeRequest?.id===m.requestId){activeRequest=null;busy=false;}}
 }
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||sender.tab)return;
  if(m.op==='cancel'){if(m.binding===binding&&activeRequest?.id===m.requestId)activeRequest.controller.abort();reply({ok:true});return;}
  if(m.op==='inspect'){reply(readiness());return;}
  if(m.op==='bind'){
   const state=readiness(),input=composer();
   if(busy||stop()){reply({ok:false,reason:'busy',error:'Дождитесь текущего ответа в ChatGPT.'});return;}
   if(!state.ready){reply({ok:false,reason:'loading',error:'Поле сообщения ChatGPT пока не найдено. Дождитесь загрузки или войдите в аккаунт, затем повторите подключение.'});return;}
   if((!m.expectedPath&&(location.pathname!=='/'||!state.empty))||(m.expectedPath&&m.expectedPath!==location.pathname)){reply({ok:false,reason:'conversation',error:'В этой вкладке открыт другой диалог. Нажмите «Новый чат» в ChatGPT и повторите подключение.'});return;}
   if((input.value||textOf(input)).trim()){reply({ok:false,reason:'draft',error:'В ChatGPT есть неотправленный текст. Отправьте или уберите его, затем подключитесь.'});return;}
   binding=m.binding;path=location.pathname;reply({ok:true,path});return;
  }
  if(m.op==='probe'){reply({ok:!!binding&&binding===m.binding&&path===location.pathname&&!!composer(),path});return;}
  if(m.op==='send'){send(m).then(reply).catch(e=>reply({ok:false,error:e.message,path}));return true;}
 });
})();
