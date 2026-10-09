import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {canEditCatalog} from '@/lib/catalog/editorial-access';
import {readCatalogEditorial} from '@/lib/catalog/editorial';
import {getOfferFromCurrentShard} from '@/lib/catalog/storage';
import {CrmShell} from '@/components/crm/CrmShell';
import {CatalogEditorialEditor} from '@/components/catalog/CatalogEditorialEditor';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 if(!canEditCatalog(await getCurrentUser()))redirect('/crm');
 const query=await searchParams,status=['visible','hidden','archived'].includes(query.status||'')?query.status!:'hidden',q=(query.q||'').trim().toLocaleLowerCase('ru');
 const entries=Object.values((await readCatalogEditorial()).entries).filter(e=>e.status===status&&(!q||[e.title,e.originalTitle,e.id,e.reason].join(' ').toLocaleLowerCase('ru').includes(q))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const page=Math.max(1,Math.floor(Number(query.page)||1)),totalPages=Math.max(1,Math.ceil(entries.length/12)),currentPage=Math.min(page,totalPages);
 const rows=await Promise.all(entries.slice((currentPage-1)*12,currentPage*12).map(async entry=>({entry,available:!!await getOfferFromCurrentShard(entry.id)})));
 return <CrmShell title="Каталог и архив" subtitle="Исправляйте объявления и возвращайте проверенные автомобили на сайт." activeHref="/crm/catalog"><div>
  <nav aria-label="Статусы объявлений" className="mb-4 flex flex-wrap gap-2">{[['hidden','Скрытые'],['archived','Архив'],['visible','Опубликованные правки']].map(([key,label])=><Link key={key} href={`/crm/catalog?status=${key}`} aria-current={status===key?'page':undefined} className={`rounded-xl px-4 py-2 font-bold ${status===key?'bg-orange-500 text-black':'bg-[var(--ac-surface-2)]'}`}>{label}</Link>)}</nav>
  <form className="mb-5 flex gap-2"><input type="hidden" name="status" value={status}/><input name="q" defaultValue={query.q} placeholder="Название или комментарий" aria-label="Поиск объявлений" className="min-w-0 flex-1 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-3"/><button className="rounded-xl bg-[var(--ac-surface-2)] px-4 font-bold">Найти</button></form>
  <p className="mb-4 text-sm text-[var(--ac-muted)]">Скрытые и архивные объявления не показываются посетителям. После исправления выберите «Показывать на сайте». Полное удаление не выполняется.</p>
  <div className="grid gap-5 lg:grid-cols-2">{rows.map(({entry,available})=><article key={entry.version} className="overflow-hidden rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)]"><div className="relative h-[400px] bg-[var(--ac-surface-2)]">{(entry.photos?.[0]||entry.originalPhoto)&&<img src={entry.photos?.[0]||entry.originalPhoto} alt={entry.title||entry.originalTitle} className="h-full w-full object-contain"/>}<CatalogEditorialEditor offerId={entry.id} originalTitle={entry.originalTitle} initial={entry} available={available}/></div><div className="space-y-2 p-4"><h2 className="font-black">{entry.title||entry.originalTitle}</h2><p className="text-sm">{entry.reason||'Комментарий не добавлен'}</p><p className="text-xs text-[var(--ac-muted)]">{entry.updatedByName} · {new Date(entry.updatedAt).toLocaleString('ru-RU')}</p>{available&&<Link className="inline-block text-sm underline" href={`/cars/offer/${encodeURIComponent(entry.id)}?edit=1`}>Открыть карточку и параметры</Link>}</div></article>)}</div>
  {!rows.length&&<p className="py-10 text-center text-[var(--ac-muted)]">Объявлений в этом разделе пока нет.</p>}
  {totalPages>1&&<nav className="mt-5 flex items-center justify-between" aria-label="Страницы архива">{currentPage>1?<Link href={`/crm/catalog?status=${status}&q=${encodeURIComponent(q)}&page=${currentPage-1}`}>← Назад</Link>:<span/>}<span>{currentPage} из {totalPages}</span>{currentPage<totalPages?<Link href={`/crm/catalog?status=${status}&q=${encodeURIComponent(q)}&page=${currentPage+1}`}>Далее →</Link>:<span/>}</nav>}
 </div></CrmShell>;
}
