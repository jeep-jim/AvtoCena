'use client';
import Link from 'next/link';
import {Fragment,type MouseEvent} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';

type PageLink={page:number;href:string};
/** The catalog's numbered navigation, shared by local directories and editorial lists. */
export function CatalogPagination({page,pageCount,links,previousHref,nextHref,label='Страницы каталога',onNavigate}:{page:number;pageCount:number;links:PageLink[];previousHref?:string;nextHref?:string;label?:string;onNavigate?:(page:number)=>void}){
 const click=(target:number)=>(event:MouseEvent<HTMLAnchorElement>)=>{if(!onNavigate||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();onNavigate(target);};
 return <nav aria-label={label} className="ac-pagination">
  {previousHref?<Link prefetch={false} href={previousHref} onClick={click(page-1)} aria-label="Предыдущая страница"><ChevronLeft size={20}/></Link>:<span aria-disabled="true"><ChevronLeft size={20}/></span>}
  {links.map((link,index)=><Fragment key={link.page}>
   {index>0&&link.page-links[index-1].page>1?<span aria-hidden="true">…</span>:null}
   <Link prefetch={false} href={link.href} onClick={click(link.page)} aria-label={`Страница ${link.page}`} aria-current={link.page===page?'page':undefined} className={link.page!==1&&link.page!==pageCount&&Math.abs(link.page-page)>1?'ac-page-extra':undefined}>{link.page}</Link>
  </Fragment>)}
  {nextHref?<Link prefetch={false} href={nextHref} onClick={click(page+1)} aria-label="Следующая страница"><ChevronRight size={20}/></Link>:<span aria-disabled="true"><ChevronRight size={20}/></span>}
 </nav>;
}
export function catalogPageNumbers(page:number,pageCount:number){const start=Math.max(1,Math.min(page-2,pageCount-4));return [...new Set([1,...Array.from({length:5},(_,i)=>start+i),pageCount])].filter(n=>n>=1&&n<=pageCount).sort((a,b)=>a-b);}
