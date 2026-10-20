import type {ReactNode} from 'react';
import './catalog-sidebar.css';
export function CatalogSidebar({filters,children}:{filters:ReactNode;children:ReactNode}){
 return <div className="ac-catalog-layout"><aside className="ac-catalog-sidebar" aria-label="Фильтры каталога"><div className="ac-catalog-sidebar-inner">{filters}</div></aside><div className="ac-catalog-results">{children}</div></div>;
}
