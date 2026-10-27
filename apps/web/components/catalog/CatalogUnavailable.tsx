'use client';
import {useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {DealerLink, useDealerBrowsing} from '@/components/dealers/DealerBrowsingContext';
import {CatalogHelpForm} from './CatalogHelpForm';
import {TOPAVTO_DEALER} from '@/lib/topavto-dealer';

export function CatalogUnavailable({retained=false,message,reset}:{retained?:boolean;message?:string;reset?:()=>void}) {
 const router=useRouter(),dealer=useDealerBrowsing();
 const [pending,startTransition]=useTransition();
 return <section role="status" className="my-5 rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-5 text-[var(--ac-text)]" data-catalog-unavailable>
  <h2 className="text-xl font-black">{retained?'Не удалось обновить подборку':'Каталог временно недоступен'}</h2>
  <p className="mt-2 text-sm">{retained?'Ниже сохранена предыдущая подборка. Она не соответствует новым условиям; цены и наличие нужно проверить повторно.':'Мы поможем подобрать автомобиль — оставьте заявку.'}</p>
  {message&&<p className="mt-2 text-sm">{message}</p>}
  <div className="mt-4 flex flex-wrap items-center gap-4 text-sm font-bold">
   <button type="button" disabled={pending} aria-busy={pending} className="rounded-xl bg-red-500 px-5 py-3 text-white disabled:opacity-60" onClick={()=>startTransition(()=>{if(reset)reset();else router.refresh();})}>{pending?'Обновляем…':'Повторить'}</button>
   {!retained&&<><DealerLink href="/cars" prefetch={false} className="underline">Перейти в каталог</DealerLink><DealerLink href="/" prefetch={false} className="underline">На главную</DealerLink></>}
   <DealerLink href="/request" prefetch={false} className="underline">Оставить заявку</DealerLink>
   {dealer?<DealerLink href={dealer.href.split('#')[0]+'#about'} prefetch={false} className="underline">Контакты компании</DealerLink>:<a href={TOPAVTO_DEALER.website} className="underline" target="_blank" rel="noopener noreferrer">Связаться с TOP AVTO</a>}
  </div>
  {!retained&&<CatalogHelpForm/>}
 </section>;
}
