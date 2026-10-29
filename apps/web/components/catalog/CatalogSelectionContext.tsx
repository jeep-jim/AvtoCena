'use client';
import {CatalogViewIcon} from './CatalogViewIcon';
import {createContext,useContext,useState,useEffect,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
type ResultCount={queryKey:string;text:string};
type SelectionContext={resultCount:ResultCount|null;setResultCount:(count:ResultCount)=>void;target:HTMLDivElement|null;setTarget:(target:HTMLDivElement|null)=>void;view:"grid"|"list";setView:(view:"grid"|"list")=>void};
const Context=createContext<SelectionContext|null>(null);
export function CatalogSelectionProvider({children}:{children:ReactNode}){
 const [resultCount,setResultCount]=useState<ResultCount|null>(null);
 const [target,setTarget]=useState<HTMLDivElement|null>(null);
 const [view,setView]=useState<"grid"|"list">("grid");
 useEffect(()=>{try{if(localStorage.getItem("ac-catalog-view")==="list")setView("list");}catch{}},[]);
 const chooseView=(next:"grid"|"list")=>{setView(next);try{localStorage.setItem("ac-catalog-view",next);}catch{}};
 const [desktop,setDesktop]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia("(min-width:1024px)");
  const sync=()=>setDesktop(media.matches);
  sync();media.addEventListener("change",sync);
  return ()=>media.removeEventListener("change",sync);
 },[]);
 const effectiveView=desktop?view:"grid";
 const value={resultCount,setResultCount,target,setTarget,view:effectiveView,setView:chooseView};
 return <Context.Provider value={value}><div className="ac-catalog-view" data-catalog-view={effectiveView}>{children}</div></Context.Provider>;
}
export function CatalogSelectionOutlet(){
 const context=useContext(Context);
 return <div className="ac-catalog-toolbar"><div ref={context?.setTarget} className="ac-catalog-selection hidden lg:block"/><div className="ac-catalog-view-toggle" role="group" aria-label="Вид каталога">{(["grid","list"] as const).map(mode=><button type="button" key={mode} aria-pressed={context?.view===mode} onClick={()=>context?.setView(mode)} title={mode==="grid"?"Плитка":"Список"}><CatalogViewIcon mode={mode}/><span>{mode==="grid"?"Плитка":"Список"}</span></button>)}</div></div>;
}
export function CatalogDesktopSelection({children}:{children:ReactNode}){
 const context=useContext(Context);
 return context ? context.target ? createPortal(children,context.target) : null : <>{children}</>;
}

export function useCatalogView(){return useContext(Context)?.view || "grid";}

// Share the already streamed server aggregate with the open filter sheet.
// Query identity prevents retained/older results from becoming the current count.
export function CatalogResultCountUpdate({queryKey,text}:ResultCount){
 const set=useContext(Context)?.setResultCount;
 useEffect(()=>{set?.({queryKey,text});},[set,queryKey,text]);
 return null;
}
export function useCatalogResultCount(){return useContext(Context)?.resultCount;}
