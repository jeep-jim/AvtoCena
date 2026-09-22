import { CatalogMarketFlag } from "./CatalogMarketFlag";
import Link from "next/link";
import { CatalogCard } from "./CatalogCard";
export function GreenCornerRail({items,total,href="/cars/green"}:{items:any[];total:number;href?:string}) {
 if(!total)return null;
 return <section className="mt-8 min-w-0" aria-label="Зелёный угол">
  <div className="mb-4 flex items-end justify-between gap-3"><div><p className="mb-2 text-xs font-bold ac-green-heading">Зелёный угол · без торгов</p><h3 className="ac-green-heading flex items-center gap-2 text-2xl font-black tracking-tight md:text-4xl"><CatalogMarketFlag market="japan" className="h-5 w-7 md:h-6 md:w-9" /><span>В наличии</span> <span className="text-sm text-[var(--ac-muted)]">· {total.toLocaleString("ru-RU")}</span></h3></div><Link href={href} className="ac-market-all-link ac-green-button shrink-0 text-sm font-black">Все →</Link></div>
  <div className="ac-catalog-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] md:mr-0 md:grid-flow-row md:auto-cols-auto md:grid-cols-5 md:overflow-visible md:pr-0">{items.slice(0,10).map(offer=><div key={offer.id} className="min-w-0"><CatalogCard offer={offer} compact dense /></div>)}</div>
 </section>;
}
