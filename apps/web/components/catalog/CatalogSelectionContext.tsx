'use client';
import {CatalogViewIcon} from './CatalogViewIcon';
import {createContext,useContext,useState,useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
type ResultCount={queryKey:string;text:string;total?:number};
type SelectionContext={target:HTMLDivElement|null;setTarget:(target:HTMLDivElement|null)=>void;view:"grid"|"list";setView:(view:"grid"|"list")=>void};
const Context=createContext<SelectionContext|null>(null);
export function CatalogSelectionProvider({children,dealerLayout=false}:{children:ReactNode;dealerLayout?:boolean}){
 const [target,setTarget]=useState<HTMLDivElement|null>(null);
 const [view,setView]=useState<"grid"|"list">("grid");
 useEffect(()=>{try{if(localStorage.getItem("ac-catalog-view")==="list")setView("list");}catch{}},[]);
 const chooseView=(next:"grid"|"list")=>{setView(next);try{localStorage.setItem("ac-catalog-view",next);}catch{}};
 const [desktop,setDesktop]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia(dealerLayout?"(min-width:768px)":"(min-width:1024px)");
  const sync=()=>setDesktop(media.matches);
  sync();media.addEventListener("change",sync);
  return ()=>media.removeEventListener("change",sync);
 },[dealerLayout]);
 const effectiveView=desktop?view:"grid";
 const value={target,setTarget,view:effectiveView,setView:chooseView};
 return <Context.Provider value={value}><ResultCountProvider><div className="ac-catalog-view" data-catalog-view={effectiveView}>{children}</div></ResultCountProvider></Context.Provider>;
}
export function CatalogSelectionOutlet({dealerLayout=false}:{dealerLayout?:boolean}){
 const context=useContext(Context);
 const toolbar=useRef<HTMLDivElement>(null);
 const toggle=useRef<HTMLDivElement>(null);
 const selection=context?.target;
 const [compact,setCompact]=useState(false);
 useEffect(()=>{
  const bar=toolbar.current;
  const controls=toggle.current;
  if(!dealerLayout||!selection||!bar||!controls)return;
  const update=()=>{
   const chips=selection.firstElementChild;
   const chipWidths=chips?Array.from(chips.children).reduce((width,chip)=>width+chip.getBoundingClientRect().width,0):0;
   const gaps=chips?chips.children.length*8+16:0;
   const labelWidths=Array.from(controls.querySelectorAll("button span")).reduce((width,label)=>width+label.getBoundingClientRect().width+7,0);
   const iconWidth=controls.clientWidth-(controls.dataset.compact==="true"?0:labelWidths);
   setCompact(Boolean(chips)&&chipWidths+gaps+iconWidth+labelWidths>bar.clientWidth);
  };
  const resize=new ResizeObserver(update);
  const mutations=new MutationObserver(update);
  resize.observe(bar);
  resize.observe(selection);
  mutations.observe(selection,{childList:true,subtree:true,characterData:true});
  update();
  return ()=>{resize.disconnect();mutations.disconnect();};
 },[dealerLayout,selection]);
 return <div ref={toolbar} className={`ac-catalog-toolbar${dealerLayout?" ac-dealer-catalog-toolbar":""}`}>
  <div ref={context?.setTarget} className="ac-catalog-selection hidden lg:block"/>
  <div ref={toggle} data-compact={compact} className="ac-catalog-view-toggle" role="group" aria-label="Вид каталога">
   {(["grid","list"] as const).map(mode=>{
    const label=mode==="grid"?"Плитка":"Список";
    return <button type="button" key={mode} aria-pressed={context?.view===mode} onClick={()=>context?.setView(mode)} aria-label={label} title={label}><CatalogViewIcon mode={mode}/><span>{label}</span></button>;
   })}
  </div>
 </div>;
}
export function CatalogDesktopSelection({children}:{children:ReactNode}){
 const context=useContext(Context);
 return context ? context.target ? createPortal(children,context.target) : null : <>{children}</>;
}

export function useCatalogView(){return useContext(Context)?.view || "grid";}

// Keep count updates separate from view/selection consumers (including cards).
const ResultCountContext=createContext<{value:ResultCount|null;set:(count:ResultCount)=>void}|null>(null);
function ResultCountProvider({children}:{children:ReactNode}){
 const [value,set]=useState<ResultCount|null>(null);
 return <ResultCountContext.Provider value={{value,set}}>{children}</ResultCountContext.Provider>;
}
// Share the already streamed server aggregate with the open filter sheet.
// Query identity prevents retained/older results from becoming the current count.
export function CatalogResultCountUpdate({queryKey,text,total}:ResultCount){
 const set=useContext(ResultCountContext)?.set;
 useEffect(()=>{set?.({queryKey,text,total});},[set,queryKey,text,total]);
 return null;
}
export function useCatalogResultCount(){return useContext(ResultCountContext)?.value;}
