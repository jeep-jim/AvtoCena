'use client';
import { useEffect, useRef, useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { currentPublicPageUrl } from '../../lib/public-page-url';
export function PageQrButton() {
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [url,setUrl]=useState(''),[image,setImage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  if(!url)return;
  let live=true;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  dialog.current?.showModal();
  import('qrcode').then(qr=>qr.default.toDataURL(url,{errorCorrectionLevel:'M',margin:4,width:768,color:{dark:'#000000',light:'#ffffff'}})).then(value=>{if(live)setImage(value)}).catch(()=>{if(live)setError('Не удалось создать QR. Попробуйте ещё раз.');});
  return ()=>{live=false;document.body.style.overflow=overflow;};
 },[url]);
 function close(){dialog.current?.close();setUrl('');setImage('');setError('');trigger.current?.focus();}
 return <><button ref={trigger} type="button" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--ac-text)]" onClick={()=>{const value=currentPublicPageUrl();if(value)setUrl(value)}}><QrCode size={19}/>QR страницы</button>
 <dialog ref={dialog} onCancel={event=>{event.preventDefault();close()}} onClose={close} onClick={event=>{if(event.target===event.currentTarget)close()}} className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-3xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-5 text-[var(--ac-text)] shadow-2xl backdrop:bg-black/70" aria-labelledby="page-qr-title">
 <header className="flex items-center justify-between gap-3"><h2 id="page-qr-title" className="text-lg font-black">QR страницы</h2><button type="button" onClick={close} autoFocus aria-label="Закрыть QR" className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ac-surface-2)]"><X/></button></header>
 <p className="my-3 text-sm">Наведите камеру телефона, чтобы открыть эту страницу.</p>
 <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-white text-black" aria-live="polite">{image?<img src={image} alt="QR-код текущей страницы" className="h-full w-full rounded-xl"/>:<p className="p-5 text-center text-sm">{error||'Создаём QR…'}</p>}</div>
 <a href={url} className="mt-4 block break-all text-xs underline">{url}</a>
 </dialog></>;
}
