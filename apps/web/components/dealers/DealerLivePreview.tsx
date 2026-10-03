"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Smartphone} from 'lucide-react';
import {DealerProfileContent} from './DealerProfileContent';
import {CatalogMarketFlag} from '@/components/catalog/CatalogMarketFlag';
import {publicDealerProfile} from '@/lib/dealers/public-profile';
import {publicRail} from '@/lib/dealers/public-rail';
import {DEALER_MARKETS} from '@/lib/dealers/catalog-markets';
import {applyBasicAccess} from '@/lib/dealers/program-model';
import type {DealerShowcase} from '@/lib/dealers/showcase-model';

const documentHtml='<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="dealer-preview-root"></div></body></html>';
/** An actual narrow viewport keeps public media queries and styles isolated from CRM. */
export function DealerLivePreview({value,section,verified,fullAccess}:{value:DealerShowcase;section:string;verified:boolean;fullAccess:boolean}){
 const frame=useRef<HTMLIFrameElement>(null);
 const [mount,setMount]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  if(!mount)return;
  const doc=mount.ownerDocument;
  const syncTheme=()=>{doc.documentElement.className=document.documentElement.className;if(document.documentElement.dataset.theme)doc.documentElement.dataset.theme=document.documentElement.dataset.theme;else delete doc.documentElement.dataset.theme;};
  const syncStyles=()=>{
   doc.head.querySelectorAll('[data-preview-style]').forEach(n=>n.remove());
   document.querySelectorAll('style,link[rel="stylesheet"]').forEach(node=>{
    if(node.tagName==='STYLE'&&node.textContent?.includes('.dealer-editor-shell'))return;
    const copy=node.cloneNode(true) as HTMLElement;copy.dataset.previewStyle='true';
    if(copy instanceof HTMLLinkElement)copy.href=(node as HTMLLinkElement).href;
    doc.head.appendChild(copy);
   });
  };
  syncTheme();syncStyles();
  const themeObserver=new MutationObserver(syncTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme']});
  const stylesObserver=new MutationObserver(syncStyles);stylesObserver.observe(document.head,{childList:true});
  return()=>{themeObserver.disconnect();stylesObserver.disconnect();};
 },[mount]);
 const s=fullAccess?value:applyBasicAccess(value);
 const profile=publicDealerProfile(s);
 return <aside className="dealer-live-preview" aria-label="Мобильный предпросмотр страницы дилера">
  <header><Smartphone size={18}/><strong>Мобильная страница</strong><span>Вживую</span></header>
  <iframe ref={frame} title="Мобильный предпросмотр дилера" srcDoc={documentHtml} onLoad={()=>setMount(frame.current?.contentDocument?.getElementById('dealer-preview-root')||null)}/>
  {mount&&createPortal(<main className="ac-page-copy" style={{background:'var(--ac-bg)',color:'var(--ac-text)',minHeight:'100vh',padding:0}}><DealerProfileContent s={profile} verified={verified} editorSection={section} items={publicRail(s)} catalog={profile.catalogMarkets.length>0?<section className="dealer-preview-markets" style={{padding:'16px'}}><h2 style={{fontSize:18,fontWeight:750,marginBottom:12}}>Автомобили под заказ</h2><div className="dealer-city-chips">{DEALER_MARKETS.filter(m=>profile.catalogMarkets.includes(m.id)).map(m=><span key={m.id}><CatalogMarketFlag market={m.id}/>{m.label}</span>)}</div></section>:null}/></main>,mount)}
 </aside>;
}
