'use client';
import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {DealerLink, useDealerBrowsing} from '@/components/dealers/DealerBrowsingContext';
import {CatalogHelpForm} from './CatalogHelpForm';

export function CatalogUnavailable({retained=false,message,reset}:{retained?:boolean;message?:string;reset?:()=>void}) {
 const router=useRouter(),dealer=useDealerBrowsing();
 const [pending,startTransition]=useTransition();
 const [helpOpen,setHelpOpen]=useState(false);
 const guidance=message&&/^(?:Проверьте условия|Это условие поиска)/.test(message)?message:"Параметры поиска сохранены. Попробуйте ещё раз.";
 if(retained)return <section role="status" data-catalog-unavailable className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-4 py-3 text-sm text-[var(--ac-text)]">
  <p><strong>Показана предыдущая подборка.</strong> Она не соответствует новым условиям. Цены и наличие требуют обновления.</p>
  <button type="button" disabled={pending} aria-busy={pending} className="shrink-0 rounded-lg border border-[var(--ac-border)] px-3 py-2 font-bold disabled:opacity-60" onClick={()=>startTransition(()=>{if(reset)reset();else router.refresh();})}>{pending?'Обновляем…':'Повторить'}</button>
 </section>;
 return <section role="status" className="my-3 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-4 py-3 text-sm text-[var(--ac-text)]" data-catalog-unavailable>
  <h2 className="font-bold">Не удалось загрузить эту страницу</h2>
  <p className="mt-1">{guidance}</p>
  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-bold">
   <button type="button" disabled={pending} aria-busy={pending} className="rounded-lg border border-[var(--ac-border)] px-3 py-2 disabled:opacity-60" onClick={()=>startTransition(()=>{if(reset)reset();else router.refresh();})}>{pending?'Обновляем…':'Повторить'}</button>
   <DealerLink href="/cars" prefetch={false} className="underline">Перейти в каталог</DealerLink>
   <DealerLink href="/" prefetch={false} className="underline">На главную</DealerLink>
   <button type="button" aria-expanded={helpOpen} className="underline" onClick={()=>setHelpOpen(open=>!open)}>Помощь с подбором</button>
   {dealer&&<DealerLink href={dealer.href.split('#')[0]+'#about'} prefetch={false} className="underline">Контакты компании</DealerLink>}
  </div>
  {helpOpen&&<CatalogHelpForm/>}
 </section>;
}
