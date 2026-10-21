'use client';
import {useEffect,useRef,useState} from 'react';
import {SlidersHorizontal,Share2,X} from 'lucide-react';
import {SELECTION_EVENT,OPEN_SELECTION_FILTERS,SELECTION_TITLE,selectionTitle,selectionQuery,selectionTarget} from '@/lib/dealers/selection-share';
type Selection={dealerId:string;query:string;pending:boolean;filtersOpen:boolean};
export function DealerSelectionShare({dealerId,initialQuery=''}:{dealerId:string;initialQuery?:string}){
 const [selection,setSelection]=useState<Selection>({dealerId,query:initialQuery,pending:false,filtersOpen:false});
 const [customTitle,setCustomTitle]=useState('');
 const [dismissed,setDismissed]=useState<string|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const prepared=useRef<{key:string;url:string}|null>(null),inFlight=useRef(false),latest=useRef('');
 const key=selectionTarget(dealerId,selectionQuery(new URLSearchParams(selection.query),false).toString());const title=selectionTitle(customTitle)||SELECTION_TITLE;const shareKey=JSON.stringify([key,title]);latest.current=shareKey;
 useEffect(()=>{const receive=(event:Event)=>{const detail=(event as CustomEvent<Selection>).detail;if(detail?.dealerId===dealerId)setSelection(detail);};window.addEventListener(SELECTION_EVENT,receive);return()=>window.removeEventListener(SELECTION_EVENT,receive);},[dealerId]);
 useEffect(()=>{setStatus('');},[shareKey]);
 const active=selectionQuery(new URLSearchParams(selection.query),false).size>0&&dismissed!==key;
 async function share(){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);const current=shareKey;const target=key;const caption=title;
  try{
   let url=prepared.current?.key===current?prepared.current.url:'';
   if(!url){setStatus('Готовим ссылку…');const response=await fetch('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:target,mini:false,title:selectionTitle(customTitle)}),signal:AbortSignal.timeout(45000)});const result=await response.json().catch(()=>null);if(!response.ok||!/^\/s\/[A-Za-z0-9_-]{16}$/.test(result?.path))throw Error('Не удалось подготовить ссылку. Попробуйте ещё раз.');url=new URL(result.path,location.origin).toString();prepared.current={key:current,url};}
   if(latest.current!==current){setStatus('Параметры изменились — поделитесь новой подборкой');return;}
   const text=`${caption}\n${url}`;
   if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches&&navigator.share){try{await navigator.share({title:caption,text});setStatus('');return;}catch(e){if((e as Error).name==='AbortError'){setStatus('');return;}if((e as Error).name==='NotAllowedError'){setStatus('Ссылка готова — нажмите ещё раз');return;}}}
   await navigator.clipboard.writeText(text);setStatus('Ссылка скопирована');
  }catch(e){setStatus(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'Подготовка заняла слишком много времени. Нажмите ещё раз.':e instanceof Error?e.message:'Не удалось поделиться подборкой');}finally{inFlight.current=false;setBusy(false);}
 }
 if(!active)return null;
 return <><nav className="dealer-selection-dock" data-selection-dock hidden={selection.filtersOpen} aria-label="Поделиться подборкой">
  <label className="dealer-selection-title"><span className="sr-only">Название подборки</span><input aria-label="Название подборки" placeholder="Название подборки (необязательно)" value={customTitle} maxLength={160} onChange={event=>setCustomTitle(event.target.value)} /></label>
  <button type="button" className="dealer-selection-close" aria-label="Скрыть панель подборки" onClick={()=>setDismissed(key)}><X size={23}/></button>
  <button type="button" className="dealer-selection-filters" aria-label="Изменить фильтры подборки" onClick={()=>window.dispatchEvent(new CustomEvent(OPEN_SELECTION_FILTERS,{detail:{dealerId}}))}><SlidersHorizontal size={25}/></button>
  <button type="button" className="dealer-selection-send" onClick={()=>void share()} disabled={busy}><Share2 size={19}/><span>{busy?'Готовим ссылку…':'Поделиться подборкой'}</span></button>
  {status&&<p role="status">{status}</p>}
 </nav><style>{`
 .dealer-profile:has([data-selection-dock])>.dealer-dock{display:none!important}
 .dealer-selection-dock{position:fixed;z-index:60;bottom:16px;left:50%;transform:translateX(-50%);display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:min(560px,calc(100% - 24px));padding:10px;border:1px solid var(--ac-border);border-radius:20px;background:var(--ac-surface);box-shadow:0 8px 32px #0003;color:var(--ac-text)}
 .dealer-selection-title{flex:0 0 100%;min-width:0}.dealer-selection-title input{box-sizing:border-box;width:100%;min-width:0;height:42px;padding:0 12px;border:1px solid var(--ac-border);border-radius:10px;background:var(--ac-surface-2);color:var(--ac-text);font-size:14px}.dealer-selection-dock[hidden]{display:none}.dealer-selection-dock button{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:13px}.dealer-selection-close,.dealer-selection-filters{flex:0 0 44px;background:var(--ac-surface-2)}
 .dealer-selection-send{flex:1;min-width:0;gap:8px;padding:8px;color:#fff!important;background:#1689df;font-size:14px;font-weight:800}.dealer-selection-send:disabled{opacity:.65}.dealer-selection-send span{min-width:0}.dealer-selection-send svg{flex-shrink:0}
 .dealer-selection-dock p{position:absolute;bottom:100%;left:0;right:0;padding:10px;border-radius:12px;background:var(--ac-surface);border:1px solid var(--ac-border);text-align:center;font-size:13px}
 @media(max-width:767px){.dealer-selection-dock{bottom:0;width:100%;border-radius:22px 22px 0 0;padding:9px 10px calc(9px + env(safe-area-inset-bottom))}.dealer-selection-send{font-size:13px}.dealer-profile:has([data-selection-dock]){padding-bottom:90px}}
 `}</style></>;
}
