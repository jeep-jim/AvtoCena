'use client';
import {useTransition} from 'react';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';

/** Recovery remains beside the bottom of retained cards, where pagination was. */
export function CatalogPageRecovery(){
 const router=useRouter(),pathname=usePathname(),search=useSearchParams();
 const [pending,startTransition]=useTransition();
 const page=Number(search.get('page')||1);
 const previous=new URLSearchParams(search.toString());
 previous.set('page',String(page-1));
 const canGoBack=Number.isSafeInteger(page)&&page>1&&!search.has('after');
 return <nav aria-label="Восстановление страницы каталога" className="my-5 flex flex-wrap items-center justify-center gap-3 text-sm">
  <p className="w-full text-center">Новая подборка не загрузилась. Выше сохранены предыдущие автомобили.</p>
  {canGoBack&&<Link prefetch={false} href={`${pathname}?${previous}`} className="rounded-xl border border-[var(--ac-border)] px-4 py-3 font-bold">Предыдущая страница</Link>}
  <button type="button" disabled={pending} aria-busy={pending} onClick={()=>startTransition(()=>router.refresh())} className="rounded-xl bg-red-500 px-4 py-3 font-bold text-white disabled:opacity-60">{pending?'Загружаем…':'Повторить загрузку'}</button>
 </nav>;
}
