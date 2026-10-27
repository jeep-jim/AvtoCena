"use client";
import {createContext,useContext,useMemo,useTransition,type ReactNode, type ComponentProps} from 'react';
import {rememberFilterScroll} from "@/lib/catalog/filter-scroll";
import Link from 'next/link';
import {useSelectedCity} from '@/lib/location/selected-city';
import {usePathname,useRouter} from 'next/navigation';
import {Star,Car,Images,MapPin,MessageCircle} from 'lucide-react';
import {dealerBrowsingHref,type DealerBrowsingContext} from '@/lib/dealers/browsing-context';
const Context=createContext<DealerBrowsingContext|null>(null);
export const useDealerBrowsing=()=>useContext(Context);
export function DealerLink({href,onClick,scroll,children,...props}:ComponentProps<typeof Link>){
 const dealer=useDealerBrowsing();const city=useSelectedCity();const router=useRouter();const [pending,startTransition]=useTransition();
 const target=typeof href==='string'?dealerBrowsingHref(href,dealer,city):href;
 const catalog=typeof href==='string' && (href.split('?')[0]==='/cars'||href.split('?')[0]==='/cars/green');
 return <Link {...props} href={target} prefetch={catalog?false:props.prefetch} data-no-route-loader={catalog?"true":props["data-no-route-loader"]} aria-busy={catalog&&pending||undefined} scroll={scroll??(catalog?false:undefined)} onClick={event=>{
  onClick?.(event);
  if(catalog&&!event.defaultPrevented&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0&&(!props.target||props.target==='_self')&&!props.download&&typeof target==='string'){
   event.preventDefault();if(pending)return;
   const fromCatalog=location.pathname==='/cars'||location.pathname==='/cars/green';
   if(fromCatalog)rememberFilterScroll(target);
   startTransition(()=>{router.push(target,{scroll:scroll??!fromCatalog});});
  }
 }}>{children}{catalog&&pending&&<span role="status" className="ml-2 text-xs">Открываем…</span>}</Link>;
}
export function DealerBrowsingProvider({dealer,children,profile=false}:{dealer:DealerBrowsingContext|null;children:ReactNode;profile?:boolean}){
 const pathname=usePathname();
 // Both the ID and friendly route render this server-authorized profile.
 // Keep its current route while filtering so React preserves the whole page.
 const current=useMemo(()=>dealer&&profile&&pathname?{...dealer,href:pathname+(dealer.preview?'?preview=1':'')}:dealer,[dealer,profile,pathname]);
 return <Context.Provider value={current}><div data-dealer-context={dealer?.id}>{children}</div>{dealer&&!profile&&<nav className="dealer-context-dock" aria-label="Быстрое меню дилера">{[{label:'Каталог',icon:Car,href:dealer.href},{label:'Медиа',icon:Images,href:dealer.href+'#photos'},{label:'Адреса',icon:MapPin,href:dealer.href+'#about'},{label:'Отзывы',icon:Star,href:dealer.href+'#reviews'},{label:'Заявка',icon:MessageCircle,href:dealerBrowsingHref('/request',dealer)}].map(item=><Link key={item.label} href={item.href}><item.icon size={22}/><span>{item.label}</span></Link>)}</nav>}
 {dealer&&<style>{`
 body:has([data-dealer-context]) .ac-public-footer-operator,body:has([data-dealer-context]) .ac-public-footer-navigation>nav,body:has([data-dealer-context]) .ac-public-footer-navigation>div>:not(.ac-public-footer-tools){display:none!important}
 .dealer-context-dock{display:none;color:var(--ac-text)}.dealer-context-dock>a{color:inherit}
 @media(max-width:767px){.dealer-context-dock{position:fixed;z-index:45;bottom:0;left:0;width:100%;display:flex;padding:8px 8px calc(8px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;background:var(--ac-surface);border-top:1px solid var(--ac-border)}.dealer-context-dock>a{display:flex;flex:1;align-items:center;flex-direction:column;gap:5px;min-height:48px;justify-content:center;font-size:10px}body:has([data-dealer-context]) .ac-public-legal-footer{padding-bottom:95px}}
 `}</style>}</Context.Provider>;
}
