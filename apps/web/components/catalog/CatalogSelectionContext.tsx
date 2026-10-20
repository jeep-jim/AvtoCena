'use client';
import {createContext,useContext,useMemo,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
type SelectionContext={target:HTMLDivElement|null;setTarget:(target:HTMLDivElement|null)=>void};
const Context=createContext<SelectionContext|null>(null);
export function CatalogSelectionProvider({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLDivElement|null>(null);
 const value=useMemo(()=>({target,setTarget}),[target]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function CatalogSelectionOutlet(){
 const context=useContext(Context);
 return <div ref={context?.setTarget} className="ac-catalog-selection hidden lg:block"/>;
}
export function CatalogDesktopSelection({children}:{children:ReactNode}){
 const context=useContext(Context);
 return context ? context.target ? createPortal(children,context.target) : null : <>{children}</>;
}
