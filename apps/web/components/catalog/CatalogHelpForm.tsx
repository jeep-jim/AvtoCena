'use client';
import {useRef,useState} from 'react';
import {PhoneInput} from '@/components/leads/PhoneInput';
import {ConsentCheckbox} from '@/components/legal/ConsentCheckbox';
import {normalizeRuPhone} from '@/lib/ru-phone';
import {useDealerBrowsing} from '@/components/dealers/DealerBrowsingContext';

/** Generic intake deliberately does not depend on the failed catalog or offer lookup. */
export function CatalogHelpForm() {
 const dealer=useDealerBrowsing();
 const [name,setName]=useState(''),[phone,setPhone]=useState('+7'),[consent,setConsent]=useState(false);
 const [state,setState]=useState<'idle'|'sending'|'success'|'error'>('idle');
 const [message,setMessage]=useState('');
 const operation=useRef(''),sending=useRef(false);
 async function submit(event:React.FormEvent) {
  event.preventDefault();
  if(sending.current)return;
  if(!name.trim()||!normalizeRuPhone(phone)||!consent){setMessage('Укажите имя, телефон и подтвердите согласие на обработку заявки.');setState('error');return;}
  sending.current=true;setState('sending');setMessage('');
  try {
   const {leadFetch}=await import('@/lib/lead-submit-client');
   operation.current ||= crypto.randomUUID();
   const response=await leadFetch('/api/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    name:name.trim(),phone:normalizeRuPhone(phone),contactInputVersion:'ru-v1',contactPreference:'call',requestMode:'generic',source:'catalog_unavailable',
    dealerId:dealer?.id||new URLSearchParams(window.location.search).get('dealer')||undefined,
    personalDataConsent:true,operationId:operation.current,pageUrl:window.location.href,comment:'Нужна помощь с подбором: каталог временно недоступен.'
   })});
   const result=await response.json().catch(()=>null);
   if(!response.ok||!result?.ok)throw Error('unavailable');
   operation.current='';setState('success');setMessage('Заявка отправлена. Мы свяжемся с вами и поможем подобрать автомобиль.');
  }catch{setState('error');setMessage('Не удалось отправить заявку. Ваши данные сохранены в форме — попробуйте ещё раз или свяжитесь с нами по ссылке выше.');}
  finally{sending.current=false;}
 }
 return <div className="mt-6 max-w-xl rounded-2xl bg-[var(--ac-surface-2)] p-4 sm:p-5" data-catalog-help-form>
  <h3 className="text-base font-bold">Подберём автомобиль вручную</h3>
  {state==='success'?<p role="status" className="mt-3 text-sm leading-6">{message}</p>:<form onSubmit={submit} data-private="true" className="mt-4 grid gap-3">
   <label className="grid gap-2 text-sm font-semibold">Имя<input name="name" autoComplete="name" required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Как к вам обращаться" className="ym-disable-keys min-h-12 min-w-0 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-4 text-[var(--ac-text)] outline-none focus-visible:ring-2 focus-visible:ring-red-400" /></label>
   <label className="grid gap-2 text-sm font-semibold">Телефон<PhoneInput value={phone} onChange={setPhone} required /></label>
   <ConsentCheckbox checked={consent} onChange={setConsent}/>
   {state==='error'?<p role="alert" className="text-sm leading-6">{message}</p>:null}
   <button type="submit" disabled={state==='sending'} className="min-h-12 rounded-xl bg-red-500 px-5 py-3 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-60">{state==='sending'?'Отправляем…':'Перезвоните мне'}</button>
  </form>}
 </div>;
}
