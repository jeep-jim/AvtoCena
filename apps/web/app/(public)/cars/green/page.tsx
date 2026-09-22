import Link from "next/link";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
export const dynamic="force-dynamic";
export const metadata={title:"Зелёный угол — автомобили в наличии в Японии | АвтоЦена"};
export default async function GreenCornerPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const params=await searchParams;
 const snapshot=await readGreenCorner();
 const query=String(params.q||"").trim().toLowerCase().slice(0,100);
 const matched=snapshot.items.filter(row=>!query||`${row.make} ${row.model} ${row.year}`.toLowerCase().includes(query));
 const pages=Math.max(1,Math.ceil(matched.length/24));
 const page=Math.max(1,Math.min(pages,Math.floor(Number(params.page)||1)));
 const items=await applyActiveBusinessPricingBatch(matched.slice((page-1)*24,page*24).map(publicGreenOffer));
 const href=(n:number)=>`/cars/green?${new URLSearchParams({q:query,page:String(n)})}`;
 return <main className="mx-auto max-w-[1440px] px-4 py-8 md:px-8"><Link href="/cars" className="text-sm font-bold">← Каталог автомобилей</Link>
  <p className="mt-8 text-sm font-bold text-emerald-600">Япония · автомобили в наличии</p><h1 className="mt-2 text-4xl font-black md:text-6xl">Зелёный угол</h1>
  <p className="mt-4 max-w-2xl text-[var(--ac-muted)]">Эти машины уже выкуплены — участвовать в аукционе не нужно. Цена FOB + 45 000 ₽, без доставки и таможенных платежей. Наличие подтвердит менеджер.</p>
  <form className="mt-6 flex gap-3" action="/cars/green"><input name="q" defaultValue={query} placeholder="Марка, модель или год" aria-label="Поиск в Зелёном углу" className="min-w-0 flex-1 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-4 py-3"/><button className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white">Найти</button></form>
  <p className="mt-5 text-sm text-[var(--ac-muted)]">Найдено: {matched.length.toLocaleString("ru-RU")}</p>
  <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{items.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense />)}</div>
  {!items.length?<p className="py-8">Подходящих автомобилей пока нет.</p>:null}
  <nav aria-label="Страницы Зелёного угла" className="mt-8 flex items-center justify-between gap-4">{page>1?<Link href={href(page-1)}>← Назад</Link>:<span/>}<span>{page} / {pages}</span>{page<pages?<Link href={href(page+1)}>Дальше →</Link>:<span/>}</nav>
 </main>;
}
