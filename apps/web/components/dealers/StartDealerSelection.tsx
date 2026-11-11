'use client';
import {Share2} from 'lucide-react';
import {createPortal} from 'react-dom';
import {useState} from 'react';
import {saveSelectionDraft,emptySelectionDraft} from '@/lib/dealers/selection-draft';
export function StartDealerSelection({dealerId,href,menu=false}:{dealerId:string;href:string;menu?:boolean}){
 const [help,setHelp]=useState(false);
 function start(){saveSelectionDraft(dealerId,{...emptySelectionDraft,opened:true});window.location.assign(href+'?selection=1&filters=1#catalog');}
 return <><button type="button" className={menu?"ac-staff-selection":"rounded-xl bg-[var(--ac-surface-2)] px-4 py-3 font-bold"} onClick={()=>{try{if(localStorage.getItem('dealer-selection-help:v1')){start();return;}}catch{}setHelp(true);}}>{menu&&<Share2 size={18}/>}Подборка для клиента</button>{help&&createPortal(<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onKeyDown={e=>{if(e.key==='Escape')setHelp(false);}}><section role="dialog" aria-modal="true" aria-labelledby="selection-help-title" className="max-w-md rounded-2xl bg-[var(--ac-surface)] p-6"><h2 id="selection-help-title" className="text-xl font-bold">Подборка для клиента</h2><p className="my-4">Откроется каталог вашей компании. Выберите марку, бюджет и другие фильтры, затем нажмите «Поделиться подборкой». Клиент получит ссылку на автомобили с выбранными параметрами. Состав и цены могут меняться.</p><button autoFocus className="rounded-xl bg-red-500 px-4 py-3 font-bold text-white" onClick={()=>{try{localStorage.setItem('dealer-selection-help:v1','1');}catch{}start();}}>Понятно, начать</button><button className="ml-3 p-3" onClick={()=>setHelp(false)}>Закрыть</button></section></div>,document.body)}</>;
}
