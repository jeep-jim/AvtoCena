"use client";
import {DealerLogo} from "./DealerLogo";
import {useSelectedCity} from "@/lib/location/selected-city";
import {calculateSpecial} from "@/lib/dealers/showcase-model";
import Link from "next/link";
import {PublicSheet} from "@/components/ui/PublicSheet";
import {useEffect,useRef,useState,type ReactNode} from "react";
function DesktopScrollableRail({children,expanded=false}:{children:ReactNode;expanded?:boolean}) {
  const rail=useRef<HTMLDivElement>(null);
  const [edges,setEdges]=useState({left:false,right:false});
  useEffect(()=>{
    const el=rail.current;if(!el)return;
    const sync=()=>setEdges({left:el.scrollLeft>2,right:el.scrollLeft+el.clientWidth<el.scrollWidth-2});
    sync();
    const observer=new ResizeObserver(sync);
    observer.observe(el);
    for(const child of Array.from(el.children))observer.observe(child);
    el.addEventListener("scroll",sync,{passive:true});
    return ()=>{observer.disconnect();el.removeEventListener("scroll",sync);};
  },[children]);
  function move(direction:number){
    const el=rail.current;if(!el)return;
    el.scrollBy({left:direction*Math.max(240,el.clientWidth-80),behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  }
  return <div className="relative mt-4">
    <div ref={rail} className={expanded?"grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>a]:w-full":"ac-hide-scrollbar flex gap-4 overflow-x-auto pb-3"}>{children}</div>
    {!expanded && ([-1,1] as const).map(direction=>(direction===-1?edges.left:edges.right)&&<button key={direction} type="button" onClick={()=>move(direction)} aria-label={direction===-1?"Предыдущие объявления":"Следующие объявления"} className={`absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--ac-border)] bg-[var(--ac-surface)] text-red-500 shadow-md hover:bg-[var(--ac-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 lg:flex ${direction===-1?"left-0":"right-0"}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={direction===-1?"m14 5-7 7 7 7":"m10 5 7 7-7 7"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>)}
  </div>;
}
export type SpecialRailItem = {
  id: string;
  dealer?: {id:string;name:string;logoLight?:string;logoDark?:string};
  href: string;
  image: string;
  title: string;
  price: number | null;
  city: string;
  calculation?: {showcase: Parameters<typeof calculateSpecial>[0]; offer: Parameters<typeof calculateSpecial>[1]};
  availability?: "order" | "stock";
  condition?: "new" | "used";
  address?: string;
  heading?: string;
  subtitle?: string;
  daysFrom?: number;
  daysTo?: number;
};
export function SpecialRail({
  heading,
  items,
  expanded=false,
  kinds=["order","stock"],
}: {
  heading: string;
  expanded?: boolean;
  items: SpecialRailItem[];
  kinds?: readonly ("order"|"stock")[];
}) {
  const city=useSelectedCity();
  const [allKind,setAllKind]=useState<"order"|"stock"|null>(null);
  items=items.map(item=>{if(!item.calculation)return item;const c=calculateSpecial(item.calculation.showcase,item.calculation.offer,city);return {...item,price:c.totalRub,city:c.city,daysFrom:c.daysFrom,daysTo:c.daysTo};});
  if (!items.length) return null;
  const selected=items.filter(o=>(o.availability||"order")===allKind);
  const dealer=selected[0]?.dealer;
  const singleDealer=dealer && selected.every(o=>o.dealer?.id===dealer.id);
  const sheetName=singleDealer?dealer.name:"Предложения дилеров";
  return (
    <>{kinds.map(kind=>{const visible=items.filter(o=>(o.availability||"order")===kind);return visible.length ? <section data-site-block={kind==='stock'?'stock':'specials'} key={kind} className="my-5 min-w-0">
      <div className="flex items-end justify-between gap-3"><h2 className="text-lg font-black leading-tight md:text-2xl">
        {kind==="stock" ? visible[0].heading || "Автомобили в наличии" : heading}
      </h2>{!expanded&&<button type="button" onClick={()=>setAllKind(kind)} className="ac-market-all-link shrink-0 text-sm font-black" aria-label={kind==="stock"?"Все автомобили в наличии":"Все спецпредложения"}>Все →</button>}</div>
      {visible[0].subtitle && visible.every(o=>o.subtitle===visible[0].subtitle&&o.heading===visible[0].heading)&&<p className="mt-1 break-words text-sm leading-relaxed text-[var(--ac-muted)]">{visible[0].subtitle}</p>}
      <DesktopScrollableRail expanded={expanded}>
        {visible.map((o) => (
          <Link
            key={o.href}
            href={o.href}
            className="w-48 shrink-0 overflow-hidden rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] md:w-56"
          >
            <img
              src={o.image}
              alt={o.title}
              loading="lazy"
              className="aspect-[16/10] w-full object-cover"
            />
            <div className="space-y-1 p-3">
              <p className="text-xs font-bold text-emerald-600">{kind==="stock" ? `В наличии · ${o.condition==="used"?"С пробегом":"Новый"}` : `${o.condition==="used"?"С пробегом":"Новый"}${o.daysFrom?` от ${o.daysFrom} дней`:" · Под заказ"}`}</p>
              <h3 className="line-clamp-2 break-words text-sm font-black">{o.title}</h3>
              <p className="ac-price ac-price--down text-base font-black">
                {o.price === null
                  ? "Цена уточняется"
                  : `${o.price.toLocaleString("ru-RU")} ₽`}
              </p>

            </div>
          </Link>
        ))}
      </DesktopScrollableRail>
    </section>:null;})}{allKind&&<PublicSheet title={sheetName} headerContent={<span className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--ac-surface-2)] [&_img]:h-full [&_img]:w-full [&_img]:object-contain"><DealerLogo logoLight={singleDealer?dealer.logoLight:undefined} logoDark={singleDealer?dealer.logoDark:undefined} name={sheetName}/></span><span className="truncate">{sheetName}</span></span>} onClose={()=>setAllKind(null)} maxWidth={1100}><div className="px-5 pb-5"><SpecialRail heading={heading} items={items} kinds={[allKind]} expanded/></div></PublicSheet>}</>
  );
}
