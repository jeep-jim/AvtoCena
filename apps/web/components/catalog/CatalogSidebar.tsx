import type {ReactNode} from 'react';
import {CatalogSelectionProvider,CatalogSelectionOutlet} from './CatalogSelectionContext';
import './catalog-sidebar.css';
export function CatalogSidebar({header,filters,children}:{header?:ReactNode;filters:ReactNode;children:ReactNode}){
 return <CatalogSelectionProvider><div className="ac-catalog-layout">{header&&<div className="ac-catalog-heading">{header}</div>}<aside className="ac-catalog-sidebar" aria-label="Фильтры каталога"><div className="ac-catalog-sidebar-inner">{filters}</div></aside><div className="ac-catalog-results"><CatalogSelectionOutlet/>{children}</div></div></CatalogSelectionProvider>;
}
