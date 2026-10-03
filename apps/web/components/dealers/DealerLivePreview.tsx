"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {DealerProfileContent} from './DealerProfileContent';
import {CatalogMarketFlag} from '@/components/catalog/CatalogMarketFlag';
import {publicDealerProfile} from '@/lib/dealers/public-profile';
import {publicRail} from '@/lib/dealers/public-rail';
import {DEALER_MARKETS} from '@/lib/dealers/catalog-markets';
import {applyBasicAccess} from '@/lib/dealers/program-model';
import type {DealerShowcase} from '@/lib/dealers/showcase-model';

const documentHtml='<!doctype html><html lang="ru" data-dealer-editor-preview="true"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="dealer-preview-root"></div></body></html>';
/** An actual narrow viewport keeps public media queries and styles isolated from CRM. */
export function DealerLivePreview({value,section,verified,fullAccess}:{value:DealerShowcase;section:string;verified:boolean;fullAccess:boolean}){
 const frame=useRef<HTMLIFrameElement>(null);
 const [mount,setMount]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  const iframe=frame.current;
  if(!iframe)return;
  const connect=()=>setMount(iframe.contentDocument?.getElementById('dealer-preview-root')||null);
  // srcDoc may finish loading before React hydrates the server-rendered iframe.
  // Connect an existing document as well as subsequent document loads.
  iframe.addEventListener('load',connect);
  connect();
  return()=>iframe.removeEventListener('load',connect);
 },[]);
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
  <iframe ref={frame} title="Мобильный предпросмотр дилера" srcDoc={documentHtml}/>
  {mount&&createPortal(<main className="ac-page-copy dealer-preview-page" style={{background:'var(--ac-bg)',color:'var(--ac-text)',minHeight:'100vh',padding:0}}><style>{`html[data-dealer-editor-preview] body,html[data-dealer-editor-preview] #dealer-preview-root,html[data-dealer-editor-preview] body main.dealer-preview-page{margin:0!important;padding:0!important;border:0!important}html[data-dealer-editor-preview]{--ac-header-height:0px;--ac-public-header-height:0px}html[data-dealer-editor-preview] .dealer-profile-hero{top:0!important}`}</style><DealerProfileContent s={profile} verified={verified} editorSection={section} items={publicRail(s)} catalog={profile.catalogMarkets.length>0?<section className="dealer-preview-markets" style={{padding:'16px'}}><h2 style={{fontSize:18,fontWeight:750,marginBottom:12}}>Автомобили под заказ</h2><div className="dealer-city-chips">{DEALER_MARKETS.filter(m=>profile.catalogMarkets.includes(m.id)).map(m=><span key={m.id}><CatalogMarketFlag market={m.id}/>{m.label}</span>)}</div></section>:null}/></main>,mount)}
 </aside>;
}
