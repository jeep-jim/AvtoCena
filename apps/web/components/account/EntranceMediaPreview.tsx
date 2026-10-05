'use client';
import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import type {AccountMedia} from '@/lib/account-appearance';
export function EntranceMediaPreview({item,onClose}:{item:AccountMedia;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),panel=useRef<HTMLElement>(null);
 useEffect(()=>{
  const trigger=document.activeElement as HTMLElement|null;
  const query=matchMedia('(max-width:760px)');
  const update=()=>{if(query.matches){panel.current?.querySelector('video')?.pause();if(!dialog.current?.open)dialog.current?.showModal();}else{dialog.current?.querySelector('video')?.pause();dialog.current?.close();panel.current?.querySelector('button')?.focus();}};
  update();query.addEventListener('change',update);
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};document.addEventListener('keydown',key);
  const outside=(event:PointerEvent)=>{const target=event.target;if(!(target instanceof Node))return;const surface=query.matches?dialog.current:panel.current;const media=surface?.querySelector('video,img');if(!media?.contains(target))onClose();};
  document.addEventListener('pointerdown',outside);
  return()=>{query.removeEventListener('change',update);document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);trigger?.focus();};
 },[onClose]);
 const content=<><button type="button" className="entrance-media-close" aria-label="Закрыть просмотр" onClick={onClose}><X size={24}/></button><h2>{item.caption||'Материалы автомобиля'}</h2>{item.type==='video'?<video key={item.url} src={item.url} controls playsInline preload="metadata"/>:<img src={item.url} alt={item.caption||'Фото автомобиля'}/>}</>;
 return <><section ref={panel} className="entrance-media-preview" aria-label="Просмотр материалов">{content}</section><dialog ref={dialog} className="entrance-media-dialog" aria-label="Просмотр материалов" onCancel={e=>{e.preventDefault();onClose();}}>{content}</dialog></>;
}
