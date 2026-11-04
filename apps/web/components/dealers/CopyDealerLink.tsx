'use client';
import {useState} from 'react';
import {Copy,Check} from 'lucide-react';
export function CopyDealerLink({url}:{url:string}){
 const [status,setStatus]=useState('');
 return <span className="inline-flex flex-wrap items-center gap-2"><span className="break-all">{url}</span><button type="button" title="Копировать ссылку на дилера" aria-label="Копировать ссылку на дилера" className="inline-flex rounded-lg border border-[var(--ac-border)] p-2" onClick={async()=>{try{await navigator.clipboard.writeText(url);setStatus('Ссылка скопирована');}catch{setStatus('Не удалось скопировать. Выделите ссылку и скопируйте вручную.');}}}>{status==='Ссылка скопирована'?<Check size={18}/>:<Copy size={18}/>}</button><span role="status" className="text-xs">{status}</span></span>;
}
