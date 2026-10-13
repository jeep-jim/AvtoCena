'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUp,ChevronDown,MessageCircle,Minus,Plus,Settings2,X,Square,Check,ExternalLink} from 'lucide-react';
import type {AssistantAction,AssistantStatus} from '../../../lib/team-assistant/types';
import {collectPageContext,applyFormAction,validateFormAction} from './page-context';
import './TeamAssistant.css';

const endpoint='/api/crm/assistant';
const currentPath=()=>location.pathname+location.search;
function links(text:string){return text.split(/(\[[^\]\n]{1,200}\]\([^\s)]+\))/g).map((part,i)=>{const m=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);if(!m)return part;const href=m[2];if(!/^https:\/\//i.test(href)&&!/^\/(?!\/|api\/)[^\\]*$/.test(href))return m[1];return <a key={i} href={href} {...(href.startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{m[1]}</a>;});}

export function TeamAssistant(){
 const [status,setStatus]=useState<AssistantStatus|null>(null),[opened,setOpened]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[settings,setSettings]=useState(false),[withPage,setWithPage]=useState(true),[width,setWidth]=useState(420),[phrase,setPhrase]=useState(''),[newPhrase,setNewPhrase]=useState(''),[codeAction,setCodeAction]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLTextAreaElement>(null),end=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null),fieldMaps=useRef(new Map<string,ReturnType<typeof collectPageContext>['elements']>()),opener=useRef<HTMLElement|null>(null),dragY=useRef<number|null>(null),userId=useRef('');
 async function refresh(){const r=await fetch(endpoint+'?path='+encodeURIComponent(currentPath()),{cache:'no-store'});if(r.status===401||r.status===403){setStatus(null);setOpened(false);return;}const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось открыть помощника.');if(d.userId===userId.current)setStatus(d);}
 useEffect(()=>{
  let alive=true;
  const check=async()=>{try{const r=await fetch('/api/auth/me',{cache:'no-store'}),d=await r.json();if(!alive)return;const u=d.user;if(!u||!['owner','admin','manager'].includes(u.role)){controller.current?.abort();setStatus(null);setOpened(false);userId.current='';return;}if(userId.current!==u.id){controller.current?.abort();setText('');setStatus(null);fieldMaps.current.clear();userId.current=u.id;}await refresh();}catch{/* Public visitors never get a broken assistant control. */}};
  void check();const visible=()=>{if(!document.hidden)void check();};document.addEventListener('visibilitychange',visible);
  const show=()=>{opener.current=document.activeElement as HTMLElement;setOpened(true);void refresh().catch(e=>setError(e.message));};window.addEventListener('team-assistant-open',show);
  try{const saved=Number(localStorage.getItem('ac-assistant-width'));if(saved>=340&&saved<=640)setWidth(saved);}catch{}
  return()=>{alive=false;controller.current?.abort();document.removeEventListener('visibilitychange',visible);window.removeEventListener('team-assistant-open',show);};
 },[]);
 useEffect(()=>{
  const d=dialog.current;if(!opened||!status||!d)return;
  const media=matchMedia('(max-width: 899px)'),oldOverflow=document.body.style.overflow;
  const sync=()=>{d.close();if(media.matches){d.showModal();document.body.style.overflow='hidden';delete document.documentElement.dataset.teamAssistantOpen;}else{d.show();document.body.style.overflow=oldOverflow;document.documentElement.dataset.teamAssistantOpen='true';}};
  sync();media.addEventListener('change',sync);const t=setTimeout(()=>input.current?.focus(),100);
  return()=>{clearTimeout(t);media.removeEventListener('change',sync);d.close();delete document.documentElement.dataset.teamAssistantOpen;document.body.style.overflow=oldOverflow;opener.current?.focus();};
 },[opened,Boolean(status)]);
 useEffect(()=>{document.documentElement.style.setProperty('--team-assistant-width',width+'px');try{localStorage.setItem('ac-assistant-width',String(width));}catch{}},[width]);
 useEffect(()=>{if(opened)end.current?.scrollIntoView({block:'nearest'});},[status?.messages.length,busy,opened]);
 function close(){setOpened(false);setPhrase('');setNewPhrase('');setCodeAction('');}
 async function request(body:Record<string,unknown>){
  if(!status)throw Error('Войдите в аккаунт команды.');
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,revision:status.revision}),signal:controller.current?.signal});
  const d=await r.json();if(!r.ok){if(r.status===401||r.status===403)await refresh();throw Error(d.error||'Не удалось выполнить запрос.');}
  if(Array.isArray(d.messages))setStatus(s=>s?{...s,messages:d.messages,revision:d.revision}:s);return d;
 }
 async function send(){if(busy||!text.trim()||!status?.connected)return;setBusy(true);setError('');setNotice('');controller.current=new AbortController();const captured=collectPageContext(withPage);
  try{const d=await request({op:'message',text,context:captured.context});for(const m of (d.messages||[]).slice(-1))for(const a of m.actions||[])if(a.kind==='fill')fieldMaps.current.set(a.id,captured.elements);setText('');}
  catch(e){setError(e instanceof Error&&e.name==='AbortError'?'Запрос остановлен.':e instanceof Error?e.message:'Не удалось получить ответ.');void refresh().catch(()=>{});}
  finally{setBusy(false);controller.current=null;}
 }
 async function apply(action:AssistantAction){if(busy)return;setBusy(true);setError('');setNotice('');controller.current=new AbortController();
  try{
   if(action.kind==='fill'&&!fieldMaps.current.has(action.id))throw Error('Чтобы заполнить эту форму, попросите помощника подготовить поля заново.');
   if(action.kind==='fill')validateFormAction(action,fieldMaps.current.get(action.id)!);
   const d=await request({op:'action',id:action.id,path:currentPath(),...(action.kind==='code'?{phrase}:{})});
   if(action.kind==='fill'){applyFormAction(d.action,fieldMaps.current.get(action.id)!);setNotice('Поля заполнены. Проверьте их и сохраните форму обычной кнопкой.');}
   else{setNotice('Правки подготовлены в отдельной ветке. Сайт пока не изменён.');setCodeAction('');setPhrase('');}
  }catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие.');void refresh().catch(()=>{});}finally{setBusy(false);controller.current=null;}
 }
 async function updatePhrase(){if(busy)return;setBusy(true);setError('');try{await request({op:'phrase',current:phrase,next:newPhrase});setPhrase('');setNewPhrase('');setNotice('Кодовая фраза изменена.');}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить.');}finally{setBusy(false);}}
 function resize(e:React.PointerEvent<HTMLDivElement>){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const move=(p:PointerEvent)=>setWidth(Math.min(640,Math.max(340,Math.min(innerWidth-440,innerWidth-p.clientX))));const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});}
 if(!status)return null;
 const renderAction=(a:AssistantAction)=><div className="ta-action" key={a.id}>
  <strong>{a.summary}</strong>
  {a.fields?.map(f=><div className="ta-field" key={f.id}><span>{f.label}</span><del>{f.before||'Не заполнено'}</del><b>{f.value||'Очистить'}</b></div>)}
  {a.files?.map(f=><details key={f.path}><summary>{f.path}</summary><p>Было</p><pre>{f.before}</pre><p>Станет</p><pre>{f.after}</pre></details>)}
  {a.status==='done'?<p className="ta-done"><Check size={16}/>{a.kind==='fill'?'Передано в форму':a.url?<a href={a.url} target="_blank" rel="noopener noreferrer">Открыть подготовленные правки <ExternalLink size={13}/></a>:'Правки подготовлены'}</p>:a.kind==='fill'?<button type="button" disabled={busy} onClick={()=>void apply(a)}>Заполнить эти поля</button>:<>
   <p>Отдельная ветка для проверки. Установка на сайт — после проверки.</p>
   {codeAction===a.id?<><label>Кодовая фраза<input type="password" autoComplete="off" value={phrase} maxLength={120} onChange={e=>setPhrase(e.target.value)}/></label><button type="button" disabled={busy||!phrase||!status.codeConnected} onClick={()=>void apply(a)}>Подтвердить правки</button></>:<button type="button" disabled={busy||!status.codeConnected} onClick={()=>{setCodeAction(a.id);setPhrase('');}}>Подготовить правки</button>}
   {!status.codeConnected&&<p>Владелец ещё не подключил репозиторий.</p>}
  </>}
 </div>;
 return <>
  {!opened&&<button type="button" data-team-assistant className="ta-fab" aria-label="Открыть ИИ-помощника" onClick={e=>{opener.current=e.currentTarget;setOpened(true);void refresh().catch(e=>setError(e.message));}}><MessageCircle size={21}/><span>Помощник</span></button>}
  {opened&&createPortal(<dialog ref={dialog} data-team-assistant className="ta-panel" aria-labelledby="ta-title" onCancel={e=>{e.preventDefault();close();}}>
   <div className="ta-resize" role="separator" tabIndex={0} aria-label="Ширина помощника" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={640} aria-valuenow={width} onPointerDown={resize} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setWidth(w=>Math.max(340,Math.min(640,w+(e.key==='ArrowLeft'?20:-20))));}}}/>
   <button type="button" className="ta-handle" aria-label="Свернуть помощника вниз" onClick={close} onPointerDown={e=>{dragY.current=e.clientY;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(dragY.current!==null&&e.clientY-dragY.current>65)close();dragY.current=null;}}><span/></button>
   <header className="ta-header"><img src="/avatars/gpt-assistant.svg" alt="" width={34} height={34}/><div><h2 id="ta-title">Помощник команды</h2><span>Топ Авто · личный чат</span></div><div className="ta-toolbar"><button aria-label="Настройки помощника" title="Настройки" onClick={()=>setSettings(v=>!v)}><Settings2 size={18}/></button><button aria-label="Свернуть помощника" title="Свернуть" onClick={close}><Minus size={19}/></button><button aria-label="Закрыть помощника" title="Закрыть" onClick={close}><X size={19}/></button></div></header>
   <div className="ta-contextbar"><span>{status.connected?'ChatGPT · чат команды':'Ожидает подключения ChatGPT'}</span><button title="Новая переписка" aria-label="Начать новую переписку" disabled={busy||!status.messages.length} onClick={async()=>{if(!confirm('Очистить вашу переписку с помощником?'))return;try{await request({op:'reset'});fieldMaps.current.clear();}catch(e){setError(e instanceof Error?e.message:'Не удалось очистить.');}}}><Plus size={18}/></button></div>
   <div className="ta-messages" role="log" aria-label="Переписка с помощником" aria-live="polite">
    {settings?<section className="ta-settings" data-assistant-private><h3>Настройки помощника</h3><p>Чат виден только вам. Помощник работает с вашей открытой страницей и доступными вам записями.</p><p>{status.connected?'Подключение настроено.':'Для ответов нужно завершить отдельное подключение ChatGPT. Вход в ChatGPT в другой вкладке не подключает этот чат.'}</p>{status.owner&&<><p>Общий доступ команды должен быть разрешён выбранным подключением. Личная подписка автоматически на сотрудников не распространяется.</p><a href="https://developers.openai.com/siwc/token-sharing-open-source" target="_blank" rel="noopener noreferrer">Способы подключения ChatGPT ↗</a><h3>Кодовая фраза</h3><label>Текущая фраза<input type="password" autoComplete="off" maxLength={120} value={phrase} onChange={e=>setPhrase(e.target.value)}/></label><label>Новая фраза<input type="password" autoComplete="new-password" maxLength={120} value={newPhrase} onChange={e=>setNewPhrase(e.target.value)}/></label><button disabled={busy||!phrase||newPhrase.trim().length<8} onClick={()=>void updatePhrase()}>Сохранить фразу</button></>}<p>Право изменения оформления назначается в «Команда и права». Кодовая фраза вводится отдельно от переписки.</p><button onClick={()=>{setSettings(false);setPhrase('');setNewPhrase('');}}>Вернуться к чату</button></section>:<>
     {!status.messages.length&&<div className="ta-welcome"><img src="/avatars/gpt-assistant.svg" alt="" width={52} height={52}/><h3>Бро, чем помочь?</h3><p>Найти автомобиль, разобраться в характеристиках или подготовить заполнение формы.</p><div className="ta-suggestions">{['Найди Kia K5 до 160 л. с.','Помоги заполнить открытую форму','Объясни, что на этой странице'].map(s=><button key={s} onClick={()=>{setText(s);input.current?.focus();}}>{s}<span aria-hidden="true">↗</span></button>)}</div></div>}
     {status.messages.map(m=><article key={m.id} className={'ta-message ta-'+m.role}><div className="ta-author">{m.role==='user'?'Вы':'Помощник'}<time>{new Date(m.at).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</time></div><div className="ta-text">{links(m.text)}</div>{m.sources?.length?<div className="ta-sources">{m.sources.map((s,i)=><a key={i} href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a>)}</div>:null}{m.actions?.map(renderAction)}</article>)}
     {busy&&<p className="ta-thinking" role="status">Помощник разбирается в задаче…</p>}
    </>}
    <div ref={end}/>
   </div>
   {error&&<div className="ta-error" role="alert">{error}</div>}{notice&&<div className="ta-notice" role="status">{notice}</div>}
   {!settings&&<footer className="ta-compose"><label className="ta-share"><input type="checkbox" checked={withPage} onChange={e=>setWithPage(e.target.checked)}/>Учитывать открытую страницу</label>{!status.connected&&<p className="ta-offline">Подключение ещё не завершено. Ответы появятся после авторизации владельцем.</p>}<form onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={input} aria-label="Сообщение помощнику" placeholder="Бро, помоги…" value={text} maxLength={6000} rows={2} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&matchMedia('(min-width: 900px)').matches){e.preventDefault();void send();}}}/>{busy?<button type="button" aria-label="Остановить ответ" onClick={()=>controller.current?.abort()}><Square size={17}/></button>:<button type="submit" aria-label="Отправить сообщение" disabled={!text.trim()||!status.connected}><ArrowUp size={20}/></button>}</form><p className="ta-footnote">Проверьте предложенные данные перед сохранением.</p></footer>}
   <button type="button" className="ta-mobile-close" onClick={close}><ChevronDown size={18}/>Свернуть</button>
  </dialog>,document.body)}
 </>;
}
