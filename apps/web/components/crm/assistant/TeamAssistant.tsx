'use client';
import {assistantProviders,assistantProviderName,type AssistantProvider} from '../../../lib/team-assistant/providers';
import {VoiceInput} from './VoiceInput';
import {connector,serveBrowserTurns} from './browser-connector';
import {prepareImage,captureScreen,downloadPhoto,loadDraggedPhoto} from './media';
import {MAX_IMAGES} from '../../../lib/team-assistant/media';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {createPortal} from 'react-dom';
import {Send,Smile,ChevronDown,MessageCircle,Minus,Plus,Settings2,X,Square,Check,ExternalLink} from 'lucide-react';
import type {AssistantAction,AssistantStatus,AssistantImage,AssistantPhoto} from '../../../lib/team-assistant/types';
import {collectPageContext,applyFormAction,validateFormAction} from './page-context';
import './TeamAssistant.css';

const endpoint='/api/crm/assistant';
const currentPath=()=>location.pathname+location.search;
function links(text:string){return text.split(/(\[[^\]\n]{1,200}\]\([^\s)]+\))/g).map((part,i)=>{const m=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);if(!m)return part;const href=m[2];if(!/^https:\/\//i.test(href)&&!/^\/(?!\/|api\/)[^\\]*$/.test(href))return m[1];return <a key={i} href={href} {...(href.startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{m[1]}</a>;});}

export function TeamAssistant(){
 const pathname=usePathname(),privatePage=/^\/(crm|partner|account)(\/|$)/.test(pathname||'');
 const [status,setStatus]=useState<AssistantStatus|null>(null),[opened,setOpened]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[settings,setSettings]=useState(false),[withPage,setWithPage]=useState(true),[width,setWidth]=useState(420),[phrase,setPhrase]=useState(''),[newPhrase,setNewPhrase]=useState(''),[codeAction,setCodeAction]=useState('');
 const [images,setImages]=useState<AssistantImage[]>([]),[mediaBusy,setMediaBusy]=useState(false),[pagePhotos,setPagePhotos]=useState<AssistantPhoto[]>([]);
 const [browserConnected,setBrowserConnected]=useState(false),[connecting,setConnecting]=useState(false),[installHelp,setInstallHelp]=useState(false),[diagnostic,setDiagnostic]=useState(''),[checking,setChecking]=useState(false),[dragging,setDragging]=useState(false);
 const [provider,setProvider]=useState<AssistantProvider>('gpt'),[pendingText,setPendingText]=useState(''),[composeMenu,setComposeMenu]=useState<'attach'|'emoji'|null>(null);
 const providerName=provider==='gpt'&&status?.connected?'АвтоБот':assistantProviderName(provider);
 const connected=Boolean((provider==='gpt'&&status?.connected)||browserConnected);
 const fileInput=useRef<HTMLInputElement>(null),mediaLock=useRef(false),draggedPhoto=useRef<AssistantPhoto|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLTextAreaElement>(null),end=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null),fieldMaps=useRef(new Map<string,ReturnType<typeof collectPageContext>['elements']>()),opener=useRef<HTMLElement|null>(null),dragY=useRef<number|null>(null),userId=useRef('');
 async function refresh(){const r=await fetch(endpoint+'?path='+encodeURIComponent(currentPath()),{cache:'no-store'});if(r.status===401||r.status===403){controller.current?.abort();setStatus(null);setOpened(false);return;}const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось открыть помощника.');if(d.userId===userId.current)setStatus(d);}
 useEffect(()=>{
  let alive=true;
  const check=async()=>{try{const r=await fetch('/api/auth/me',{cache:'no-store'}),d=await r.json();if(!alive)return;const u=d.user;if(!u||!['owner','admin','manager'].includes(u.role)){controller.current?.abort();setStatus(null);setOpened(false);setImages([]);setPagePhotos([]);setBrowserConnected(false);userId.current='';return;}if(userId.current!==u.id){controller.current?.abort();setText('');setImages([]);setPagePhotos([]);setStatus(null);fieldMaps.current.clear();setBrowserConnected(false);userId.current=u.id;}await refresh();}catch{/* Public visitors never get a broken assistant control. */}};
  void check();const visible=()=>{if(!document.hidden)void check();};document.addEventListener('visibilitychange',visible);
  const hide=()=>setOpened(false);window.addEventListener('autobot-public-opening',hide);
  const show=()=>{opener.current=document.activeElement as HTMLElement;setOpened(true);void refresh().catch(e=>setError(e.message));};window.addEventListener('team-assistant-open',show);
  try{const saved=Number(localStorage.getItem('ac-assistant-width'));if(saved>=340&&saved<=640)setWidth(saved);}catch{}
  return()=>{alive=false;controller.current?.abort();document.removeEventListener('visibilitychange',visible);window.removeEventListener('team-assistant-open',show);window.removeEventListener('autobot-public-opening',hide);};
 },[]);
 useEffect(()=>{
  const d=dialog.current;if(!opened||!status||!d)return;
  const media=matchMedia('(max-width: 899px)'),oldOverflow=document.body.style.overflow,oldRootOverflow=document.documentElement.style.overflow;
  const sync=()=>{d.close();if(media.matches){d.showModal();document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';delete document.documentElement.dataset.teamAssistantOpen;}else{d.show();document.body.style.overflow=oldOverflow;document.documentElement.style.overflow=oldRootOverflow;document.documentElement.dataset.teamAssistantOpen='true';}};
  sync();media.addEventListener('change',sync);const t=setTimeout(()=>{if(!media.matches)input.current?.focus({preventScroll:true});},100);
  return()=>{clearTimeout(t);media.removeEventListener('change',sync);d.close();delete document.documentElement.dataset.teamAssistantOpen;document.body.style.overflow=oldOverflow;document.documentElement.style.overflow=oldRootOverflow;opener.current?.focus({preventScroll:true});};
 },[opened,Boolean(status)]);
 useEffect(()=>{document.documentElement.style.setProperty('--team-assistant-width',width+'px');try{localStorage.setItem('ac-assistant-width',String(width));}catch{}},[width]);
 useEffect(()=>{if(opened)end.current?.scrollIntoView({block:'nearest'});},[status?.messages.length,busy,opened]);
 useEffect(()=>{
  if(!opened)return;
  const start=(e:DragEvent)=>{const image=e.target;if(image instanceof HTMLImageElement&&!image.closest('[data-assistant-private]'))draggedPhoto.current={url:image.currentSrc||image.src,name:image.alt||'Фото со страницы'};};
  const finish=()=>{draggedPhoto.current=null;setDragging(false);};
  document.addEventListener('dragstart',start);document.addEventListener('dragend',finish);
  return()=>{document.removeEventListener('dragstart',start);document.removeEventListener('dragend',finish);draggedPhoto.current=null;};
 },[opened]);
 async function dropPhoto(e:React.DragEvent<HTMLDialogElement>){
  e.preventDefault();setDragging(false);const files=Array.from(e.dataTransfer.files),photo=draggedPhoto.current;draggedPhoto.current=null;
  if(busy||mediaLock.current)return;setSettings(false);setComposeMenu(null);
  if(files.length){await attach(files);return;}if(!photo)return;
  const account=userId.current;mediaLock.current=true;setMediaBusy(true);setError('');
  try{if(images.length>=MAX_IMAGES)throw Error('Можно прикрепить до четырёх изображений.');const prepared=await prepareImage(await loadDraggedPhoto(photo));if(userId.current===account)setImages(old=>[...old,prepared].slice(0,MAX_IMAGES));}
  catch(e){if(userId.current===account)setError(e instanceof Error?e.message:'Не удалось загрузить фото. Прикрепите его файлом.');}finally{mediaLock.current=false;setMediaBusy(false);}
 }
 async function connect(){
  if(connecting||busy)return;setConnecting(true);setError('');setInstallHelp(false);setDiagnostic('');
  try{const extension=await connector('ping').catch(e=>{setInstallHelp(true);throw e;});if(extension.version!=='1.0.5'){setInstallHelp(true);throw Error('Обновите расширение ИИ Бро до версии 1.0.5.');}await connector('connect',{userId:userId.current,provider});setBrowserConnected(true);setNotice(providerName+' подключён. Пишите здесь — ответ появится в этом чате.');}
  catch(e){setBrowserConnected(false);setError(e instanceof Error?e.message:'Не удалось подключиться.');}
  finally{setConnecting(false);}
 }
 useEffect(()=>{if(!status?.userId)return;let alive=true;void connector('ping').then(p=>p.version==='1.0.5'?connector('status',{userId:status.userId,provider}):{connected:false}).then(r=>{if(alive)setBrowserConnected(Boolean(r.connected));}).catch(()=>{});return()=>{alive=false;};},[status?.userId,provider]);
 async function checkConnection(){
  if(checking)return;setChecking(true);setDiagnostic('');
  try{const result=await connector('diagnose',{userId:userId.current,provider});setDiagnostic(JSON.stringify(result.diagnostic,null,2));}
  catch(e){setDiagnostic(e instanceof Error?e.message:'Проверка не завершена.');}finally{setChecking(false);}
 }
 function connectionControl(){if(status?.connected&&provider==='gpt')return <p className="ta-notice">Серверное подключение помощника активно.</p>;return <div className="ta-connection">{browserConnected?<><span>{providerName} подключён</span><button type="button" disabled={busy} onClick={()=>{void connector('disconnect',{userId:userId.current,provider}).catch(()=>{});setBrowserConnected(false);}}>Отключить</button></>:<button type="button" disabled={connecting||busy} onClick={()=>void connect()}>{connecting?'Соединяем…':'Подключить '+providerName}</button>}{(browserConnected||error)&&<button type="button" onClick={()=>void connector('open',{userId:userId.current,provider}).catch(e=>setError(e.message))}>Войти в {providerName}</button>}<button type="button" disabled={checking||connecting||busy} onClick={()=>void checkConnection()}>{checking?'Проверяем…':'Проверить соединение'}</button>{diagnostic&&<details className="ta-diagnostic" open><summary>Результат проверки</summary><pre>{diagnostic}</pre><button type="button" onClick={()=>void navigator.clipboard.writeText(diagnostic).then(()=>setNotice('Результат проверки скопирован.')).catch(()=>setError('Выделите и скопируйте результат проверки вручную.'))}>Скопировать</button></details>}{installHelp&&<p>Для связи с вкладкой нужно расширение ИИ Бро. <a href="/assistant-connect" target="_blank" rel="noopener noreferrer">Установить расширение</a>. После установки обновите эту страницу и нажмите «Подключить».</p>}</div>;}
 async function attach(files:File[]){
  if(mediaLock.current||busy)return;const account=userId.current;mediaLock.current=true;setMediaBusy(true);setError('');
  try{if(images.length+files.length>MAX_IMAGES)throw Error('Можно прикрепить до четырёх изображений.');const prepared=[];for(const file of files)prepared.push(await prepareImage(file));if(userId.current===account)setImages(old=>[...old,...prepared].slice(0,MAX_IMAGES));}
  catch(e){if(userId.current===account)setError(e instanceof Error?e.message:'Не удалось прикрепить фото.');}finally{mediaLock.current=false;setMediaBusy(false);}
 }
 async function screenshot(){
  if(mediaLock.current||busy||images.length>=MAX_IMAGES)return;const account=userId.current;mediaLock.current=true;setMediaBusy(true);setError('');
  try{const shot=await captureScreen();if(userId.current===account)setImages(old=>[...old,shot].slice(0,MAX_IMAGES));}
  catch(e){if(userId.current===account)setError(e instanceof Error&&e.name==='NotAllowedError'?'Выбор экрана отменён. Можно прикрепить готовый скриншот.':e instanceof Error?e.message:'Не удалось сделать снимок.');}finally{mediaLock.current=false;setMediaBusy(false);}
 }
 async function download(photo:AssistantPhoto){try{setError('');await downloadPhoto(photo);setNotice('Файл передан браузеру для скачивания.');}catch(e){setError(e instanceof Error?e.message:'Не удалось скачать. Откройте оригинал и сохраните фото.');}}
 function gallery(photos:AssistantPhoto[]){return <div className="ta-photos">{photos.map((p,i)=><figure key={p.url}><img src={p.url} alt={p.name} loading="lazy" referrerPolicy="no-referrer"/><figcaption>{p.name}</figcaption><button type="button" onClick={()=>void download(p)}>Скачать фото {i+1}</button><a href={p.url} target="_blank" rel="noopener noreferrer">Открыть оригинал</a></figure>)}</div>;}
 function close(){setComposeMenu(null);setOpened(false);setPhrase('');setNewPhrase('');setCodeAction('');}
 async function request(body:Record<string,unknown>){
  if(!status)throw Error('Войдите в аккаунт команды.');
  const account=userId.current;
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,revision:status.revision}),signal:controller.current?.signal});
  const d=await r.json();if(account!==userId.current)throw Error('Аккаунт изменился. Откройте помощника заново.');if(!r.ok){if(r.status===401||r.status===403)await refresh();throw Error(d.error||'Не удалось выполнить запрос.');}
  if(Array.isArray(d.messages))setStatus(s=>s?{...s,messages:d.messages,revision:d.revision}:s);return d;
 }
 async function togglePageControl(enabled:boolean){if(busy)return;setBusy(true);setError('');try{const d=await request({op:'page_control',enabled});fieldMaps.current.clear();setStatus(s=>s?{...s,pageControl:d.pageControl}:s);setNotice(enabled?'Помощник может предложить заполнение полей и переход. Каждое действие нужно подтвердить.':'Помощь с формами отключена.');}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить настройку.');}finally{setBusy(false);}}
 async function send(){if(busy||mediaLock.current||(!text.trim()&&!images.length)||!connected)return;setComposeMenu(null);setBusy(true);setPendingText(text.trim()||'Прикреплённые изображения');setError('');setNotice('');controller.current=new AbortController();const captured=collectPageContext(withPage,Boolean(status?.pageControl&&status?.canControlPage));
  let bridgeError='';
  const channel=browserConnected?crypto.randomUUID():undefined,bridge=new AbortController();
  const pump=channel?serveBrowserTurns(channel,userId.current,bridge.signal,provider).catch(e=>{if(!bridge.signal.aborted){bridgeError=e.message;controller.current?.abort();setBrowserConnected(false);}}):Promise.resolve();
  try{const d=await request({op:'message',provider,browserChannel:channel,text:text.trim()||'Посмотри прикреплённые изображения.',images,context:captured.context});for(const m of (d.messages||[]).slice(-1))for(const a of m.actions||[])if(a.kind==='fill')fieldMaps.current.set(a.id,captured.elements);setText('');setImages([]);}
  catch(e){setError(bridgeError|| (e instanceof Error&&e.name==='AbortError'?'Запрос остановлен.':e instanceof Error?e.message:'Не удалось получить ответ.'));void refresh().catch(()=>{});}
  finally{bridge.abort();void pump;setPendingText('');setBusy(false);controller.current=null;}
 }
 async function apply(action:AssistantAction,newTab=false){if(busy)return;const target=action.kind==='navigate'&&newTab?window.open('about:blank','_blank'):null;if(target)target.opener=null;setBusy(true);setError('');setNotice('');controller.current=new AbortController();
  try{
   if(action.kind==='fill'&&!fieldMaps.current.has(action.id))throw Error('Чтобы заполнить эту форму, попросите помощника подготовить поля заново.');
   if(action.kind==='fill')validateFormAction(action,fieldMaps.current.get(action.id)!);
   const d=await request({op:'action',id:action.id,path:currentPath(),...(action.kind==='code'?{phrase}:{})});
   if(action.kind==='navigate'){if(newTab&&!target)throw Error('Браузер заблокировал новую вкладку. Разрешите её открытие.');const destination=d.action.destination;if(typeof destination!=='string'||!destination.startsWith('/')||destination.startsWith('//'))throw Error('Недопустимый адрес.');if(target)target.location.replace(destination);else location.assign(destination);}
   else if(action.kind==='fill'){applyFormAction(d.action,fieldMaps.current.get(action.id)!);setNotice('Поля заполнены. Проверьте их и сохраните форму обычной кнопкой.');}
   else{setNotice('Правки подготовлены в отдельной ветке. Сайт пока не изменён.');setCodeAction('');setPhrase('');}
  }catch(e){target?.close();setError(e instanceof Error?e.message:'Не удалось выполнить действие.');void refresh().catch(()=>{});}finally{setBusy(false);controller.current=null;}
 }
 async function updatePhrase(){if(busy)return;setBusy(true);setError('');try{await request({op:'phrase',current:phrase,next:newPhrase});setPhrase('');setNewPhrase('');setNotice('Кодовая фраза изменена.');}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить.');}finally{setBusy(false);}}
 function resize(e:React.PointerEvent<HTMLDivElement>){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const move=(p:PointerEvent)=>setWidth(Math.min(640,Math.max(340,Math.min(innerWidth-440,innerWidth-p.clientX))));const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});}
 if(!status)return null;
 const renderAction=(a:AssistantAction)=><div className="ta-action" key={a.id}>
  <strong>{a.summary}</strong>
  {a.fields?.map(f=><div className="ta-field" key={f.id}><span>{f.label}</span><del>{f.before||'Не заполнено'}</del><b>{f.value||'Очистить'}</b></div>)}
  {a.files?.map(f=><details key={f.path}><summary>{f.path}</summary><p>Было</p><pre>{f.before}</pre><p>Станет</p><pre>{f.after}</pre></details>)}
  {a.status==='done'?<p className="ta-done"><Check size={16}/>{a.kind==='navigate'?'Переход подтверждён':a.kind==='fill'?'Передано в форму':a.url?<a href={a.url} target="_blank" rel="noopener noreferrer">Открыть подготовленные правки <ExternalLink size={13}/></a>:'Правки подготовлены'}</p>:a.kind==='navigate'?<><p>{a.destination}</p><button type="button" disabled={busy||!status.pageControl} onClick={()=>void apply(a)}>Перейти</button><button type="button" disabled={busy||!status.pageControl} onClick={()=>void apply(a,true)}>Открыть в новой вкладке</button></>:a.kind==='fill'?<button type="button" disabled={busy||!status.pageControl} onClick={()=>void apply(a)}>Заполнить эти поля</button>:<>
   <p>Отдельная ветка для проверки. Установка на сайт — после проверки.</p>
   {codeAction===a.id?<><label>Кодовая фраза<input type="password" autoComplete="off" value={phrase} maxLength={120} onChange={e=>setPhrase(e.target.value)}/></label><button type="button" disabled={busy||!phrase||!status.codeConnected} onClick={()=>void apply(a)}>Подтвердить правки</button></>:<button type="button" disabled={busy||!status.codeConnected} onClick={()=>{setCodeAction(a.id);setPhrase('');}}>Подготовить правки</button>}
   {!status.codeConnected&&<p>Владелец ещё не подключил репозиторий.</p>}
  </>}
 </div>;
 return <>
  {!opened&&privatePage&&<button type="button" data-team-assistant className="ta-fab" aria-label="Открыть ИИ-помощника" onClick={e=>{opener.current=e.currentTarget;setOpened(true);void refresh().catch(e=>setError(e.message));}}><MessageCircle size={21}/><span>Помощник</span></button>}
  {opened&&createPortal(<dialog ref={dialog} data-team-assistant className="ta-panel" aria-labelledby="ta-title" onDragOver={e=>{if(draggedPhoto.current||Array.from(e.dataTransfer.types).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=busy||mediaBusy?'none':'copy';setDragging(!busy&&!mediaBusy);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDragging(false);}} onDrop={e=>void dropPhoto(e)} onCancel={e=>{e.preventDefault();close();}}>
   {dragging&&<div className="ta-drop-hint" role="status">Отпустите фото, чтобы прикрепить его</div>}
   <div className="ta-resize" role="separator" tabIndex={0} aria-label="Ширина помощника" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={640} aria-valuenow={width} onPointerDown={resize} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setWidth(w=>Math.max(340,Math.min(640,w+(e.key==='ArrowLeft'?20:-20))));}}}/>
   <button type="button" className="ta-handle" aria-label="Свернуть помощника вниз" onClick={close} onPointerDown={e=>{dragY.current=e.clientY;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(dragY.current!==null&&e.clientY-dragY.current>65)close();dragY.current=null;}} onPointerCancel={()=>{dragY.current=null;}}><span/></button>
   <header className="ta-header"><img src="/avatars/gpt-assistant.svg" alt="" width={34} height={34}/><div><h2 id="ta-title">ИИ Бро</h2><span>Топ Авто · личный чат</span></div><div className="ta-toolbar"><button aria-label="Настройки помощника" title="Настройки" onClick={()=>setSettings(v=>!v)}><Settings2 size={18}/></button><button aria-label="Свернуть помощника" title="Свернуть" onClick={close}><Minus size={19}/></button><button aria-label="Закрыть помощника" title="Закрыть" onClick={close}><X size={19}/></button></div></header>
   <div className="ta-contextbar"><span>{connected?providerName+' · личный чат':'Подключите '+providerName}</span><button title="Новая переписка" aria-label="Начать новую переписку" disabled={busy||!status.messages.length} onClick={async()=>{if(!confirm('Очистить вашу переписку с помощником?'))return;try{await request({op:'reset'});void connector('disconnect',{userId:userId.current,provider}).catch(()=>{});setBrowserConnected(false);fieldMaps.current.clear();setImages([]);setPagePhotos([]);}catch(e){setError(e instanceof Error?e.message:'Не удалось очистить.');}}}><Plus size={18}/></button></div>
   {!status.connected&&<div className="ta-providers" role="group" aria-label="Кому написать">{assistantProviders.map(p=><button key={p.id} type="button" aria-label={'Написать '+p.name} aria-pressed={provider===p.id} disabled={busy||connecting} onClick={()=>{if(provider===p.id)return;setProvider(p.id);setDiagnostic('');setBrowserConnected(false);setError('');setNotice('');setInstallHelp(false);}}><span className={'ta-provider-icon ta-provider-'+p.id} aria-hidden="true">{p.id==='gpt'?<img src="/brands/openai.svg" alt=""/>:<img src={'/brands/'+(p.id==='googleai'?'google':p.id)+'.svg'} alt=""/>}</span><span>{p.name}</span></button>)}</div>}
   <div className="ta-messages" role="log" aria-label="Переписка с помощником" aria-live="polite">
    {settings?<section className="ta-settings" data-assistant-private><h3>Настройки помощника</h3>{status.canControlPage&&<><label className="ta-share"><input type="checkbox" role="switch" checked={status.pageControl} disabled={busy} onChange={e=>void togglePageControl(e.target.checked)}/>Помощь с формами и переходами</label><p>Помощник увидит доступные поля открытой страницы и сможет предложить заполнение или переход по ссылке. Вы подтверждаете каждое действие. Сохранение формы — обычной кнопкой страницы.</p></>}{status.owner&&<a href="/crm/site/autobot">Подключение АвтоБота и расходы →</a>}<p>Чат виден только вам. Помощник работает с вашей открытой страницей и доступными вам записями.</p><p>Выберите помощника и подключите свой аккаунт в этом браузере. Ответы всех помощников отображаются здесь. Сообщения, выбранный контекст и вложения передаются выбранному сервису; для входа можно открыть его окно.</p>{connectionControl()}{status.owner&&<><h3>Кодовая фраза</h3><label>Текущая фраза<input type="password" autoComplete="off" maxLength={120} value={phrase} onChange={e=>setPhrase(e.target.value)}/></label><label>Новая фраза<input type="password" autoComplete="new-password" maxLength={120} value={newPhrase} onChange={e=>setNewPhrase(e.target.value)}/></label><button disabled={busy||!phrase||newPhrase.trim().length<8} onClick={()=>void updatePhrase()}>Сохранить фразу</button></>}<p>Право изменения оформления назначается в «Команда и права». Кодовая фраза вводится отдельно от переписки.</p><button onClick={()=>{setSettings(false);setPhrase('');setNewPhrase('');}}>Вернуться к чату</button></section>:<>
     {!status.messages.length&&<div className="ta-welcome"><img src="/avatars/gpt-assistant.svg" alt="" width={52} height={52}/><h3>Бро, чем помочь?</h3><p>Найти автомобиль, разобраться в характеристиках или подготовить заполнение формы.</p><div className="ta-suggestions">{['Найди Kia K5 до 160 л. с.','Помоги заполнить открытую форму','Объясни, что на этой странице'].map(s=><button key={s} onClick={()=>{setText(s);input.current?.focus();}}>{s}<span aria-hidden="true">↗</span></button>)}</div></div>}
     {status.messages.map(m=><article key={m.id} className={'ta-message ta-'+m.role}><div className="ta-author">{m.role==='user'?'Вы → '+assistantProviderName(m.provider):assistantProviderName(m.provider)}<time>{new Date(m.at).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</time></div><div className="ta-text">{links(m.text)}</div>{m.imageNames?.length?<p className="ta-image-names">Прикреплено: {m.imageNames.join(', ')}. Для повторного просмотра прикрепите заново.</p>:null}{m.photos?.length?gallery(m.photos):null}{m.sources?.length?<div className="ta-sources">{m.sources.map((s,i)=><a key={i} href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a>)}</div>:null}{m.actions?.map(renderAction)}</article>)}
     {pendingText&&<article className="ta-message ta-user"><div className="ta-author">Вы → {providerName}</div><div className="ta-text">{pendingText}</div></article>}{busy&&<p className="ta-thinking" role="status">{providerName} отвечает…</p>}
    </>}
    {pagePhotos.length>0&&<section><h3>Фото текущей страницы</h3>{gallery(pagePhotos)}<button type="button" onClick={()=>setPagePhotos([])}>Скрыть фотографии</button></section>}
    <div ref={end}/>
   </div>
   {error&&<div className="ta-error" role="alert">{error}</div>}{notice&&<div className="ta-notice" role="status">{notice}</div>}
   {!settings&&<footer className="ta-compose">{!connected&&connectionControl()}<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void attach(files);}}/>{composeMenu&&<div className="ta-compose-popover" onKeyDown={e=>{if(e.key==='Escape'){setComposeMenu(null);input.current?.focus();}}}>{composeMenu==='attach'?<><button type="button" disabled={busy||mediaBusy||images.length>=MAX_IMAGES} onClick={()=>{setComposeMenu(null);fileInput.current?.click();}}>Прикрепить фото</button><button type="button" disabled={busy||mediaBusy||images.length>=MAX_IMAGES} onClick={()=>{setComposeMenu(null);void screenshot();}}>Снимок экрана</button><button type="button" onClick={()=>{setComposeMenu(null);const photos=collectPageContext(true).context.photos||[];setPagePhotos(photos);if(!photos.length)setNotice('На странице не найдены фотографии для скачивания.');}}>Фото страницы</button><label className="ta-share"><input type="checkbox" checked={withPage} onChange={e=>setWithPage(e.target.checked)}/>Учитывать открытую страницу</label></>:<div className="ta-emoji-grid" role="group" aria-label="Смайлики">{['😀','😅','😉','😎','👍','🙏','❤️','🔥','🚗','✅','🤝','🎉'].map(emoji=><button type="button" key={emoji} aria-label={'Вставить '+emoji} onClick={()=>{const field=input.current,start=field?.selectionStart??text.length,end=field?.selectionEnd??text.length;setText((text.slice(0,start)+emoji+text.slice(end)).slice(0,6000));setComposeMenu(null);requestAnimationFrame(()=>{field?.focus();field?.setSelectionRange(start+emoji.length,start+emoji.length);});}}>{emoji}</button>)}</div>}</div>}{images.length>0&&<div className="ta-attachments">{images.map((im,i)=><figure key={i}><img src={im.dataUrl} alt={im.name}/><button type="button" disabled={mediaBusy||busy} aria-label={'Удалить изображение '+(i+1)} onClick={()=>setImages(v=>v.filter((_,n)=>n!==i))}>×</button><figcaption>{im.name}</figcaption></figure>)}</div>}{mediaBusy&&<p role="status">Подготовка изображения…</p>}<form onPaste={e=>{const files=Array.from(e.clipboardData.files).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();void attach(files);}}} onSubmit={e=>{e.preventDefault();void send();}}><button type="button" className="ta-compose-tool" aria-label="Вложения и контекст" title="Вложения и контекст" aria-expanded={composeMenu==='attach'} disabled={busy} onClick={()=>setComposeMenu(m=>m==='attach'?null:'attach')}><Plus size={19}/></button><button type="button" className="ta-compose-tool" aria-label="Смайлики" title="Смайлики" aria-expanded={composeMenu==='emoji'} disabled={busy} onClick={()=>setComposeMenu(m=>m==='emoji'?null:'emoji')}><Smile size={18}/></button><textarea ref={input} onFocus={()=>setComposeMenu(null)} aria-label="Сообщение помощнику" placeholder={'Написать '+providerName+'…'} value={text} maxLength={6000} rows={1} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&matchMedia('(min-width: 900px)').matches){e.preventDefault();void send();}}}/><VoiceInput disabled={busy||mediaBusy} onText={value=>setText(t=>(t+(t.trim()?' ':'')+value).slice(0,6000))} onError={setError}/>{busy?<button type="button" aria-label="Остановить ответ" onClick={()=>controller.current?.abort()}><Square size={17}/></button>:<button type="submit" aria-label="Отправить сообщение" disabled={(!text.trim()&&!images.length)||!connected||mediaBusy}><Send size={18}/></button>}</form><p className="ta-footnote">Проверьте предложенные данные перед сохранением.</p></footer>}
   <button type="button" className="ta-mobile-close" onClick={close}><ChevronDown size={18}/>Свернуть</button>
  </dialog>,document.body)}
 </>;
}
