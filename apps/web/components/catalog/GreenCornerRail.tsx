import Link from "next/link";
import { CatalogCard } from "./CatalogCard";
export function GreenCornerRail({items,total}:{items:any[];total:number}) {
 if(!total)return null;
 return <section className="mt-8 min-w-0" aria-label="Зелёный угол">
  <div className="mb-4 flex items-end justify-between gap-3"><div><p className="mb-2 text-xs font-bold text-emerald-600">Зелёный угол · без торгов</p><h3 className="ac-green-heading text-2xl font-black tracking-tight md:text-4xl">В наличии <span className="text-sm text-[var(--ac-muted)]">· {total.toLocaleString("ru-RU")}</span></h3></div><Link href="/cars/green" className="ac-market-all-link ac-green-button shrink-0 text-sm font-black">Все →</Link></div>
  <div className="grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto [scrollbar-width:none] md:grid-flow-row md:auto-cols-auto md:grid-cols-5 md:overflow-visible">{items.slice(0,10).map(offer=><CatalogCard key={offer.id} offer={offer} compact dense />)}</div>
 </section>;
}
