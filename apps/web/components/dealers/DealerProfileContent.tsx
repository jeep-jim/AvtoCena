"use client";
import {PublicSheet} from '@/components/ui/PublicSheet';
import {DealerSubscriptionButton} from './DealerSubscription';
import {DealerDescription} from './DealerDescription';
import {LeadDialog} from '@/components/leads/PublicLeadCaptureV2';
import {DealerBannerGallery,dealerBanners} from './DealerBannerGallery';
import {DealerRequisites} from './DealerRequisites';
import {Star,MapPin,BadgeCheck} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {DealerLink as Link} from './DealerBrowsingContext';
import {CatalogMarketFlag} from '@/components/catalog/CatalogMarketFlag';
import {ChevronDown,ChevronUp,ArrowUpRight,ArrowRight} from 'lucide-react';
import type {PublicDealerProfile} from '@/lib/dealers/public-profile';
import {DEALER_MARKETS} from '@/lib/dealers/catalog-markets';
import {SpecialRail,type SpecialRailItem} from './SpecialRail';
import {BuyerGallery} from '@/components/home/BuyerGallery';
import {DealerMap} from './DealerMap';
import {dealerProfileStyles} from './DealerProfileStyles';
import {yandexOfficeUrls} from '@/lib/dealers/yandex-map';
export type DealerProfileTab='cars'|'specials'|'about'|'photos'|'reviews';
type Tab=DealerProfileTab;
function Icon({name}:{name:string}){
 const paths:Record<string,React.ReactNode>={home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></>,cars:<><path d="m5 6-2 7v6h3v-2h12v2h3v-6l-2-7Z"/><path d="M3 12h18M7 15h1m8 0h1"/></>,photos:<><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,pin:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,message:<><path d="M21 11a8 8 0 0 1-8 8H7l-5 3 1.5-6A8 8 0 1 1 21 11Z"/><path d="M8 10h8m-8 4h5"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,heart:<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,share:<><path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8"/></>,close:<path d="m6 6 12 12M18 6 6 18"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>};
 return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.info}</svg>;
}
function RatingIcon(){return <svg className="dealer-rating-icon" width="24" height="24" viewBox="0 0 28 28" aria-hidden="true"><path d="m13 5 2.8 6 6.5.9-4.7 4.6 1.1 6.5-5.7-3-5.8 3 1.1-6.5L3.6 12l6.5-.9Z" fill="#f7bf27"/><path d="m23 0 1.2 3.6L28 5l-3.8 1.3L23 10l-1.3-3.7L18 5l3.7-1.4Z" fill="#4f9fee"/><path d="m4 20 1.1 2.8L8 24l-2.9 1.1L4 28l-1.1-2.9L0 24l2.9-1.2Z" fill="#26b87b"/></svg>;}
function OfferIcon(){return <svg className="dealer-offer-icon" width="28" height="24" viewBox="0 0 32 26" aria-hidden="true"><path d="m5 12 4-7h13l5 7 3 2v7H2v-7Z" fill="#ee424d"/><path d="m10 7-3 6h17l-4-6Z" fill="#e5eef5"/><path d="M16 7v6" stroke="#ee424d" strokeWidth="2"/><path d="M4 16h4m17 0h3" stroke="#fff" strokeWidth="2"/><circle cx="8" cy="21" r="4" fill="#20242b"/><circle cx="24" cy="21" r="4" fill="#20242b"/><circle cx="8" cy="21" r="1.5" fill="#aab4c0"/><circle cx="24" cy="21" r="1.5" fill="#aab4c0"/></svg>;}
export function DealerProfileContent({s,preview=false,items=[],catalog,verified=false,editorSection}:{s:PublicDealerProfile;preview?:boolean;items?:SpecialRailItem[];catalog?:React.ReactNode;verified?:boolean;editorSection?:string}){
 const [tab,setTab]=useState<Tab>('cars'),[shareStatus,setShareStatus]=useState('');
 const [leadOpen,setLeadOpen]=useState(false);
 const logoDialog=useRef<HTMLDialogElement>(null);
 const specialSection=useRef<HTMLDivElement>(null);
 const dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLElement>(null),top=useRef<HTMLDivElement>(null);
 const [officeId,setOfficeId]=useState(s.offices[0]?.id||'');
 const office=s.offices.find(o=>o.id===officeId)||s.offices[0];
 const photos=s.buyersEnabled?s.buyerPhotos:[];
 const request=`/request?dealer=${encodeURIComponent(s.dealerId)}`;
 useEffect(()=>{
  if(editorSection)return;
  const navigate=(scroll:boolean)=>{const hash=location.hash;const value=hash==='#offices'?'about':hash.slice(1);if(['','cars','photos','about','specials','reviews'].includes(value)){setTab((value==='specials'?'cars':value||'cars') as Tab);if(scroll&&value==='specials')requestAnimationFrame(()=>specialSection.current?.scrollIntoView({block:'start'}));}};
  navigate(false);const initial=requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}));
  const changed=()=>navigate(true);window.addEventListener('hashchange',changed);return()=>{cancelAnimationFrame(initial);window.removeEventListener('hashchange',changed);};
 },[s.dealerId,editorSection]);
 useEffect(()=>{const el=top.current;if(!el)return;const header=el.ownerDocument.querySelector('.ac-public-header');if(!header)return;const measure=()=>el.style.setProperty('--dealer-header-height',`${header.getBoundingClientRect().height}px`);measure();const observer=new ResizeObserver(measure);observer.observe(header);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(editorSection)return;const openCatalog=()=>{setTab('cars');requestAnimationFrame(()=>body.current?.scrollIntoView({block:'start'}));};window.addEventListener('avtocena:dealer-section',openCatalog);return()=>window.removeEventListener('avtocena:dealer-section',openCatalog);},[]);
 function selectTab(value:Tab){setTab(value==='specials'?'cars':value);}
 function scrollToElement(el:HTMLElement|null){if(!el)return;if(editorSection){const win=el.ownerDocument.defaultView;win?.scrollTo({top:el.getBoundingClientRect().top+win.scrollY,behavior:'smooth'});}else el.scrollIntoView({behavior:'smooth',block:'start'});}
 function section(value:Tab){selectTab(value);if(value==='specials')requestAnimationFrame(()=>scrollToElement(specialSection.current));else if(value==='cars')requestAnimationFrame(()=>scrollToElement(top.current));}
 function openOffice(){dialog.current?.showModal();}
 async function share(){if(editorSection){setShareStatus('Ссылка доступна на странице компании');return;}try{const url=new URL(location.href);url.search='';url.hash='';if(navigator.share)await navigator.share({title:s.name,url:url.toString()});else{await navigator.clipboard.writeText(`${s.name}\n${url}`);setShareStatus('Ссылка скопирована');}}catch(e){if((e as Error).name!=='AbortError')setShareStatus('Не удалось поделиться ссылкой');}}
 useEffect(()=>{
  if(!editorSection)return;
  setTab(editorSection==='buyers'?'photos':['offices','requisites','markets'].includes(editorSection)?'about':'cars');
  if(['overview','profile'].includes(editorSection)){const win=top.current?.ownerDocument.defaultView;win?.scrollTo({top:0,behavior:'instant'});}
 },[editorSection]);
 const logo=<>{s.logoLight||s.logoDark?<><img src={s.logoLight||s.logoDark} alt={`Логотип ${s.name}`} className="dealer-logo-light"/><img src={s.logoDark||s.logoLight} alt={`Логотип ${s.name}`} className="dealer-logo-dark"/></>:<img className="dealer-default-logo" src="/logo/avtocena-mark-dark.svg" alt="АвтоЦена"/>}</>;
 return <div ref={top} className="dealer-profile mx-auto w-full max-w-[1500px] px-4 md:px-8" onClickCapture={editorSection?e=>{if((e.target as HTMLElement).closest('a'))e.preventDefault();}:undefined}>
  <DealerBannerGallery s={s}/>
  <div className="dealer-profile-sheet">
  <section className="dealer-profile-identity dealer-sheet">
   <div className="dealer-identity-row">
    <button type="button" className="dealer-avatar dealer-avatar-centered" aria-label={`Открыть логотип ${s.name}${verified?' · Проверенный дилер':''}`} onClick={()=>logoDialog.current?.showModal()}><span className="dealer-avatar-face">{logo}</span></button>
    <div className="dealer-profile-metrics"><button type="button" onClick={()=>section('reviews')}><RatingIcon/><strong>—</strong><span>Рейтинг</span></button><button type="button" onClick={()=>section('specials')}><OfferIcon/><strong>{items.length.toLocaleString('ru-RU')}</strong><span>Предложения</span></button></div>
    <p className="dealer-identity-divider"><span>{verified&&<BadgeCheck className="dealer-verified-mark" size={20} aria-label="Проверенный дилер"/>}Дилер</span></p>
    <div className="dealer-identity-title"><div className="dealer-title-line"><h1>{s.name}</h1></div></div>
   </div>
   <DealerDescription text={s.description||'Компания готовит информацию о себе.'}/>
  </section>
  <div className="dealer-profile-actions"><button type="button" onClick={()=>void share()}><Icon name="share"/><span>Поделиться</span></button><DealerSubscriptionButton s={s} preview={!!editorSection}/></div>{shareStatus&&<p className="dealer-action-status" role="status">{shareStatus}</p>}

  <div className="dealer-profile-body"><section ref={body} className="dealer-tab-content" aria-label={tab==='cars'?'Каталог АвтоЦены':tab==='specials'?'Предложения дилера':tab==='photos'?'Фотографии компании':tab==='reviews'?'Отзывы о дилере':'Контакты компании'}>
   <div>
    {photos.length>0&&<div className="dealer-stories"><BuyerGallery title="Наши фото и Автовыдачи" dealerName={s.name} images={photos.map(p=>p.url)} autoScroll={false}/></div>}
    <div ref={specialSection} className="dealer-main-offers"><SpecialRail heading={s.specialHeading} items={items}/></div>{s.catalogMarkets.length>0&&catalog}
   </div>

  </section></div>
  <footer className="dealer-profile-footer"><DealerRequisites value={s.requisites}/></footer>
  </div>
  <nav className="dealer-dock" aria-label="Быстрое меню дилера"><button type="button" aria-pressed={tab==='cars'||tab==='specials'} onClick={()=>section('cars')}><Icon name="cars"/><span>Каталог</span></button><button type="button" aria-pressed={tab==='photos'} onClick={()=>section('photos')}><Icon name="photos"/><span>Медиа</span></button><button type="button" aria-pressed={tab==='about'} onClick={()=>section('about')}><Icon name="pin"/><span>Адреса</span></button><button type="button" aria-pressed={tab==='reviews'} onClick={()=>section('reviews')}><Star size={22}/><span>Отзывы</span></button><button type="button" className="dealer-dock-request" onClick={()=>setLeadOpen(true)}><Icon name="message"/><span>Заявка</span></button></nav>
  {['photos','about','reviews'].includes(tab)&&<PublicSheet title={tab==='photos'?'Медиа':tab==='about'?'Адреса':'Отзывы'} onClose={()=>setTab('cars')} ownerDocument={top.current?.ownerDocument}><div className="dealer-profile dealer-drawer-content">   {tab==='reviews'&&<section className="dealer-reviews-panel"><header><div><p className="dealer-eyebrow">Рейтинг компании</p><h2>Отзывы о {s.name}</h2></div><div className="dealer-rating-summary"><RatingIcon/><strong>—</strong><span>Оценок пока нет</span></div></header><article className="dealer-welcome-review"><div className="dealer-welcome-heading"><span className="dealer-welcome-logo">{logo}</span><div><strong>{s.name}</strong><span>Сообщение компании</span></div>{verified&&<BadgeCheck size={22}/>}</div><h3>Здравствуйте!</h3><p>Спасибо, что выбираете нас! Нам важно ваше мнение. Расскажите о своём опыте — ваш отзыв поможет другим клиентам выбрать компанию, а нам — улучшить работу.</p></article><div className="dealer-review-eligibility"><div aria-hidden="true">{[1,2,3,4,5].map(n=><Star key={n}/>)}</div><p>Оценку и отзыв сможет оставить клиент, чья заявка подтверждена договором.</p></div></section>}
   {tab==='about'&&<section className="dealer-sheet dealer-contact-sheet">
    <button type="button" className="dealer-contact-details" onClick={openOffice}>Информация о компании <ArrowUpRight size={16}/></button>
    {s.offices.length>0?<><div className="dealer-office-select"><MapPin size={22}/><label>Адрес офиса<select aria-label="Адрес офиса в профиле" value={office?.id} onChange={e=>setOfficeId(e.target.value)}>{s.offices.map(o=><option key={o.id} value={o.id}>{o.city}, {o.address}</option>)}</select></label></div><DealerMap compact offices={s.offices} selectedId={office?.id} onSelect={setOfficeId}/>{office?.hours&&<div className="dealer-office-hours"><Icon name="clock"/><span><small>Режим работы</small>{office.hours}</span></div>}</>:<p className="dealer-about-text">Компания пока не добавила адреса офисов.</p>}
    {s.catalogMarkets.length>0&&<><h3 className="dealer-small-heading">Направления доставки</h3><div className="dealer-city-chips">{DEALER_MARKETS.filter(m=>s.catalogMarkets.includes(m.id)).map(m=><span key={m.id}><CatalogMarketFlag market={m.id}/> {m.label}</span>)}</div></>}<DealerRequisites value={s.requisites}/>{photos.length>0&&<div className="dealer-stories"><BuyerGallery title="" dealerName={s.name} images={photos.map(p=>p.url)} autoScroll={false}/></div>}</section>}
   {tab==='photos'&&<>{dealerBanners(s).length>0&&<section className="dealer-media-cover-section"><DealerBannerGallery s={s} media/></section>}{photos.length>0?<div className="dealer-photo-grid"><BuyerGallery title="" dealerName={s.name} images={photos.map(p=>p.url)} autoScroll={false}/></div>:<p className="dealer-about-text dealer-muted">Фотографии покупателей появятся здесь после публикации компанией.</p>}{s.offices.some(o=>o.photos.length>0)&&<BuyerGallery title="" dealerName={s.name} images={s.offices.flatMap(o=>o.photos.map(p=>p.url))} autoScroll={false}/>}</>}</div></PublicSheet>}
  {leadOpen&&<LeadDialog request={{mode:'generic',source:'dealer_profile_request',dealerId:s.dealerId}} favorites={[]} onClose={()=>setLeadOpen(false)} preview={!!editorSection||preview} portalDocument={top.current?.ownerDocument}/>}
  <dialog ref={dialog} className="dealer-info-dialog" onClick={e=>{if(e.target===dialog.current)dialog.current.close();}}>
   <div className="dealer-dialog-content"><div className="dealer-dialog-handle"/><header><div><p className="dealer-eyebrow">Информация о компании</p><h2>{s.name}</h2></div><button type="button" className="dealer-info-button" aria-label="Закрыть информацию" onClick={()=>dialog.current?.close()}><Icon name="close"/></button></header>
   <div className="dealer-avatar dealer-about-logo">{s.logoLight||s.logoDark?<><img src={s.logoLight||s.logoDark} alt={`Логотип ${s.name}`} className="dealer-logo-light"/><img src={s.logoDark||s.logoLight} alt="" className="dealer-logo-dark"/></>:<img className="dealer-default-logo" src="/logo/avtocena-mark-dark.svg" alt="АвтоЦена"/>}</div><p className="dealer-about-text">{s.description}</p>
   {s.offices.length>0?<><div className="dealer-office-select"><Icon name="pin"/><label>Адрес офиса<select aria-label="Адрес офиса" value={office?.id} onChange={e=>setOfficeId(e.target.value)}>{s.offices.map(o=><option key={o.id} value={o.id}>{o.city}, {o.address}</option>)}</select></label></div>{office?.hours&&<div className="dealer-office-hours"><Icon name="clock"/><span><small>Режим работы</small>{office.hours}</span></div>}<DealerMap compact offices={s.offices} selectedId={office?.id} onSelect={setOfficeId}/>{office&&<a className="dealer-primary dealer-route-button" href={yandexOfficeUrls(office).full} target="_blank" rel="noreferrer">Построить маршрут <ArrowUpRight size={18}/></a>}</>:<p className="dealer-about-text">Компания пока не добавила адреса офисов.</p>}
   <DealerRequisites value={s.requisites}/><p className="dealer-dialog-note">Для подбора автомобиля оставьте заявку через АвтоЦену.</p><button type="button" className="dealer-dialog-request" onClick={()=>{dialog.current?.close();setLeadOpen(true);}}>Оставить заявку <ArrowRight size={18}/></button></div>
  </dialog>
  <dialog ref={logoDialog} className="dealer-logo-dialog" aria-label={`Логотип ${s.name}`} onClick={e=>{if(e.target===logoDialog.current)logoDialog.current.close();}}>
   <button type="button" className="dealer-logo-close" aria-label="Закрыть логотип" onClick={()=>logoDialog.current?.close()}><Icon name="close"/></button>
   <div className="dealer-logo-preview">{logo}</div><h2>{s.name}</h2>{verified&&<p className="dealer-logo-verified"><BadgeCheck size={22}/>Проверенный дилер</p>}
  </dialog>
  <style>{dealerProfileStyles}</style>
 </div>;
}
