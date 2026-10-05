'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal,flushSync} from 'react-dom';
import type {GameMode,GameResult} from '@/lib/crm-game';
import './pognali.css';
type TeamRow={id:string;name:string;avatar?:string;best:Partial<Record<GameMode,GameResult>>};
const modes:Record<GameMode,string>={hills:'Холмы',battle:'Боевая гонка'};
class GameRequestError extends Error{constructor(message:string,public status:number){super(message);}}
async function gameRequest(body?:object){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{
  let response:Response;
  try{response=await fetch('/api/account/game',{cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});}
  catch{throw Error('Нет соединения. Проверьте интернет и попробуйте ещё раз.');}
  if(!response.ok){const messages:Record<number,string>={401:'Сессия завершилась. Войдите в кабинет снова.',403:'Не удалось подтвердить доступ к игре.',400:'Не удалось подтвердить результат заезда.',409:'Заезд уже завершён или устарел. Начните новый заезд.',429:'Подождите несколько секунд перед новым заездом.'};throw new GameRequestError(messages[response.status]||'Игра временно недоступна. Попробуйте ещё раз.',response.status);}
  try{return await response.json();}catch{throw Error('Не удалось получить ответ. Попробуйте ещё раз.');}
 }finally{clearTimeout(timeout);}
}

export function PognaliArena({user,userId}:{user:{name:string;avatar?:string};userId:string}){
 const frame=useRef<HTMLIFrameElement>(null),active=useRef<string|null>(null),busy=useRef(false),pending=useRef<Record<string,unknown>|null>(null);
 const overlay=useRef<HTMLDivElement>(null),launchButton=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 const close=useCallback(()=>{setOpened(false);active.current=null;},[]);
 const open=()=>{
  flushSync(()=>setOpened(true));
  const element=overlay.current;
  if(element?.requestFullscreen&&window.matchMedia('(pointer: coarse)').matches){
   void element.requestFullscreen().then(async()=>{
    if(overlay.current!==element){if(document.fullscreenElement===element)await document.exitFullscreen();return;}
    const orientation=screen.orientation as ScreenOrientation & {lock?:(mode:string)=>Promise<void>};
    await orientation?.lock?.('landscape');
   }).catch(()=>{});
  }
 };
 const [playerId,setPlayerId]=useState(userId);
 const [opened,setOpened]=useState(false),[team,setTeam]=useState<TeamRow[]>([]),[mode,setMode]=useState<GameMode>('hills'),[notice,setNotice]=useState(''),[retry,setRetry]=useState(false),[loading,setLoading]=useState(false);
 const refresh=useCallback(async()=>{setLoading(true);try{const data=await gameRequest();setTeam(data.team);setPlayerId(data.playerId||userId);setNotice('');}catch(e){setNotice(e instanceof Error?e.message:'Не удалось обновить рейтинг');}finally{setLoading(false);}},[userId]);
 useEffect(()=>{void refresh();},[refresh]);
 const send=useCallback((data:object)=>frame.current?.contentWindow?.postMessage({game:'pognali-v1',...data},'*'),[]);
 const save=useCallback(async()=>{
  if(!pending.current||busy.current)return;busy.current=true;setRetry(false);setNotice('Сохраняем результат…');
  try{const data=await gameRequest(pending.current);pending.current=null;active.current=null;await refresh();setNotice(`Сохранено: ${data.result.score.toLocaleString('ru-RU')} очков`);send({type:'saved',score:data.result.score});}
  catch(e){const canRetry=!(e instanceof GameRequestError&&[400,401,403,409].includes(e.status));setRetry(canRetry);if(!canRetry){pending.current=null;active.current=null;}setNotice(e instanceof Error?e.message:'Не удалось сохранить результат');send({type:'save-error',message:e instanceof Error?e.message:'Не удалось сохранить результат',canRetry});}
  finally{busy.current=false;}
 },[refresh,send]);
 useEffect(()=>{
  if(!opened)return;
  const element=overlay.current,bodyOverflow=document.body.style.overflow,rootOverflow=document.documentElement.style.overflow;
  document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
  const siblings=Array.from(document.body.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==element);
  const inert=siblings.map(node=>node.inert);siblings.forEach(node=>{node.inert=true;});
  closeButton.current?.focus();
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};
  window.addEventListener('keydown',keydown);
  return()=>{
   window.removeEventListener('keydown',keydown);
   document.body.style.overflow=bodyOverflow;document.documentElement.style.overflow=rootOverflow;
   siblings.forEach((node,i)=>{node.inert=inert[i];});
   if(document.fullscreenElement===element)void document.exitFullscreen().catch(()=>{});
   try{screen.orientation?.unlock?.();}catch{}
   launchButton.current?.focus();
  };
 },[opened,close]);
 useEffect(()=>{
  if(!opened)return;
  const receive=async(event:MessageEvent)=>{
   if(event.source!==frame.current?.contentWindow||event.data?.game!=='pognali-v1')return;
   const data=event.data;
   if(data.type==='ready'){send({type:'user',user});return;}
   if(data.type==='exit'){close();return;}
   if(data.type==='retry-save'){void save();return;}
   if(data.type==='start'){
    if(busy.current){send({type:'start-error',message:'Сохраняем результат. Попробуйте ещё раз через несколько секунд.'});return;}
    if(pending.current){send({type:'start-error',message:'Сначала сохраните предыдущий результат кнопкой над игрой.'});return;}
    busy.current=true;
    try{const result=await gameRequest({action:'start',mode:data.mode});active.current=result.run.id;setMode(result.run.mode);send({type:'started',id:result.run.id});setNotice('');}
    catch(e){send({type:'start-error',message:e instanceof Error?e.message:'Не удалось начать заезд. Попробуйте ещё раз.'});}
    finally{busy.current=false;}
   }
   if(data.type==='finish'&&data.id===active.current&&!pending.current){pending.current={action:'finish',runId:active.current,distance:data.distance,coins:data.coins,kills:data.kills,duration:data.duration};void save();}
  };
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[opened,user,send,save,close]);
 const ranked=team.filter(row=>row.best[mode]).sort((a,b)=>b.best[mode]!.score-a.best[mode]!.score);
 return <div className="pognali-arena">
  <div className="pognali-toolbar"><p role="status">{notice||'Лучшие заезды всех игроков'}</p>{retry?<button onClick={()=>void save()}>Повторить сохранение</button>:null}</div>
  {opened?createPortal(<div ref={overlay} className="pognali-overlay" role="dialog" aria-modal="true" aria-label="Погнали — гонки">
   <div className="pognali-stage"><iframe ref={frame} src="/games/pognali.html?v=5" title="Погнали — гонки" onLoad={()=>send({type:'user',user})} sandbox="allow-scripts" referrerPolicy="no-referrer" className="pognali-frame"/><button ref={closeButton} type="button" className="pognali-close" onClick={close} aria-label="Закрыть игру" title="Закрыть игру">×</button></div>
  </div>,document.body):null}
  <div className="pognali-cover"><div aria-hidden="true">🏁</div><h2>Небольшой перерыв. Большая гонка.</h2><p>Горки, трамплины и боевые заезды. Собирайте бензин, обгоняйте ботов и соревнуйтесь со всеми игроками.</p><button ref={launchButton} onClick={open}>Погнали!</button></div>
  <section className="pognali-ranking" aria-label="Общий рейтинг"><div className="pognali-ranking-title"><h2>🏆 Общий рейтинг</h2><button disabled={loading} onClick={()=>void refresh()}>{loading?'Обновляем…':'Обновить'}</button></div><div className="pognali-tabs">{Object.entries(modes).map(([id,label])=><button key={id} aria-pressed={mode===id} onClick={()=>setMode(id as GameMode)}>{label}</button>)}</div><p className="pognali-rule">Очки: метр = 1, монета = 25{mode==='battle'?', победа над ботом = 500':''}. Для рейтинга проедьте хотя бы секунду.</p>{ranked.length?<ol>{ranked.map((row,i)=><li key={row.id} className={row.id===playerId?'is-me':''}><b>{i+1}</b>{row.avatar?<img src={row.avatar} alt="" loading="lazy"/>:<span className="pognali-avatar">{row.name.slice(0,1)}</span>}<span>{row.name}{row.id===playerId?' · вы':''}</span><strong>{row.best[mode]!.score.toLocaleString('ru-RU')} <small>очков</small></strong></li>)}</ol>:<p className="pognali-empty">Пока нет результатов. Откройте игру и установите первый рекорд!</p>}</section>
 </div>;
}
