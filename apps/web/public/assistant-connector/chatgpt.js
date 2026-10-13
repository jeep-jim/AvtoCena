(() => {
 let binding='',path='',busy=false;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const composer=()=>document.querySelector('#prompt-textarea');
 const stop=()=>document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Остановить генерацию"]');
 const sendButton=()=>document.querySelector('[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Отправить запрос"]');
 const textOf=el=>(el?.innerText||el?.textContent||'').trim();
 async function send(m){
  if(m.binding!==binding||location.pathname!==path)throw Error('Диалог изменился. Нажмите «Подключить» заново.');
  if(busy||stop())throw Error('Дождитесь ответа в ChatGPT.');
  const el=composer();if(!el)throw Error('Откройте вкладку ChatGPT и войдите в аккаунт.');
  if((el.value||textOf(el)).trim())throw Error('В ChatGPT есть неотправленный текст. Сначала отправьте или уберите его.');
  busy=true;
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
   const prompt=marker+'\n'+lines.join('\n\n');el.focus();
   if(el instanceof HTMLTextAreaElement){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,prompt);el.dispatchEvent(new Event('input',{bubbles:true}));}
   else{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,prompt);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));}
   let button;for(let n=0;n<30;n++){button=sendButton();if(button&&!button.disabled)break;await sleep(200);}
   if(!button||button.disabled)throw Error('ChatGPT пока не готов отправить сообщение. Проверьте его вкладку.');
   button.click();let last='',stable=0;
   for(let n=0;n<340;n++){
    await sleep(250);
    const users=[...document.querySelectorAll('[data-message-author-role="user"]')],anchor=users.find(x=>textOf(x).includes(marker));
    if(location.pathname!==path){if(path==='/'&&/^\/c\/[a-zA-Z0-9-]+$/.test(location.pathname)&&anchor)path=location.pathname;else if(anchor||n>12)throw Error('Диалог изменился во время ответа. Переподключите ИИ Бро.');}
    if(!anchor)continue;
    if(users.at(-1)!==anchor)throw Error('В ChatGPT отправлено другое сообщение. Ответ не перенесён.');
    const answer=[...document.querySelectorAll('[data-message-author-role="assistant"]')].find(x=>anchor.compareDocumentPosition(x)&Node.DOCUMENT_POSITION_FOLLOWING);
    const value=textOf(answer);if(!value)continue;
    if(value!==last){last=value;stable=Date.now();}
    if(!stop()&&Date.now()-stable>1800)return {ok:true,text:value.slice(0,100000)};
   }
   throw Error('ChatGPT ещё не завершил ответ. Проверьте вкладку. Повторная отправка автоматически не выполнялась.');
  }finally{busy=false;}
 }
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||sender.tab)return;
  if(m.op==='bind'){if(!busy&&composer()&&location.pathname==='/'){binding=m.binding;path=location.pathname;reply({ok:true});}else reply({ok:false});return;}
  if(m.op==='probe'){if(!binding&&location.pathname==='/'&&composer()){binding=m.binding;path='/';}reply({ok:!!binding&&binding===m.binding&&path===location.pathname&&!!composer()});return;}
  if(m.op==='send'){send(m).then(reply).catch(e=>reply({ok:false,error:e.message}));return true;}
 });
})();
