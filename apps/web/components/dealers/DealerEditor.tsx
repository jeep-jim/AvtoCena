"use client";
import {DealerReviewsManager} from "./DealerReviewsManager";
import {DealerTelegramSettings} from './DealerTelegramSettings';
import {DealerLivePreview} from './DealerLivePreview';
import {EMPTY_REQUISITES} from '@/lib/dealers/requisites';
import {Send,LayoutDashboard,Car,Palette,MapPin,Images,Globe,Calculator,Wallet,ShieldCheck,BookOpen,ArrowUpRight,Eye,Check} from 'lucide-react';
import {DealerDemoContext,DealerUploadContext} from './DealerDemoContext';
import {DealerWorkspaceStyles} from './DealerWorkspaceStyles';
import {DEFAULT_PROGRAM,EMPTY_MEMBERSHIP,dealerAccessLevel,type DealerProgram,type Membership} from '@/lib/dealers/program-model';
import {CatalogMarketFlag} from "@/components/catalog/CatalogMarketFlag";
import {DEALER_SERVICES} from "@/lib/dealers/service-pricing";
import {DEALER_MARKETS,dealerMarkets} from "@/lib/dealers/catalog-markets";
import { useState, useEffect, useRef, useCallback } from "react";
import {mergeShowcaseChanges} from "@/lib/dealers/showcase-merge";
import Link from "next/link";
import {
  calculateSpecial,
  offerAvailability,offerAvailabilityLabel, type OfferAvailability,
  specialPublicationFields,
  type DealerShowcase,
  type DealerPhoto,
  type SpecialOffer,
  specialTitle,
  specialPath,
} from "@/lib/dealers/showcase-model";
import {Field, Toggle, Photos, input, button} from "./DealerEditorFields";
import {DealerSpecialsEditor} from "./DealerSpecialsEditor";
import {yandexOfficeUrls} from "@/lib/dealers/yandex-map";
import {dealerProfilePath} from "@/lib/dealers/profile-url";
import type { PublicFeatures } from "@/lib/dealers/showcase-store";
export function DealerEditor({
  initial,
  features,
  platformOwner = false, verified=false, demo=false, fullAccess=true, program=DEFAULT_PROGRAM, membership=EMPTY_MEMBERSHIP, administration, sidebarTop, onSaved, onDemoChange, onUploadingChange,
}: {
  initial: DealerShowcase;
  features: PublicFeatures;
  platformOwner?: boolean; verified?:boolean; demo?:boolean; fullAccess?:boolean; program?:DealerProgram; membership?:Membership; administration?:React.ReactNode; sidebarTop?:React.ReactNode; onSaved?:(s:DealerShowcase)=>void; onDemoChange?:(s:DealerShowcase)=>void; onUploadingChange?:(busy:boolean)=>void;
}) {
  const prepared=()=>{
    const value=structuredClone(initial);
    if(fullAccess&&value.dealerId==='dealer_topavto'){value.pricing.originCity??='Бишкек';value.pricing.distancePricing??=true;for(const [id,city,usd] of [['novosibirsk','Новосибирск',900],['moscow','Москва',1100]] as const)if(!value.pricing.tariffs.some(t=>t.city.toLowerCase()===city.toLowerCase()))value.pricing.tariffs.push({id,city,usd,daysFrom:5,daysTo:10});}
    return value;
  };
  const [s, setS] = useState(prepared),
    [f, setF] = useState(features),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("overview");
  useEffect(()=>{if(new URLSearchParams(window.location.search).get("tab")==="telegram")setTab("telegram");},[]);
  const [reviewCount,setReviewCount]=useState<number|null>(null);
  useEffect(()=>{if(demo)return;const controller=new AbortController();fetch(`/api/crm/reviews?dealerId=${encodeURIComponent(initial.dealerId)}`,{signal:controller.signal,cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(d)setReviewCount(d.total);}).catch(()=>{});return()=>controller.abort();},[initial.dealerId,demo]);
  const [offerMode,setOfferMode]=useState<OfferAvailability>('order');
  const [activeId,setActiveId]=useState(initial.offers[0]?.id||'');
  const [conflict,setConflict]=useState<{current:DealerShowcase;proposed:DealerShowcase}|null>(null);
  const base=useRef(s);
  const latest=useRef(s);
  latest.current=s;
  const saving=useRef(false);
  const failed=useRef("");
  const [pendingUploads,setPendingUploads]=useState(0);
  const uploadChange=useCallback((delta:number)=>setPendingUploads(n=>Math.max(0,n+delta)),[]);
  useEffect(()=>{if(demo)onDemoChange?.(s);},[demo,s,onDemoChange]);
  useEffect(()=>{onUploadingChange?.(pendingUploads>0);return()=>onUploadingChange?.(false);},[pendingUploads,onUploadingChange]);
  const dirty=JSON.stringify(s)!==JSON.stringify(base.current);
  const statusMessage=busy?'Сохраняем…':message|| (dirty?'Изменения сохранятся автоматически':'Все изменения сохранены');
  const previewDialog=useRef<HTMLDialogElement>(null);
  const openDemoPreview=(event:React.MouseEvent)=>{if(demo){event.preventDefault();previewDialog.current?.showModal();}};
  const [loaded,setLoaded]=useState(false);
  // Separate autosave drafts from legacy manual-save copies, which may be stale.
  const draftKey=`avtocena_dealer_autosave_${initial.dealerId}`;
  useEffect(()=>{
    if(!demo)try{
      const draft=JSON.parse(sessionStorage.getItem(draftKey)||'null');
      if(draft?.value?.dealerId===initial.dealerId&&draft?.base?.dealerId===initial.dealerId){
        const merged=mergeShowcaseChanges(draft.base,draft.value,initial);
        base.current=initial;
        setS(merged.value);
        if(merged.conflicts.length)setConflict({current:initial,proposed:merged.value});
      }
    }catch{}
    setLoaded(true);
  },[draftKey,initial.dealerId,demo]);
  useEffect(()=>{
    if(demo||!loaded)return;
    try{if(JSON.stringify(s)===JSON.stringify(base.current))sessionStorage.removeItem(draftKey);
    else sessionStorage.setItem(draftKey,JSON.stringify({value:s,base:base.current}));}catch{}
  },[s,draftKey,loaded,demo,busy]);
  useEffect(()=>{
    if(demo||!loaded||!dirty||busy||pendingUploads||conflict||failed.current===JSON.stringify(s))return;
    const timer=setTimeout(()=>void save(),900);
    return()=>clearTimeout(timer);
  },[s,loaded,demo,dirty,busy,pendingUploads,conflict]);
  useEffect(()=>{
    if(demo||!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[demo,dirty]);
  const modeOffers=s.offers.filter(o=>offerAvailability(o)===offerMode);
  const active=modeOffers.find(o=>o.id===activeId)||modeOffers[0];
  const quote=active?calculateSpecial(s,active):null;

  const patch = (v: Partial<DealerShowcase>) => setS((s) => ({ ...s, ...v }));
  const pricing = (v: Partial<DealerShowcase["pricing"]>) =>
    setS((s) => ({ ...s, pricing: { ...s.pricing, ...v } }));
  async function save(global = false, draft = false, resolved?: DealerShowcase) {
    if(pendingUploads||saving.current)return;
    if(demo){setMessage('Демо сохранено в этой вкладке. Данные компаний не изменены.');return;}
    const submitted=latest.current;
    let payload=resolved||submitted;
    if(draft&&active){const offers=s.offers.map(o=>o.id===active.id?{...o,status:'draft' as const}:o);payload={...s,offers,specialsEnabled:s.specialsEnabled&&offers.some(o=>o.status==='published')};}
    saving.current=true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        global
          ? "/api/crm/public-features"
          : `/api/crm/dealers/${s.dealerId}/showcase`,
        {
          method: "PUT",
          signal: AbortSignal.timeout(20000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(global ? f : {...payload,base:base.current}),
        },
      );
      const result = await r.json();
      if(r.status===409&&result.current){setConflict({current:result.current,proposed:result.proposed});throw Error(result.error);}
      if (!r.ok) throw Error(result.error);
      if (global) setF(result);
      else {
        // Keep edits made while this request was in flight and save them next.
        base.current=result;onSaved?.(result);
        // Apply the response after any queued field edits, including edits whose
        // render has not committed yet. The draft effect persists the result.
        setS(current=>mergeShowcaseChanges(submitted,current,result).value);
        setConflict(null);failed.current="";
      }
      setMessage(draft ? "Черновик сохранён. Автомобиль не опубликован." : "");
    } catch (e) {
      failed.current=JSON.stringify(submitted);
      setMessage(`Не удалось сохранить. ${e instanceof Error ? e.message : "Проверьте соединение и повторите попытку."}`);
    } finally {
      saving.current=false;
      setBusy(false);
    }
  }
  const updateOffer = (id: string, v: Partial<SpecialOffer>) => {
    if(v.status==='published'){
      const target=s.offers.find(o=>o.id===id);
      if(target){const missing=specialPublicationFields({...target,...v});if(missing.length){setMessage(`Для публикации ${specialTitle(target)||'этого автомобиля'} заполните: ${missing.join(', ')}. После заполнения выберите «Опубликован» ещё раз.`);return;}}
    }
    setS((s) => ({
      ...s,
      offers: s.offers.map((o) => (o.id === id ? { ...o, ...v } : o)),
    }));
  };
  const showLivePreview=['overview','profile','buyers','offices','requisites','markets'].includes(tab);
  const saveFeedback=<><p role="status" className="text-sm leading-5">{pendingUploads?'Загружаем фотографии…':demo?'Изменения демо запоминаются в этой вкладке.':statusMessage}</p>{conflict&&<div className="space-y-2 rounded-xl border border-amber-500/50 p-3 text-sm"><p>В другой вкладке изменены те же поля. Ваш ввод сохранён. Можно применить свои значения, сохранив остальные изменения.</p><button className={button} onClick={()=>{if(confirm('Применить ваши значения в спорных полях?')){const resolved=mergeShowcaseChanges(base.current,latest.current,conflict.current).value;base.current=conflict.current;void save(false,false,{...resolved,version:conflict.current.version});}}}>Применить мои изменения</button></div>}</>;
  return (
    <DealerUploadContext.Provider value={uploadChange}><DealerDemoContext.Provider value={demo}><div className="dealer-editor dealer-workspace">
      <DealerWorkspaceStyles/>
      {demo&&<dialog ref={previewDialog} aria-label="Предпросмотр демо-компании" className="dealer-preview-dialog" onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.currentTarget.close();}}}><div className="dealer-preview-toolbar flex justify-between gap-4 mb-5"><strong>Предпросмотр демо-компании</strong><button type="button" className={button} onClick={()=>previewDialog.current?.close()}>Закрыть</button></div>{s.banner&&<img src={s.banner} alt="Обложка компании"/>}<h2 className="dw-title mt-5">{s.name}</h2><p className="dw-muted">{s.description}</p><p className="dw-muted mt-3">{s.offices.map(o=>[o.city,o.address].filter(Boolean).join(', ')).join(' · ')}</p><h3 className="font-bold mt-6 mb-3">Направления каталога</h3><div className="flex flex-wrap gap-3">{dealerMarkets(s.catalogMarkets).map(m=><span key={m} className="dw-badge">{DEALER_MARKETS.find(x=>x.id===m)?.label||m}</span>)}</div>{fullAccess&&s.offers.length>0&&<><h3 className="font-bold mt-6 mb-3">Ваши автомобили</h3><div className="dealer-offer-list">{s.offers.map(o=><article key={o.id} className="dw-card">{o.photos[0]&&<img src={o.photos[0].url} alt={specialTitle(o)}/>}<h3 className="mt-3">{specialTitle(o)}</h3><p className="dw-muted">{calculateSpecial(s,o).complete?`${calculateSpecial(s,o).totalRub?.toLocaleString('ru-RU')} ₽`:'Заполните данные для расчёта'}</p></article>)}</div></>}<p className="dw-muted mt-6">Пример оформления. Эта компания не публикуется на сайте.</p></dialog>}
      <div className="dealer-editor-shell">
      <div className="dealer-editor-sidebar">{sidebarTop}<nav aria-label="Настройки дилера" className="dealer-editor-navigation flex flex-wrap gap-2">
        {[
          ["overview", "Обзор",LayoutDashboard],
          ["offers", "Автомобили",Car],
          ["profile", "Страница компании",Palette],
          ["buyers", "Фото выдач",Images],
          ["offices", "Адреса",MapPin],
          ["requisites", "Реквизиты",BookOpen],
          ["markets", "Каталог и рынки",Globe],
          ...(s.dealerId!=='dealer_topavto' ? [["rates", "Услуги компании",Wallet],["subscription",administration?"Подписка":"Доступ",ShieldCheck]] : []),
          ...(administration ? [["administration","Доступ",ShieldCheck]] : []),
          ["reviews", "Отзывы",BookOpen],
          ["telegram", "Telegram",Send],
        ].map(([id,label,Icon]:any)=><button type="button" key={id} disabled={pendingUploads>0} aria-selected={tab===id} className={button} onClick={()=>setTab(id)}><Icon size={19}/>{label}</button>)}
      </nav><div className="dealer-sidebar-save">{<button type="button" className={button+' dealer-saved-button'} disabled={busy||pendingUploads>0||!!conflict||(!dirty&&!demo)} onClick={()=>void save()} aria-live="polite">{!dirty&&!busy&&!pendingUploads&&<Check size={18}/>} {pendingUploads?'Загружаем фотографии…':busy?'Сохраняем…':message.startsWith('Не удалось сохранить')?'Повторить сохранение':demo?'Сохранено в демо':dirty?'Сохранить сейчас':'Сохранено'}</button>}{!demo&&s.dealerId!=='dealer_topavto'&&<Link href="/dealer-cabinet/documents" className={button+' mt-3 flex justify-center'}>Клиенты и документы</Link>}<div className="dealer-sidebar-feedback">{saveFeedback}</div></div></div>
      <div className="dealer-editor-content" data-live-preview={showLivePreview}><div className="dealer-editor-settings">

      {tab==='overview'&&<div className="space-y-5">
       <section className="dealer-editor-panel"><p className="dw-eyebrow">Ваша компания</p><h2 className="dw-title">{s.name}</h2><p className="dw-muted">Страница, автомобили и обращения — всё начинается здесь.</p><div className="mt-5 flex flex-wrap gap-3"><button type="button" className="dw-primary" onClick={()=>setTab('offers')}><Car size={18}/> Добавить автомобиль</button><Link onClick={openDemoPreview} className={button+' inline-flex items-center gap-2'} href={demo?'#':`/dealers/${s.dealerId}?preview=1`} target={demo?undefined:'_blank'}>Посмотреть страницу <ArrowUpRight size={16}/></Link></div></section>
       <div className="dw-grid dealer-overview-stats">{[['Автомобили',s.offers.filter(o=>o.status==='published').length,'offers'],['Фото выдач',s.buyerPhotos.length,'buyers'],['Направления',dealerMarkets(s.catalogMarkets).length,'markets'],['Отзывы',demo?0:reviewCount??'—','reviews']].map(([label,n,id])=><button key={String(id)} type="button" className="dw-card text-left" onClick={()=>setTab(String(id))}><span className="dw-muted">{label}</span><strong className="dw-stat">{n}</strong></button>)}</div>
       <section className="dealer-editor-panel"><h2 className="font-bold text-xl">Подготовьте компанию к работе</h2>{[['Название и описание',!!s.name&&!!s.description,'profile'],['Адрес офиса',s.offices.length>0,'offices'],['Направления каталога',dealerMarkets(s.catalogMarkets).length>0,'markets'],['Страница опубликована',s.profileEnabled,'profile']].map(([label,done,id])=><button type="button" className="dw-row w-full text-left" key={String(label)} onClick={()=>setTab(String(id))}><span>{label}</span><span className="dw-badge">{done?'Готово':'Настроить'}</span></button>)}</section>
       {s.dealerId==='dealer_topavto'&&<section className="dealer-editor-panel"><h2 className="font-bold">ТопАвто · компания платформы</h2><p className="dw-muted mt-2">Общие расценки шести рынков уже настроены в разделе «Рынки и расчёт». Здесь вы управляете своей страницей и отдельно добавленными автомобилями.</p></section>}
      </div>}
      {tab==='reviews'&&(demo?<section className="dealer-editor-panel">Отзывы появятся после работы с покупателями.</section>:<DealerReviewsManager dealerId={s.dealerId} onCount={setReviewCount}/>)}
      {tab==='telegram'&&<DealerTelegramSettings dealerId={s.dealerId} demo={demo}/>}
      {tab==='subscription'&&<section className="dealer-editor-panel"><h2 className="dw-title">Тариф и документы</h2><p className="dw-muted mt-3">Пробный месяц — без абонентской платы, комиссия 10% от согласованной базы сделки. Подписка: 10 000 ₽ / месяц, 50 000 ₽ / 6 месяцев, 100 000 ₽ / год; комиссия 10%. Без абонентской платы — комиссия 15%.</p><p className="mt-3">{fullAccess?'Доступ активен.':'Истёк тариф или ещё не подтверждено подключение. Ваши данные сохранены.'}</p><Link className="dw-primary mt-5 inline-flex" href="/dealer-cabinet/terms">Оферта и выбор режима</Link><Link className="dw-primary mt-3 inline-flex" href={platformOwner?"/crm/dealer-billing":"/dealer-cabinet/billing"}>Взаиморасчёты и оплата</Link></section>}
      {tab==='administration'&&administration}
      {!fullAccess&&['offers','buyers','pricing','rates'].includes(tab)?<section className="dealer-editor-panel"><h2 className="font-bold text-xl">Доступно с подпиской</h2><p className="dw-muted mt-3">Ваши данные сохранены. Продлите доступ, чтобы снова редактировать и показывать собственные автомобили и галерею.</p><button type="button" className={button+' mt-4'} onClick={()=>setTab('subscription')}>Посмотреть условия</button></section>:<div className="dealer-editor-layout" data-offer-editor={tab==='offers'}>
      <fieldset className="dealer-editor-main min-w-0 space-y-4">
        {tab === "profile" && (
          <section className="dealer-editor-panel space-y-5">
            <Toggle
              label="Показывать публичную страницу дилера"
              status={s.profileEnabled?"Активна":"Скрыта"}
              value={s.profileEnabled}
              onChange={(v) => patch({ profileEnabled: v })}
            />
            <p className="text-sm text-[var(--ac-muted)]">
              После включения страница станет доступна посетителям. Пока она скрыта, её можете
              посмотреть только вы.
            </p>
            <Link
              className={button+" inline-flex items-center gap-2"}
              onClick={openDemoPreview}
              href={`/dealers/${s.dealerId}?preview=1`}
              target="_blank"
            >
              <Eye size={17}/> Предпросмотр страницы дилера
            </Link>
            <div className="dealer-editor-panel space-y-3"><h2 className="font-bold">Ваша ссылка</h2><div className="grid grid-cols-2 gap-3"><Field label="Код города (nvkz, msk…)" value={s.citySlug||''} onChange={v=>patch({citySlug:v.toLowerCase()})}/><Field label="Никнейм дилера" value={s.slug||''} onChange={v=>patch({slug:v.toLowerCase()})}/></div><p className="break-all text-sm">https://avtocena.com{dealerProfilePath(s)}</p><p className="text-xs text-[var(--ac-muted)]">Латинские буквы, цифры и дефис. Изменения ссылки сохраняются автоматически.</p></div>
            <Field
              label="Название компании"
              value={s.name}
              onChange={(v) => patch({ name: v })}
            />
            <label className="grid gap-2">
              О компании
              <textarea
                aria-label="О компании"
                className={input}
                rows={3}
                value={s.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <div className="dealer-brand-fields">
              {[
                ["headerIcon", "Иконка в шапке"],
                ["logoLight", "Логотип для светлой темы"],
                ["logoDark", "Логотип для тёмной темы"],

              ].filter(()=>fullAccess).map(([key, label]) => (
                <section className={`dealer-brand-field dealer-brand-${key}`} key={key} aria-label={label}>
                  <h3>{label}</h3>
                  {key === "headerIcon" && <p className="text-xs text-[var(--ac-muted)]">Квадратное изображение от 128 × 128 px. Показывается рядом с названием компании при просмотре её каталога и автомобилей.</p>}
                  <Photos
                    dealerId={s.dealerId}
                    single
                    value={
                      (s as any)[key]
                        ? [{ id: key, url: (s as any)[key], caption: "" }]
                        : []
                    }
                    onChange={(p) => patch({ [key]: p[0]?.url || "" })}
                  />
                </section>
              ))}
            </div>
            <section className="dealer-banner-settings"><h2>Баннеры профиля</h2><p className="dw-muted">Один баннер доступен по умолчанию. С подпиской — до пяти: посетитель переключает их сам.</p>
             {[{id:'main',desktop:s.banner,mobile:s.bannerMobile||''},...(fullAccess?s.extraBanners||[]:[])].map((b,index)=><section key={b.id} className="dealer-banner-pair" aria-label={`Баннер ${index+1}`}><header><h3>Баннер {index+1}{index===0?' · основной':''}</h3>{index>0&&<button type="button" className={button} onClick={()=>{if(confirm('Удалить этот баннер?'))patch({extraBanners:s.extraBanners?.filter(x=>x.id!==b.id)});}}>Удалить</button>}</header><div className="dealer-brand-fields">
              {(['desktop','mobile'] as const).map(device=><section key={device} className="dealer-brand-field" aria-label={device==='desktop'?'Баннер для компьютера':'Баннер для телефона'}><h4>{device==='desktop'?'Для компьютера':'Для телефона'}</h4><p className="dw-muted">{device==='desktop'?'От 1600 × 400 px · рекомендуем 2400 × 600 (4:1), до 1 МБ.':'От 800 × 600 px · рекомендуем 1200 × 900 (4:3), до 500 КБ. Без отдельной версии используется баннер для компьютера.'} JPG, PNG, WebP — максимум 8 МБ. Важные детали размещайте по центру.</p><Photos dealerId={s.dealerId} purpose={index===0?"profile-banner":undefined} single value={b[device]?[{id:device,url:b[device],caption:''}]:[]} onChange={p=>index===0?patch({[device==='desktop'?'banner':'bannerMobile']:p[0]?.url||''}):patch({extraBanners:s.extraBanners?.map(x=>x.id===b.id?{...x,[device]:p[0]?.url||''}:x)})}/></section>)}
             </div></section>)}
             {fullAccess&&(s.extraBanners?.length||0)<4&&<button type="button" className={button} onClick={()=>patch({extraBanners:[...(s.extraBanners||[]),{id:crypto.randomUUID(),desktop:'',mobile:''}]})}>Добавить баннер</button>}
            </section>
            <Field label="Телефон компании (только для АвтоЦены)" value={s.phone} onChange={phone=>patch({phone})}/><p className="text-sm text-[var(--ac-muted)]">Обращения поступают через АвтоЦену. Телефоны и мессенджеры компании в публичном профиле не показываются.</p>
          </section>
        )}
        {tab === "requisites" && <section className="dealer-editor-panel space-y-5">
          <h2 className="text-xl font-black">Реквизиты компании</h2>
          <p className="text-sm text-[var(--ac-muted)]">Укажите исполнителя, с которым клиент заключает договор. Название, адрес и регистрационные номера будут показаны в вашем профиле.</p>
          <div className="grid gap-4 md:grid-cols-2">{([
            ['legalName','Полное наименование ИП или организации'],['legalAddress','Юридический адрес'],
            ['inn','ИНН'],['ogrn','ОГРН / ОГРНИП'],['kpp','КПП (для организации)'],
          ] as const).map(([key,label])=><Field key={key} label={label} value={s.requisites?.[key]||''} maxLength={key==='legalName'||key==='legalAddress'?500:30} onChange={value=>setS(current=>({...current,requisites:{...EMPTY_REQUISITES,...current.requisites,[key]:value}}))}/>)}</div>
          <h3 className="font-bold border-t border-[var(--ac-border)] pt-5">Банковские реквизиты</h3>
          <p className="text-sm text-[var(--ac-muted)]">Доступны вашей компании и АвтоЦене. На публичной странице не показываются.</p>
          <div className="grid gap-4 md:grid-cols-2">{([
            ['bank','Банк'],['bik','БИК'],['account','Расчётный счёт'],['correspondentAccount','Корреспондентский счёт'],
          ] as const).map(([key,label])=><Field key={key} label={label} value={s.requisites?.[key]||''} maxLength={key==='bank'?500:30} onChange={value=>setS(current=>({...current,requisites:{...EMPTY_REQUISITES,...current.requisites,[key]:value}}))}/>)}</div>
        </section>}
        {tab === "markets" && <div className="dealer-editor-panel space-y-5">
          <div><h2 className="text-xl font-black">Откуда вы доставляете автомобили</h2><p className="mt-2 text-sm text-[var(--ac-muted)]">Выберите направления вашей компании. На странице будут доступны только эти рынки общего каталога АвтоЦены.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">{DEALER_MARKETS.map(m=><label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[var(--ac-border)] p-4"><input type="checkbox" checked={dealerMarkets(s.catalogMarkets).includes(m.id)} onChange={e=>patch({catalogMarkets:e.target.checked?[...dealerMarkets(s.catalogMarkets),m.id]:dealerMarkets(s.catalogMarkets).filter(id=>id!==m.id)})}/><CatalogMarketFlag market={m.id} className="h-5 w-7 shrink-0"/><strong>{m.label}</strong></label>)}</div>
          <p className="text-sm text-[var(--ac-muted)]">{s.catalogMarkets?.length?`Выбрано направлений: ${s.catalogMarkets.length}`:'Направления не выбраны — общий каталог на странице компании не показывается.'}</p>
          <section className="dealer-editor-panel"><h3 className="font-bold">Собственные предложения</h3><p className="mt-2 text-sm text-[var(--ac-muted)]">Автомобили, которые вы добавите самостоятельно, появятся отдельно во вкладке «Предложения». Выбор рынков не делает автомобили АвтоЦены собственными предложениями компании.</p><button type="button" className={button+' mt-3'} onClick={()=>setTab('offers')}>Управлять предложениями</button></section>
        </div>}
        {tab === "rates" && <section className="dealer-editor-panel space-y-6"><h2 className="text-xl font-black">Расценки услуг по рынкам</h2><p className="text-sm text-[var(--ac-muted)]">Отметьте только услуги вашей компании и укажите стоимость в рублях. Здесь сохраняется ваш прайс для работы с клиентом. Цены общего каталога пока рассчитываются по тарифам АвтоЦены.</p>{dealerMarkets(s.catalogMarkets).length===0?<p>Сначала выберите направления в разделе «Рынки и каталог».</p>:DEALER_MARKETS.filter(m=>dealerMarkets(s.catalogMarkets).includes(m.id)).map(m=><section key={m.id} className="space-y-3 border-t border-[var(--ac-border)] pt-5"><h3 className="flex items-center gap-2 font-bold"><CatalogMarketFlag market={m.id}/>{m.label}</h3><div className="grid gap-4 md:grid-cols-3">{DEALER_SERVICES.map(service=>{const value=s.servicePricing?.[m.id]?.[service.id]||{enabled:false,priceRub:0};const change=(v:Partial<typeof value>)=>patch({servicePricing:{...s.servicePricing,[m.id]:{...s.servicePricing?.[m.id],[service.id]:{...value,...v}}}});return <div key={service.id} className="space-y-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={e=>change({enabled:e.target.checked})}/>{service.label}</label>{value.enabled&&<Field label={`${service.label} · ${m.label}, ₽`} type="number" value={value.priceRub} onChange={priceRub=>change({priceRub})}/>}</div>;})}</div></section>)}</section>}
        {tab === "offices" && (
          <section className="dealer-editor-panel space-y-4">
            <h2 className="text-xl font-black">Города и офисы</h2>
            <p className="text-sm text-[var(--ac-muted)]">Яндекс Карты покажут офис по городу и адресу. Для точной метки можно дополнительно указать координаты.</p>
            {s.offices.map((o, i) => {
              const change = (v: any) =>
                patch({
                  offices: s.offices.map((x, n) =>
                    n === i ? { ...x, ...v } : x,
                  ),
                });
              return (
                <section
                  key={o.id}
                  className="space-y-3 rounded-2xl border border-[var(--ac-border)] p-4"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field
                      label="Город"
                      value={o.city}
                      onChange={(v) =>
                        change({ city: v, lat: null, lon: null })
                      }
                    />
                    <Field
                      label="Адрес"
                      value={o.address}
                      onChange={(v) =>
                        change({ address: v, lat: null, lon: null })
                      }
                    />
                    <Field
                      label="Время работы"
                      value={o.hours}
                      onChange={(v) => change({ hours: v })}
                    />
                    <Field
                      label="Широта"
                      type="text"
                      value={o.lat ?? ""}
                      onChange={(v) => change({ lat: v === "" ? null : Number(v) })}
                    />
                    <Field
                      label="Долгота"
                      type="text"
                      value={o.lon ?? ""}
                      onChange={(v) => change({ lon: v === "" ? null : Number(v) })}
                    />
                  </div>
                  <a className={button + " inline-block"} href={yandexOfficeUrls(o).full} target="_blank" rel="noreferrer">Проверить адрес в Яндекс Картах ↗</a>
                  <p className="text-xs text-[var(--ac-muted)]">Проверьте адрес перед публикацией. Если поиск показывает несколько мест, уточните адрес или укажите координаты нужного входа.</p>
                  {fullAccess&&<Photos
                    dealerId={s.dealerId}
                    value={o.photos}
                    limit={20}
                    onChange={(photos) => change({ photos })}
                  />}
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      patch({ offices: s.offices.filter((_, n) => n !== i) })
                    }
                  >
                    Удалить офис
                  </button>
                </section>
              );
            })}
            <button
              type="button"
              className={button}
              onClick={() =>
                patch({
                  offices: [
                    ...s.offices,
                    {
                      id: crypto.randomUUID(),
                      city: "",
                      address: "",
                      phone: "",
                      hours: "",
                      lat: null,
                      lon: null,
                      photos: [],
                    },
                  ],
                })
              }
            >
              + Добавить офис
            </button>
          </section>
        )}
        {tab === "buyers" && (
          <section className="dealer-editor-panel space-y-4">
            <Toggle
              label="Показывать фотографии покупателей"
              value={s.buyersEnabled}
              onChange={(v) => patch({ buyersEnabled: v })}
            />
            <p className="text-sm text-[var(--ac-muted)]">
              Пустая галерея скрыта автоматически. Фотографии TopAvto
              отображаются на главной, фотографии остальных компаний — на их
              страницах.
            </p>
            <Photos
              dealerId={s.dealerId}
              value={s.buyerPhotos}
              limit={100}
              onChange={(buyerPhotos) => patch({ buyerPhotos })}
            />
          </section>
        )}
        {(tab === "offers" || tab === "pricing") && <DealerSpecialsEditor section={tab==='pricing'?'pricing':'offers'} s={s} patch={patch} pricing={pricing} updateOffer={updateOffer} activeId={active?.id||''} setActiveId={setActiveId} mode={offerMode} setMode={setOfferMode}/>}
        {platformOwner && tab === "services" && (
          <>
            <h2 className="text-xl font-black">Сервисы на всём сайте</h2>
            <Toggle
              label="Показывать ОСАГО и кредит"
              value={f.affiliatesEnabled}
              onChange={(v) => setF({ ...f, affiliatesEnabled: v })}
            />
            <p className="text-sm text-[var(--ac-muted)]">
              Один переключатель управляет кнопками и ссылками на главной, в
              карточках автомобилей и в подвале, включая мобильную версию.
            </p>
          </>
        )}
      </fieldset>
       {tab==='offers'&&<aside className="dealer-offer-aside" aria-label="Действия и предпросмотр автомобиля">
        <section className="dealer-editor-panel dealer-offer-actions">
         {active?<select aria-label="Статус автомобиля" className="dealer-offer-status" value={active.status} onChange={e=>updateOffer(active.id,{status:e.target.value as SpecialOffer['status']})}><option value="draft">Статус: Черновик</option><option value="published">Статус: Опубликован</option><option value="sold">Статус: Продан</option></select>:<span className="dealer-offer-status">Выберите автомобиль</span>}
         <button type="button" disabled={!active||(!demo&&(dirty||busy))} className={button+' dealer-preview-action'} onClick={event=>{if(demo)openDemoPreview(event);else if(active)window.open(`${specialPath(s.dealerId,active.id)}?preview=1`,'_blank','noopener,noreferrer');}}><Eye size={17}/>Предпросмотр</button>
         {active&&<><button type="button" disabled={pendingUploads>0||s.offers.length>=200} className={button} onClick={()=>{const next={...structuredClone(active),id:crypto.randomUUID(),status:'draft' as const,updatedAt:''};patch({offers:[...s.offers,next]});setActiveId(next.id);}}>+ Авто по этому шаблону</button>
         <button type="button" disabled={pendingUploads>0} className={button+' dealer-delete-action'} onClick={()=>{if(confirm(`Удалить ${specialTitle(active)||'этот автомобиль'}? Это действие нельзя отменить.`)){const offers=s.offers.filter(o=>o.id!==active.id);patch({offers});}}}>Удалить автомобиль</button></>}
        </section>
        {active&&<section className="dealer-editor-panel space-y-3" aria-label="Предпросмотр спецпредложения">
         <h2 className="font-bold">Так выглядит карточка</h2>
         {active.photos[0]?<img src={active.photos[0].url} alt={specialTitle(active)} className="aspect-[4/3] w-full rounded-xl object-cover"/>:<div className="dealer-offer-empty rounded-xl">Добавьте фото автомобиля</div>}
         <span className="dw-badge">{offerMode==='stock'?`В наличии · ${active.condition==='used'?'С пробегом':'Новый'}`:`${active.condition==='used'?'С пробегом':'Новый'}${quote?.daysFrom?` от ${quote.daysFrom} дней`:' · Под заказ'}`}</span>
         <h3 className="line-clamp-2 break-words text-xl font-black">{specialTitle(active)||'Название автомобиля'}</h3>
         <p className="text-sm text-[var(--ac-muted)]">{[active.year&&`${active.year} г.`,active.engineCc&&`${active.engineCc} см³`,active.powerHp&&`${active.powerHp} л.с.`,quote?.city].filter(Boolean).join(' · ')}</p>
         <p className="ac-price ac-price--down text-2xl font-black">{quote?.totalRub?`${quote.totalRub.toLocaleString('ru-RU')} ₽`:'Цена не заполнена'}</p>
         {offerMode==='stock'&&<p className="text-sm text-[var(--ac-muted)]">{s.offices.find(o=>o.id===active.officeId)?.address||'Выберите адрес автомобиля'}</p>}
         {quote?.complete?(offerMode==='order'&&quote.lines.map(line=><div key={line.id} className="flex justify-between gap-3 text-xs"><span>{line.title}</span><strong className="whitespace-nowrap">{line.amountRub.toLocaleString('ru-RU')} ₽</strong></div>)):<ul className="list-inside list-disc space-y-1 text-xs text-[var(--ac-muted)]">{quote?.errors.map(error=><li key={error}>{error}</li>)}</ul>}
         {specialPublicationFields(active).length>0&&<p className="text-xs text-[var(--ac-muted)]">Для публикации: {specialPublicationFields(active).join(', ')}.</p>}
        </section>}

       </aside>}

      </div>}
      </div>{showLivePreview&&<DealerLivePreview value={s} section={tab} verified={verified&&!demo} fullAccess={fullAccess}/>}</div></div>
    </div></DealerDemoContext.Provider></DealerUploadContext.Provider>
  );
}
