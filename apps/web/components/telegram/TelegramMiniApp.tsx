"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import Script from "next/script";
import {usePathname,useRouter} from "next/navigation";
import {CitySelector} from "../home/CitySelector";
import {useSelectedCity} from "../../lib/location/selected-city";
import {miniAppPathAllowed,miniAppLaunchPath,syncMiniAppPresentation} from "../../lib/telegram-miniapp";

type TelegramWebApp = {
  initDataUnsafe?:{start_param?:string};
  ready:()=>void;expand:()=>void;colorScheme?:string;
  safeAreaInset?:{top:number;bottom:number};contentSafeAreaInset?:{top:number;bottom:number};
  BackButton?:{show:()=>void;hide:()=>void;onClick:(f:()=>void)=>void;offClick:(f:()=>void)=>void};
  onEvent?:(name:string,callback:()=>void)=>void;offEvent?:(name:string,callback:()=>void)=>void;
  setHeaderColor?:(color:string)=>void;setBackgroundColor?:(color:string)=>void;
  openLink?:(url:string)=>void;openTelegramLink?:(url:string)=>void;
};
function app(){return (window as Window & {Telegram?:{WebApp?:TelegramWebApp}}).Telegram?.WebApp;}
export function TelegramMiniApp(){
  const pathname=usePathname()||"";const router=useRouter();const city=useSelectedCity();
  const [enabled,setEnabled]=useState(false),[sdkReady,setSdkReady]=useState(false);
  const lastCatalog=useRef("/mini"),launchHandled=useRef(false);
  const [favoriteCount,setFavoriteCount]=useState(0);
  const [theme,setTheme]=useState<"light"|"dark">("dark");
  const manualTheme=useRef<"light"|"dark"|null>(null);
  const applyTheme=useCallback((value:"light"|"dark")=>{
    setTheme(value);document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;
    const color=value==="light"?"#ffffff":"#0f172a";
    const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');if(meta)meta.content=color;
    try{app()?.setHeaderColor?.(color);app()?.setBackgroundColor?.(color);}catch{}
    window.dispatchEvent(new CustomEvent("avtocena:theme-changed",{detail:{theme:value}}));
  },[]);
  useEffect(()=>{
    if(!enabled)return;
    try{const saved=localStorage.getItem("avtocena_mini_theme");if(saved==="light"||saved==="dark")manualTheme.current=saved;}catch{}
    const current=app()?.colorScheme||document.documentElement.dataset.theme;
    applyTheme(manualTheme.current||(current==="light"?"light":"dark"));
  },[enabled,applyTheme]);
  function toggleTheme(){const value=theme==="dark"?"light":"dark";manualTheme.current=value;try{localStorage.setItem("avtocena_mini_theme",value);}catch{}applyTheme(value);}

  const atCatalog=pathname==="/mini"||pathname==="/cars"||pathname==="/cars/green";
  useEffect(()=>{
    setEnabled(syncMiniAppPresentation());
    if(atCatalog)lastCatalog.current=location.pathname+location.search;
  },[pathname,atCatalog]);
  useEffect(()=>{
    if(!enabled || pathname!=="/mini" || launchHandled.current)return;
    const parameter=new URLSearchParams(location.search).get("tgWebAppStartParam") || (sdkReady ? app()?.initDataUnsafe?.start_param : undefined);
    const target=miniAppLaunchPath(parameter);
    if(target){launchHandled.current=true;lastCatalog.current="/mini";router.replace(target);}
  },[enabled,sdkReady,pathname,router]);
  useEffect(()=>{
    if(!enabled)return;
    const sync=()=>{try{const rows=JSON.parse(localStorage.getItem("avtocena_favorites")||"[]");setFavoriteCount(Array.isArray(rows)?rows.filter(x=>x?.id).length:0);}catch{setFavoriteCount(0);}};
    sync();window.addEventListener("storage",sync);window.addEventListener("avtocena:favorites-changed",sync);
    return()=>{window.removeEventListener("storage",sync);window.removeEventListener("avtocena:favorites-changed",sync);};
  },[enabled]);
  const back=useCallback(()=>{
    if(window.history.length>1)window.history.back();
    else router.push(lastCatalog.current);
  },[router]);
  useEffect(()=>{
    if(!enabled||!sdkReady)return;
    const tg=app();if(!tg)return;
    tg.ready();tg.expand();
    const sync=()=>{if(manualTheme.current)applyTheme(manualTheme.current);else if(tg.colorScheme==="light"||tg.colorScheme==="dark")applyTheme(tg.colorScheme);
      const safe=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)?Math.max(0,Math.min(160,n)):0;
      document.documentElement.style.setProperty("--ac-mini-top",`${safe(tg.safeAreaInset?.top)+safe(tg.contentSafeAreaInset?.top)}px`);
      document.documentElement.style.setProperty("--ac-mini-bottom",`${safe(tg.safeAreaInset?.bottom)+safe(tg.contentSafeAreaInset?.bottom)}px`);
    };sync();for(const event of ["themeChanged","safeAreaChanged","contentSafeAreaChanged"])tg.onEvent?.(event,sync);
    tg.BackButton?.onClick(back);if(atCatalog)tg.BackButton?.hide();else tg.BackButton?.show();
    return()=>{tg.BackButton?.offClick(back);tg.BackButton?.hide();for(const event of ["themeChanged","safeAreaChanged","contentSafeAreaChanged"])tg.offEvent?.(event,sync);};
  },[enabled,sdkReady,atCatalog,back,applyTheme]);
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
      <Link href="/" className="ac-mini-brand" aria-label="АвтоЦена — главная"><img src="/logo/avtocena-mark-light.svg" width={30} height={30} alt=""/><span>АвтоЦена</span></Link>
      <Link href="/favorites" className="ac-mini-favorites" aria-label={`Избранное${favoriteCount ? `: ${favoriteCount}` : ""}`} aria-current={pathname==="/favorites"?"page":undefined} title="Избранное">
        <svg width="24" height="24" viewBox="0 0 24 24" fill={pathname==="/favorites"?"currentColor":"none"} aria-hidden="true"><path d="M12 2.7L14.85 8.5L21.25 9.43L16.62 13.94L17.71 20.31L12 17.31L6.29 20.31L7.38 13.94L2.75 9.43L9.15 8.5L12 2.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>
        {favoriteCount>0?<span>{favoriteCount}</span>:null}
      </Link>
      <button type="button" className="ac-mini-theme" onClick={toggleTheme} aria-label={theme==="dark"?"Включить светлую тему":"Включить тёмную тему"} title={theme==="dark"?"Светлая тема":"Тёмная тема"}>
        {theme==="dark"?<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.2A8.4 8.4 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>}
      </button>
      <div className="ac-mini-city"><CitySelector value={city} onChange={()=>{}} triggerLabel={city||"Ваш город"}/></div>
    </header>
  </>;
}
