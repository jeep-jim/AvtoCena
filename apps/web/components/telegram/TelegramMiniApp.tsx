"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import Script from "next/script";
import {usePathname,useRouter} from "next/navigation";
import {CitySelector} from "../home/CitySelector";
import {useSelectedCity} from "../../lib/location/selected-city";
import {miniAppPathAllowed} from "../../lib/telegram-miniapp";

type TelegramWebApp = {
  ready:()=>void;expand:()=>void;colorScheme?:string;
  safeAreaInset?:{top:number;bottom:number};contentSafeAreaInset?:{top:number;bottom:number};
  BackButton?:{show:()=>void;hide:()=>void;onClick:(f:()=>void)=>void;offClick:(f:()=>void)=>void};
  onEvent?:(name:string,callback:()=>void)=>void;offEvent?:(name:string,callback:()=>void)=>void;
  openLink?:(url:string)=>void;openTelegramLink?:(url:string)=>void;
};
function app(){return (window as Window & {Telegram?:{WebApp?:TelegramWebApp}}).Telegram?.WebApp;}
export function TelegramMiniApp(){
  const pathname=usePathname()||"";const router=useRouter();const city=useSelectedCity();
  const [enabled,setEnabled]=useState(false),[sdkReady,setSdkReady]=useState(false);
  const lastCatalog=useRef("/mini");
  const atCatalog=pathname==="/mini"||pathname==="/cars"||pathname==="/cars/green";
  useEffect(()=>{
    let active=document.documentElement.dataset.miniapp==="true";
    try{const query=new URLSearchParams(location.search);if(query.get("mini")==="0"){sessionStorage.removeItem("avtocena_mini");active=false;}else if(pathname==="/mini"||query.get("mini")==="1"){sessionStorage.setItem("avtocena_mini","1");active=true;}else active=sessionStorage.getItem("avtocena_mini")==="1";}catch{}
    active=active&&miniAppPathAllowed(pathname);setEnabled(active);
    if(active)document.documentElement.dataset.miniapp="true";else delete document.documentElement.dataset.miniapp;
    if(atCatalog)lastCatalog.current=location.pathname+location.search;
  },[pathname,atCatalog]);
  const back=useCallback(()=>{
    const modal=document.querySelector<HTMLDialogElement>('dialog[open]');if(modal){modal.close();return;}
    const filterClose=document.querySelector<HTMLButtonElement>('.ac-mobile-filter-sheet button[data-ac-mobile-close="1"],.ac-mobile-filter-sheet button[aria-label="Закрыть"]');if(filterClose){filterClose.click();return;}
    router.push(lastCatalog.current);
  },[router]);
  useEffect(()=>{
    if(!enabled||!sdkReady)return;
    const tg=app();if(!tg)return;
    tg.ready();tg.expand();
    const sync=()=>{if(tg.colorScheme==="light"||tg.colorScheme==="dark")document.documentElement.dataset.theme=tg.colorScheme;
      const safe=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)?Math.max(0,Math.min(160,n)):0;
      document.documentElement.style.setProperty("--ac-mini-top",`${safe(tg.safeAreaInset?.top)+safe(tg.contentSafeAreaInset?.top)}px`);
      document.documentElement.style.setProperty("--ac-mini-bottom",`${safe(tg.safeAreaInset?.bottom)+safe(tg.contentSafeAreaInset?.bottom)}px`);
    };sync();for(const event of ["themeChanged","safeAreaChanged","contentSafeAreaChanged"])tg.onEvent?.(event,sync);
    tg.BackButton?.onClick(back);if(atCatalog)tg.BackButton?.hide();else tg.BackButton?.show();
    return()=>{tg.BackButton?.offClick(back);tg.BackButton?.hide();for(const event of ["themeChanged","safeAreaChanged","contentSafeAreaChanged"])tg.offEvent?.(event,sync);};
  },[enabled,sdkReady,atCatalog,back]);
  useEffect(()=>{
    if(!enabled)return;
    const click=(event:MouseEvent)=>{
      if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const anchor=(event.target as Element)?.closest<HTMLAnchorElement>("a[href]");if(!anchor||anchor.hasAttribute("download"))return;
      const url=new URL(anchor.href,location.href);if(!["http:","https:"].includes(url.protocol))return;
      if(atCatalog)lastCatalog.current=location.pathname+location.search;
      const tg=app();if(url.hostname==="t.me"&&tg?.openTelegramLink){event.preventDefault();tg.openTelegramLink(url.href);}
      else if((url.origin!==location.origin||!miniAppPathAllowed(url.pathname))&&tg?.openLink){if(url.origin===location.origin)url.searchParams.set("mini","0");event.preventDefault();tg.openLink(url.href);}
    };document.addEventListener("click",click,true);return()=>document.removeEventListener("click",click,true);
  },[enabled,atCatalog]);
  if(!enabled)return null;
  return <>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={()=>setSdkReady(true)}/>
    <header className="ac-mini-header" aria-label="АвтоЦена в Telegram">
      {!atCatalog?<button type="button" onClick={back} aria-label="Назад в каталог">←</button>:null}
      <Link href="/mini" className="ac-mini-brand"><img src="/logo/avtocena-mark-light.svg" width={30} height={30} alt=""/><span>АвтоЦена</span></Link>
      <div className="ac-mini-city"><CitySelector value={city} onChange={()=>{}} triggerLabel={city||"Ваш город"}/></div>
    </header>
  </>;
}
