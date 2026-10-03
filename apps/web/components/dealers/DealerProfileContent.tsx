"use client";
import {DealerRequisites} from './DealerRequisites';
import {Sparkles,Car,MessageSquare,MapPin,BadgeCheck} from 'lucide-react';
import {useEffect,useRef,useState,useId} from 'react';
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
export function DealerProfileContent({s,preview=false,items=[],catalog,verified=false,editorSection}:{s:PublicDealerProfile;preview?:boolean;items?:SpecialRailItem[];catalog?:React.ReactNode;verified?:boolean;editorSection?:string}){
 const [tab,setTab]=useState<Tab>('cars'),[expanded,setExpanded]=useState(false),[favorite,setFavorite]=useState(false),[shareStatus,setShareStatus]=useState('');
 const [canExpand,setCanExpand]=useState(false);
 const intro=useRef<HTMLParagraphElement>(null),logoDialog=useRef<HTMLDialogElement>(null);
 const introId=useId();
 const dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLElement>(null),top=useRef<HTMLDivElement>(null);
 const [officeId,setOfficeId]=useState(s.offices[0]?.id||'');
 const office=s.offices.find(o=>o.id===officeId)||s.offices[0];
 const photos=s.buyersEnabled?s.buyerPhotos:[];
 const request=`/request?dealer=${encodeURIComponent(s.dealerId)}`;
 useEffect(()=>{if(editorSection)return;const navigate=()=>{if(['','#cars','#photos','#about','#specials','#reviews'].includes(location.hash)){setTab((location.hash.slice(1)||'cars') as Tab);if(location.hash)requestAnimationFrame(()=>body.current?.scrollIntoView({block:'start'}));}if(location.hash==='#offices')dialog.current?.showModal();};navigate();window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate);},[]);
 useEffect(()=>{if(editorSection)return;const openCatalog=()=>{setTab('cars');requestAnimationFrame(()=>body.current?.scrollIntoView({block:'start'}));};window.addEventListener('avtocena:dealer-section',openCatalog);return()=>window.removeEventListener('avtocena:dealer-section',openCatalog);},[]);
 useEffect(()=>{if(editorSection)return;try{setFavorite(localStorage.getItem(`ac-dealer-favorite-${s.dealerId}`)==='1');}catch{}},[s.dealerId]);
 function toggleFavorite(){const value=!favorite;setFavorite(value);if(editorSection)return;try{localStorage.setItem(`ac-dealer-favorite-${s.dealerId}`,value?'1':'0');}catch{}}
 function selectTab(value:Tab){if(!editorSection&&tab!==value)location.hash=value;setTab(value);}
 function scrollToElement(el:HTMLElement|null){if(!el)return;if(editorSection){const win=el.ownerDocument.defaultView;win?.scrollTo({top:el.getBoundingClientRect().top+win.scrollY,behavior:'smooth'});}else el.scrollIntoView({behavior:'smooth',block:'start'});}
 function section(value:Tab){selectTab(value);requestAnimationFrame(()=>scrollToElement(body.current));}
 function openOffice(){dialog.current?.showModal();}
 async function share(){if(editorSection){setShareStatus('Ссылка доступна на странице компании');return;}try{const url=new URL(location.href);url.search='';url.hash='';if(navigator.share)await navigator.share({title:s.name,url:url.toString()});else{await navigator.clipboard.writeText(`${s.name}\n${url}`);setShareStatus('Ссылка скопирована');}}catch(e){if((e as Error).name!=='AbortError')setShareStatus('Не удалось поделиться ссылкой');}}
 useEffect(()=>{
  const el=intro.current;if(!el)return;
  const measure=()=>{const line=parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).lineHeight);setCanExpand(el.scrollHeight>line*2+1);};
  measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
 },[s.description]);
 useEffect(()=>{
  if(!editorSection)return;
  setTab(editorSection==='buyers'?'photos':['offices','requisites','markets'].includes(editorSection)?'about':'cars');
  const frame=requestAnimationFrame(()=>{const target=editorSection==='requisites'?body.current?.querySelector('.dealer-requisites'):['buyers','offices','markets'].includes(editorSection)?body.current:top.current;const win=target?.ownerDocument.defaultView;if(target&&win)win.scrollTo({top:target.getBoundingClientRect().top+win.scrollY,behavior:'instant'});});
  return()=>cancelAnimationFrame(frame);
 },[editorSection]);
 const logo=<>{s.logoLight||s.logoDark?<><img src={s.logoLight||s.logoDark} alt={`Логотип ${s.name}`} className="dealer-logo-light"/><img src={s.logoDark||s.logoLight} alt={`Логотип ${s.name}`} className="dealer-logo-dark"/></>:<span>{s.name.slice(0,2)}</span>}</>;
 return <div ref={top} className="dealer-profile mx-auto w-full max-w-[1500px] px-4 pt-4 md:px-8" onClickCapture={editorSection?e=>{if((e.target as HTMLElement).closest('a'))e.preventDefault();}:undefined}>
  {preview&&<p className="dealer-preview-note">Предпросмотр · {s.profileEnabled?'Страница опубликована':'Страница пока скрыта от посетителей'}</p>}
  <div className="dealer-profile-hero">{s.banner||s.bannerMobile?<picture>{s.bannerMobile&&<source media="(max-width: 800px)" srcSet={s.bannerMobile}/>}<img src={s.banner||s.bannerMobile} alt={`Обложка ${s.name}`} className="dealer-cover" fetchPriority="high"/></picture>:<div className="dealer-cover dealer-cover-empty"/>}<div className="dealer-cover-actions"><button type="button" aria-label="Поделиться страницей компании" onClick={()=>void share()}><Icon name="share"/></button><button type="button" aria-label={favorite?'Убрать компанию из избранного':'Сохранить компанию'} aria-pressed={favorite} onClick={toggleFavorite}><Icon name="heart"/></button></div>{shareStatus&&<p className="dealer-share-status" role="status">{shareStatus}</p>}</div>
  <section className={`dealer-profile-identity dealer-sheet ${verified?'is-verified':''}`}>
   <div className="dealer-identity-row">
    <button type="button" className={`dealer-avatar dealer-avatar-centered ${verified?'is-verified':''}`} aria-label={`Открыть логотип ${s.name}${verified?' · Проверенный дилер':''}`} onClick={()=>logoDialog.current?.showModal()}><span className="dealer-avatar-face">{logo}</span></button>
    <div className="dealer-profile-metrics"><button type="button" onClick={()=>section('reviews')}><Sparkles size={18}/><strong>—</strong><span>Рейтинг</span></button><button type="button" onClick={()=>section('specials')}><Car size={18}/><strong>{items.length.toLocaleString('ru-RU')}</strong><span>Предложения</span></button></div>
    <p className="dealer-identity-divider"><span>Дилер</span></p>
    <div className="dealer-identity-title"><div className="dealer-title-line"><h1>{s.name}</h1></div></div>
   </div>
   {s.description&&<div className={`dealer-intro-wrap ${canExpand?'can-expand':''}`}><p ref={intro} id={introId} className={`dealer-intro ${expanded?'is-expanded':''}`}>{s.description}</p>{canExpand&&<button type="button" className="dealer-expand" aria-label={expanded?'Свернуть описание':'Развернуть описание'} aria-controls={introId} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?<ChevronUp size={18}/>:<ChevronDown size={18}/>}</button>}</div>}
  </section>
  <nav className="dealer-profile-tabs" aria-label="Разделы профиля">{([['reviews','Отзывы'],['cars','Каталог'],['about','Контакты']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={id==='cars'?(tab==='cars'||tab==='specials'):id==='about'?(tab==='about'||tab==='photos'):tab===id} onClick={()=>selectTab(id)}>{label}</button>)}</nav>
  <div className="dealer-profile-body"><section ref={body} className="dealer-tab-content" aria-label={tab==='cars'?'Каталог АвтоЦены':tab==='specials'?'Предложения дилера':tab==='photos'?'Фотографии компании':tab==='reviews'?'Отзывы о дилере':'Контакты компании'}>
   <div hidden={tab!=='cars'}>
    {photos.length>0&&<div className="dealer-stories"><BuyerGallery title="Наши покупатели" dealerName={s.name} images={photos.map(p=>p.url)} autoScroll={false}/></div>}
    <SpecialRail heading={s.specialHeading} items={items}/>{catalog}
   </div>
   {tab==='reviews'&&<section className="dealer-sheet dealer-reviews"><MessageSquare size={28}/><h2>Отзывы о {s.name}</h2><p className="dealer-muted">Отзывы пока не опубликованы.</p><p>Оценку и отзыв сможет оставить клиент, чья заявка подтверждена договором.</p></section>}
   {tab==='specials'&&<><div className="dealer-section-heading"><div><p className="dealer-eyebrow">От {s.name}</p><h2>Предложения компании</h2></div></div>{items.length?<>{(["order","stock"] as const).map(kind=>{const group=items.filter(o=>(o.availability||"order")===kind);return group.length?<section key={kind}><p className="dealer-muted">{group[0].heading|| (kind==="stock"?"Автомобили в наличии":s.specialHeading)}</p>{group[0].subtitle&&<p className="mt-1 break-words text-sm text-[var(--ac-muted)]">{group[0].subtitle}</p>}<div className="dealer-cars-grid">{group.map(o=><Link key={o.id} href={o.href} className="dealer-car"><img src={o.image} alt={o.title} loading="lazy"/><div><p className="dealer-muted">{o.availability==="stock"?`В наличии · ${o.condition==="used"?"С пробегом":"Новый"}`:"Под заказ"}</p><h3>{o.title}</h3><strong>{o.price===null?'Цена уточняется':`${o.price.toLocaleString('ru-RU')} ₽`}</strong><p>{[o.city,o.address].filter(Boolean).join(", ")}{o.daysFrom?` · ${o.daysFrom}–${o.daysTo} дней`:''}</p></div></Link>)}</div></section>:null;})}</>:<div className="dealer-empty"><Icon name="cars"/><h3>Подберём под ваши пожелания</h3><p>У компании пока нет отдельных предложений. Посмотрите автомобили по её направлениям доставки или оставьте заявку на подбор.</p><button type="button" className="dealer-primary" onClick={()=>selectTab('cars')}>Перейти к каталогу</button></div>}</>}
   {tab==='about'&&<section className="dealer-sheet dealer-contact-sheet">
    <button type="button" className="dealer-contact-details" onClick={openOffice}>Информация о компании <ArrowUpRight size={16}/></button>
    {s.offices.length>0?<><div className="dealer-office-select"><MapPin size={22}/><label>Адрес офиса<select aria-label="Адрес офиса в профиле" value={office?.id} onChange={e=>setOfficeId(e.target.value)}>{s.offices.map(o=><option key={o.id} value={o.id}>{o.city}, {o.address}</option>)}</select></label></div><DealerMap compact offices={s.offices} selectedId={office?.id} onSelect={setOfficeId}/>{office?.hours&&<div className="dealer-office-hours"><Icon name="clock"/><span><small>Режим работы</small>{office.hours}</span></div>}</>:<p className="dealer-about-text">Компания пока не добавила адреса офисов.</p>}
    {s.catalogMarkets.length>0&&<><h3 className="dealer-small-heading">Направления доставки</h3><div className="dealer-city-chips">{DEALER_MARKETS.filter(m=>s.catalogMarkets.includes(m.id)).map(m=><span key={m.id}><CatalogMarketFlag market={m.id}/> {m.label}</span>)}</div></>}<DealerRequisites value={s.requisites}/>{photos.length>0&&<div className="dealer-stories"><BuyerGallery title="Наши покупатели" dealerName={s.name} images={photos.map(p=>p.url)} autoScroll={false}/></div>}</section>}
   {tab==='photos'&&<><p className="dealer-eyebrow">Знакомство в фотографиях</p><h2>Жизнь компании</h2>{photos.length>0?<div className="dealer-photo-grid"><BuyerGallery title="Наши покупатели" dealerName={s.name} images={photos.map(p=>p.url)} autoScroll={false}/></div>:<p className="dealer-about-text dealer-muted">Фотографии покупателей появятся здесь после публикации компанией.</p>}{s.offices.some(o=>o.photos.length>0)&&<BuyerGallery title="Наши офисы" dealerName={s.name} images={s.offices.flatMap(o=>o.photos.map(p=>p.url))} autoScroll={false}/>}</>}
  </section></div>
  <footer className="dealer-profile-footer" hidden={tab==='about'}><DealerRequisites value={s.requisites}/></footer>
  <nav className="dealer-dock" aria-label="Быстрое меню дилера"><button type="button" onClick={()=>scrollToElement(top.current)}><Icon name="home"/><span>Главная</span></button><button type="button" aria-pressed={tab==='cars'||tab==='specials'} onClick={()=>section('cars')}><Icon name="cars"/><span>Авто</span></button><button type="button" aria-pressed={tab==='photos'} onClick={()=>section('photos')}><Icon name="photos"/><span>Фото</span></button><button type="button" onClick={openOffice}><Icon name="pin"/><span>Адреса</span></button><Link href={request} className="dealer-dock-request"><Icon name="message"/><span>Заявка</span></Link></nav>
  <dialog ref={dialog} className="dealer-info-dialog" onClick={e=>{if(e.target===dialog.current)dialog.current.close();}}>
   <div className="dealer-dialog-content"><div className="dealer-dialog-handle"/><header><div><p className="dealer-eyebrow">Информация о компании</p><h2>{s.name}</h2></div><button type="button" className="dealer-info-button" aria-label="Закрыть информацию" onClick={()=>dialog.current?.close()}><Icon name="close"/></button></header>
   <div className="dealer-avatar dealer-about-logo">{s.logoLight||s.logoDark?<><img src={s.logoLight||s.logoDark} alt={`Логотип ${s.name}`} className="dealer-logo-light"/><img src={s.logoDark||s.logoLight} alt="" className="dealer-logo-dark"/></>:<span>{s.name.slice(0,2)}</span>}</div><p className="dealer-about-text">{s.description}</p>
   {s.offices.length>0?<><div className="dealer-office-select"><Icon name="pin"/><label>Адрес офиса<select aria-label="Адрес офиса" value={office?.id} onChange={e=>setOfficeId(e.target.value)}>{s.offices.map(o=><option key={o.id} value={o.id}>{o.city}, {o.address}</option>)}</select></label></div>{office?.hours&&<div className="dealer-office-hours"><Icon name="clock"/><span><small>Режим работы</small>{office.hours}</span></div>}<DealerMap compact offices={s.offices} selectedId={office?.id} onSelect={setOfficeId}/>{office&&<a className="dealer-primary dealer-route-button" href={yandexOfficeUrls(office).full} target="_blank" rel="noreferrer">Построить маршрут <ArrowUpRight size={18}/></a>}</>:<p className="dealer-about-text">Компания пока не добавила адреса офисов.</p>}
   <DealerRequisites value={s.requisites}/><p className="dealer-dialog-note">Для подбора автомобиля оставьте заявку через АвтоЦену.</p><Link className="dealer-dialog-request" href={request}>Оставить заявку <ArrowRight size={18}/></Link></div>
  </dialog>
  <dialog ref={logoDialog} className="dealer-logo-dialog" aria-label={`Логотип ${s.name}`} onClick={e=>{if(e.target===logoDialog.current)logoDialog.current.close();}}>
   <button type="button" className="dealer-logo-close" aria-label="Закрыть логотип" onClick={()=>logoDialog.current?.close()}><Icon name="close"/></button>
   <div className="dealer-logo-preview">{logo}</div><h2>{s.name}</h2>{verified&&<p className="dealer-logo-verified"><BadgeCheck size={22}/>Проверенный дилер</p>}
  </dialog>
  <style>{dealerProfileStyles}</style>
 </div>;
}
