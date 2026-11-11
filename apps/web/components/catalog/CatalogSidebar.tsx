import {RetainedCatalogResults} from './RetainedCatalogResults';
import type {ReactNode} from 'react';
import {CatalogSelectionProvider,CatalogSelectionOutlet} from './CatalogSelectionContext';
import './catalog-sidebar.css';
type Props={header?:ReactNode;filters:ReactNode;children:ReactNode;resultScope?:string;resultError?:string;dealerLayout?:boolean;brandRail?:ReactNode;headerAfterBrands?:ReactNode};
/** The public catalog keeps one rail in the DOM; CSS alone positions the slots. */
export function CatalogSidebar({header,filters,children,resultScope,resultError,dealerLayout=false,brandRail,headerAfterBrands}:Props){
 const singleRail=!dealerLayout&&brandRail!==undefined;
 return <CatalogSelectionProvider dealerLayout={dealerLayout}>
  <div className={`ac-catalog-layout${dealerLayout?' ac-dealer-catalog-layout':''}${singleRail?' ac-catalog-layout--single-brand-rail':''}`}>
   {header&&<div key="heading" className="ac-catalog-heading">{header}</div>}
   {singleRail&&<div key="brands" className="ac-catalog-brand-slot">{brandRail}</div>}
   {singleRail&&headerAfterBrands&&<div key="count" className="ac-catalog-count-slot">{headerAfterBrands}</div>}
   {dealerLayout&&<CatalogSelectionOutlet key="dealer-toolbar" dealerLayout/>}
   <aside key="filters" className="ac-catalog-sidebar" aria-label="Фильтры каталога"><div className="ac-catalog-sidebar-inner">{filters}</div></aside>
   {singleRail&&<div key="toolbar" className="ac-catalog-toolbar-slot"><CatalogSelectionOutlet/></div>}
   <div key="results" className="ac-catalog-results">
    {!dealerLayout&&!singleRail&&<CatalogSelectionOutlet/>}
    {resultScope?<RetainedCatalogResults scope={resultScope} error={resultError}>{children}</RetainedCatalogResults>:children}
   </div>
  </div>
 </CatalogSelectionProvider>;
}
