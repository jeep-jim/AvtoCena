import Link from 'next/link';
import type {ReactNode} from 'react';
import {NavigationBadge} from './NavigationBadge';
export function CrmNavigationLinks({links,activeHref,counts={},label='Разделы CRM',className='',children}:{links:Array<readonly [string,string]>;activeHref:string;counts?:Record<string,number>;label?:string;className?:string;children?:ReactNode}){
 return <nav className={`crm-navigation crm-navigation-counted ${className}`} aria-label={label}>{links.map(([href,name])=><Link key={href} href={href} prefetch={false} className={href==='/crm/documents'?'crm-documents-button':undefined} aria-label={`${name}${counts[href]?`, новых действий: ${counts[href]}`:''}`} aria-current={href===activeHref?'page':undefined}>{name}<NavigationBadge count={counts[href]||0}/></Link>)}{children}</nav>;
}
