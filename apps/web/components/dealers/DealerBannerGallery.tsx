"use client";
import {useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import type {PublicDealerProfile} from '@/lib/dealers/public-profile';
export const DEFAULT_DEALER_BANNER='/dealers/default-cover.svg';
export function dealerBanners(s:PublicDealerProfile){return [{id:'main',desktop:s.banner,mobile:s.bannerMobile||''},...(s.extraBanners||[])].filter(b=>b.desktop||b.mobile).slice(0,5);}
export function DealerBannerGallery({s,media=false,children}:{s:PublicDealerProfile;media?:boolean;children?:React.ReactNode}){
 const banners=dealerBanners(s),[index,setIndex]=useState(0),dialog=useRef<HTMLDialogElement>(null);
 const current=banners[Math.min(index,Math.max(0,banners.length-1))]||{desktop:DEFAULT_DEALER_BANNER,mobile:''};
 const picture=(large=false)=><picture>{current.mobile&&<source media="(max-width: 800px)" srcSet={current.mobile}/>}<img src={current.desktop||current.mobile} alt={`Обложка ${s.name}${banners.length>1?` · ${index+1}`:''}`} className={large?'dealer-banner-full':'dealer-cover'} fetchPriority={media?'auto':'high'}/></picture>;
 return <div className={media?'dealer-media-banners':'dealer-profile-hero'}>
  <button type="button" className="dealer-cover-open" aria-label="Рассмотреть баннер" onClick={()=>dialog.current?.showModal()}>{picture()}</button>
  {banners.length>1&&<nav className="dealer-banner-dots" aria-label="Баннеры компании">{banners.map((b,i)=><button key={b.id} type="button" aria-label={`Баннер ${i+1}`} aria-pressed={i===index} onClick={()=>setIndex(i)}><span/></button>)}</nav>}
  {children}
  <dialog ref={dialog} className="dealer-banner-dialog" aria-label="Баннер компании" onClick={e=>{if(e.target===dialog.current)dialog.current.close();}}><button type="button" className="dealer-logo-close" aria-label="Закрыть баннер" onClick={()=>dialog.current?.close()}><X/></button>{picture(true)}{banners.length>1&&<div className="dealer-banner-controls"><button type="button" aria-label="Предыдущий баннер" onClick={()=>setIndex((index-1+banners.length)%banners.length)}><ChevronLeft/></button><span>{index+1} / {banners.length}</span><button type="button" aria-label="Следующий баннер" onClick={()=>setIndex((index+1)%banners.length)}><ChevronRight/></button></div>}</dialog>
 </div>;
}
