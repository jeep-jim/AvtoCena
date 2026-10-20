'use client';
import {createContext,useContext,useMemo,useState,useEffect,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
type SelectionContext={target:HTMLDivElement|null;setTarget:(target:HTMLDivElement|null)=>void;view:"grid"|"list";setView:(view:"grid"|"list")=>void};
const Context=createContext<SelectionContext|null>(null);
export function CatalogSelectionProvider({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLDivElement|null>(null);
 const [view,setView]=useState<"grid"|"list">("grid");
 useEffect(()=>{try{if(localStorage.getItem("ac-catalog-view")==="list")setView("list");}catch{}},[]);
 const chooseView=(next:"grid"|"list")=>{setView(next);try{localStorage.setItem("ac-catalog-view",next);}catch{}};
 const value={target,setTarget,view,setView:chooseView};
 return <Context.Provider value={value}><div className="ac-catalog-view" data-catalog-view={view}>{children}</div></Context.Provider>;
}
export function CatalogSelectionOutlet(){
 const context=useContext(Context);
 return <div className="ac-catalog-toolbar"><div ref={context?.setTarget} className="ac-catalog-selection hidden lg:block"/><div className="ac-catalog-view-toggle" role="group" aria-label="Вид каталога">{(["grid","list"] as const).map(mode=><button type="button" key={mode} aria-pressed={context?.view===mode} onClick={()=>context?.setView(mode)} title={mode==="grid"?"Плитка":"Список"}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{mode==="grid"?<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>:<><path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 5h1M3 12h1M3 19h1"/></>}</svg><span>{mode==="grid"?"Плитка":"Список"}</span></button>)}</div></div>;
}
export function CatalogDesktopSelection({children}:{children:ReactNode}){
 const context=useContext(Context);
 return context ? context.target ? createPortal(children,context.target) : null : <>{children}</>;
}

export function useCatalogView(){return useContext(Context)?.view || "grid";}
