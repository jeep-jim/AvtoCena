'use client';
import {useEffect,useRef,useState} from 'react';
export function IdeaCountdown({expiresAt}:{expiresAt:string}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(t);},[]);
 const days=Math.max(0,Math.ceil((Date.parse(expiresAt)-now)/86400000));
 const label=`До автоматического удаления: ${days} дн. (${new Date(expiresAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}, Красноярск)`;
 return <span className="ideas-countdown" title={label} aria-label={label}><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" opacity=".18" strokeWidth="3"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" pathLength="30" strokeDasharray={`${Math.min(30,days)} 30`} transform="rotate(-90 18 18)"/></svg><span>{days}</span></span>;
}
export function IdeaDeleteConfirmation({number,busy,onCancel,onConfirm}:{number:number;busy:boolean;onCancel:()=>void;onConfirm:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{ref.current?.showModal();const dialog=ref.current;return()=>dialog?.close();},[]);
 return <dialog ref={ref} className="ideas-delete-dialog" aria-labelledby="idea-delete-title" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}><h2 id="idea-delete-title">Удалить идею №{number} полностью?</h2><p>Описание, комментарии и скриншоты будут удалены. Отменить удаление не получится.</p><div><button type="button" autoFocus disabled={busy} onClick={onCancel}>Нет</button><button type="button" className="ideas-primary" disabled={busy} onClick={onConfirm}>{busy?'Удаляем…':'Да, удалить'}</button></div></dialog>;
}
