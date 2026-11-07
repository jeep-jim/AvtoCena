import {RetainedCatalogResults} from '../../apps/web/components/catalog/RetainedCatalogResults';
import type {ReactNode} from 'react';
import {CatalogSelectionProvider,CatalogSelectionOutlet} from '../../apps/web/components/catalog/CatalogSelectionContext';
import '../../apps/web/components/catalog/catalog-sidebar.css';
export function CatalogSidebarBaseline({header,filters,children,resultScope,resultError,dealerLayout=false}:{header?:ReactNode;filters:ReactNode;children:ReactNode;resultScope?:string;resultError?:string;dealerLayout?:boolean}){
 return <CatalogSelectionProvider dealerLayout={dealerLayout}><div className={`ac-catalog-layout${dealerLayout?" ac-dealer-catalog-layout":""}`}>{header&&<div className="ac-catalog-heading">{header}</div>}{dealerLayout&&<CatalogSelectionOutlet dealerLayout/>}<aside className="ac-catalog-sidebar" aria-label="Фильтры каталога"><div className="ac-catalog-sidebar-inner">{filters}</div></aside><div className="ac-catalog-results">{!dealerLayout&&<CatalogSelectionOutlet/>}{resultScope?<RetainedCatalogResults scope={resultScope} error={resultError}>{children}</RetainedCatalogResults>:children}</div></div></CatalogSelectionProvider>;
}
