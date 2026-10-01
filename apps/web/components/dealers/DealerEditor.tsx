"use client";
import {LayoutDashboard,Car,Palette,MapPin,Images,Globe,Calculator,Wallet,ShieldCheck,BookOpen,ArrowUpRight} from 'lucide-react';
import {DealerDemoContext} from './DealerDemoContext';
import {DealerWorkspaceStyles} from './DealerWorkspaceStyles';
import {DEFAULT_PROGRAM,EMPTY_MEMBERSHIP,dealerAccessLevel,type DealerProgram,type Membership} from '@/lib/dealers/program-model';
import {CatalogMarketFlag} from "@/components/catalog/CatalogMarketFlag";
import {DEALER_SERVICES} from "@/lib/dealers/service-pricing";
import {DEALER_MARKETS,dealerMarkets} from "@/lib/dealers/catalog-markets";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  calculateSpecial,
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
  platformOwner = false, demo=false, fullAccess=true, program=DEFAULT_PROGRAM, membership=EMPTY_MEMBERSHIP, administration,
}: {
  initial: DealerShowcase;
  features: PublicFeatures;
  platformOwner?: boolean; demo?:boolean; fullAccess?:boolean; program?:DealerProgram; membership?:Membership; administration?:React.ReactNode;
}) {
  const prepared=()=>{
    const value=structuredClone(initial);
    if(fullAccess&&value.dealerId==='dealer_topavto'&&!value.pricing.tariffs.some(t=>t.city.toLowerCase()==='новосибирск'))value.pricing.tariffs.push({id:'novosibirsk',city:'Новосибирск',usd:900,daysFrom:5,daysTo:7});
    return value;
  };
  const [s, setS] = useState(prepared),
    [f, setF] = useState(features),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("overview");
  const [activeId,setActiveId]=useState(initial.offers[0]?.id||'');
  const [conflict,setConflict]=useState<{current:DealerShowcase;proposed:DealerShowcase}|null>(null);
  const [recovery,setRecovery]=useState<any>(null);
  const base=useRef(initial);
  const previewDialog=useRef<HTMLDialogElement>(null);
  const openDemoPreview=(event:React.MouseEvent)=>{if(demo){event.preventDefault();previewDialog.current?.showModal();}};
  const [loaded,setLoaded]=useState(false);
  const draftKey=`avtocena_dealer_draft_${initial.dealerId}`;
  useEffect(()=>{
    if(demo){setLoaded(true);return;}
    try{const draft=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(draft?.value?.dealerId===initial.dealerId)setRecovery(draft);}catch{}
    setLoaded(true);
  },[draftKey,initial.dealerId]);
  useEffect(()=>{if(demo||!loaded||recovery)return;try{if(JSON.stringify(s)===JSON.stringify(base.current))sessionStorage.removeItem(draftKey);else sessionStorage.setItem(draftKey,JSON.stringify({value:s,base:base.current}));}catch{}},[s,draftKey,loaded,recovery]);
  const active=s.offers.find(o=>o.id===activeId)||s.offers[0];
  const quote=active?calculateSpecial(s,active):null;

  const patch = (v: Partial<DealerShowcase>) => setS((s) => ({ ...s, ...v }));
  const pricing = (v: Partial<DealerShowcase["pricing"]>) =>
    setS((s) => ({ ...s, pricing: { ...s.pricing, ...v } }));
  async function save(global = false, draft = false, resolved?: DealerShowcase) {
    if(demo){setMessage('Демо сохранено в этой вкладке. Данные компаний не изменены.');return;}
    let payload=resolved||s;
    if(draft&&active){const offers=s.offers.map(o=>o.id===active.id?{...o,status:'draft' as const}:o);payload={...s,offers,specialsEnabled:s.specialsEnabled&&offers.some(o=>o.status==='published')};}
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        global
          ? "/api/crm/public-features"
          : `/api/crm/dealers/${s.dealerId}/showcase`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(global ? f : {...payload,base:base.current}),
        },
      );
      const result = await r.json();
      if(r.status===409&&result.current){setConflict({current:result.current,proposed:result.proposed});throw Error(result.error);}
      if (!r.ok) throw Error(result.error);
      if (global) setF(result);
      else {base.current=result;setS(result);setConflict(null);try{sessionStorage.removeItem(draftKey);}catch{}}
      setMessage(draft ? "Черновик сохранён. Автомобиль не опубликован." : "Настройки сохранены");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }
  const updateOffer = (id: string, v: Partial<SpecialOffer>) =>
    setS((s) => ({
      ...s,
      offers: s.offers.map((o) => (o.id === id ? { ...o, ...v } : o)),
    }));
  return (
    <DealerDemoContext.Provider value={demo}><div className="dealer-editor dealer-workspace">
      <DealerWorkspaceStyles/>
      {demo&&<dialog ref={previewDialog} className="dealer-preview-dialog"><div className="flex justify-between gap-4 mb-5"><strong>Предпросмотр демо-компании</strong><button type="button" className={button} onClick={()=>previewDialog.current?.close()}>Закрыть</button></div>{s.banner&&<img src={s.banner} alt="Обложка компании"/>}<h2 className="dw-title mt-5">{s.name}</h2><p className="dw-muted">{s.description}</p><p className="dw-muted mt-3">{s.offices.map(o=>[o.city,o.address].filter(Boolean).join(', ')).join(' · ')}</p><h3 className="font-bold mt-6 mb-3">Направления каталога</h3><div className="flex flex-wrap gap-3">{dealerMarkets(s.catalogMarkets).map(m=><span key={m} className="dw-badge">{DEALER_MARKETS.find(x=>x.id===m)?.label||m}</span>)}</div>{fullAccess&&s.offers.length>0&&<><h3 className="font-bold mt-6 mb-3">Ваши автомобили</h3><div className="dealer-offer-list">{s.offers.map(o=><article key={o.id} className="dw-card">{o.photos[0]&&<img src={o.photos[0].url} alt={specialTitle(o)}/>}<h3 className="mt-3">{specialTitle(o)}</h3><p className="dw-muted">{calculateSpecial(s,o).complete?`${calculateSpecial(s,o).totalRub?.toLocaleString('ru-RU')} ₽`:'Заполните данные для расчёта'}</p></article>)}</div></>}<p className="dw-muted mt-6">Пример оформления. Эта компания не публикуется на сайте.</p></dialog>}
      <div className="dealer-editor-shell">
      <div className="dealer-editor-navigation flex flex-wrap gap-2">
        {[
          ["overview", "Обзор",LayoutDashboard],
          ["offers", "Автомобили",Car],
          ["profile", "Страница компании",Palette],
          ["buyers", "Фото выдач",Images],
          ["offices", "Адреса",MapPin],
          ["markets", "Каталог и рынки",Globe],
          ["pricing", "Расчёт своих авто",Calculator],
          ...(s.dealerId!=='dealer_topavto' ? [["rates", "Услуги компании",Wallet],["subscription","Мой доступ",ShieldCheck]] : []),
          ...(administration ? [["administration","Управление доступом",ShieldCheck]] : []),
        ].map(([id,label,Icon]:any)=><button type="button" key={id} aria-selected={tab===id} className={button} onClick={()=>setTab(id)}><Icon size={19}/>{label}</button>)}
      </div>
      <div className="dealer-editor-content">
      {recovery&&<div className="dealer-editor-panel"><p>Есть несохранённые изменения из прошлой сессии.</p><div className="mt-3 flex gap-2"><button className={button} onClick={()=>{base.current=recovery.base||initial;setS(recovery.value);setRecovery(null);}}>Восстановить изменения</button><button className={button} onClick={()=>setRecovery(null)}>Оставить сохранённую версию</button></div></div>}
      {!["overview","subscription","administration"].includes(tab)&&<aside className="dealer-editor-toolbar" aria-label="Сохранение настроек">
       <section className="dealer-editor-panel space-y-3">
        <div className="dealer-save-status"><span className="dw-badge">{demo?"Демо":s.profileEnabled?"Страница включена":"Страница скрыта"}</span></div>
        <button type="button" disabled={busy||(!fullAccess&&["offers","pricing","rates","buyers"].includes(tab))} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" onClick={()=>void save(tab==='services')}>{busy?'Сохраняем…':'Сохранить изменения'}</button>
        {tab==='offers'&&active&&<button type="button" disabled={busy} className={button} onClick={()=>void save(false,true)}>Сохранить черновик автомобиля</button>}
        <p role="status" className="text-sm leading-5">{message||(tab==='offers'?'Черновик можно сохранить с незаполненными полями. Для публикации заполните карточку, выберите статус «Опубликован» и включите показ предложений.':'Изменения появятся на странице после сохранения.')}</p>
        {conflict&&<div className="space-y-2 rounded-xl border border-amber-500/50 p-3 text-sm"><p>В другой вкладке изменены те же поля. Ваш ввод сохранён. Можно применить свои значения, сохранив остальные изменения.</p><button className={button} onClick={()=>{if(confirm('Применить ваши значения в спорных полях?')){base.current=conflict.current;void save(false,false,{...conflict.proposed,version:conflict.current.version});}}}>Применить мои изменения</button></div>}
        <Link onClick={openDemoPreview} className="block text-sm text-red-500 underline" target={demo?undefined:"_blank"} href={`/dealers/${s.dealerId}?preview=1`}>Предпросмотр</Link>
       </section>
</aside>}
      {tab==='overview'&&<div className="space-y-5">
       <section className="dealer-editor-panel"><p className="dw-eyebrow">Ваша компания</p><h2 className="dw-title">{s.name}</h2><p className="dw-muted">Страница, автомобили и обращения — всё начинается здесь.</p><div className="mt-5 flex flex-wrap gap-3"><button type="button" className="dw-primary" onClick={()=>setTab('offers')}><Car size={18}/> Добавить автомобиль</button><Link onClick={openDemoPreview} className={button+' inline-flex items-center gap-2'} href={demo?'#':`/dealers/${s.dealerId}?preview=1`} target={demo?undefined:'_blank'}>Посмотреть страницу <ArrowUpRight size={16}/></Link></div></section>
       <div className="dw-grid dealer-overview-stats">{[['Автомобили',s.offers.filter(o=>o.status==='published').length,'offers'],['Фото выдач',s.buyerPhotos.length,'buyers'],['Направления',dealerMarkets(s.catalogMarkets).length,'markets']].map(([label,n,id])=><button key={String(id)} type="button" className="dw-card text-left" onClick={()=>setTab(String(id))}><span className="dw-muted">{label}</span><strong className="dw-stat">{n}</strong></button>)}</div>
       <section className="dealer-editor-panel"><h2 className="font-bold text-xl">Подготовьте компанию к работе</h2>{[['Название и описание',!!s.name&&!!s.description,'profile'],['Адрес офиса',s.offices.length>0,'offices'],['Направления каталога',dealerMarkets(s.catalogMarkets).length>0,'markets'],['Страница опубликована',s.profileEnabled,'profile']].map(([label,done,id])=><button type="button" className="dw-row w-full text-left" key={String(label)} onClick={()=>setTab(String(id))}><span>{label}</span><span className="dw-badge">{done?'Готово':'Настроить'}</span></button>)}</section>
       {s.dealerId==='dealer_topavto'&&<section className="dealer-editor-panel"><h2 className="font-bold">ТопАвто · компания платформы</h2><p className="dw-muted mt-2">Общие расценки шести рынков уже настроены в разделе «Рынки и расчёт». Здесь вы управляете своей страницей и отдельно добавленными автомобилями.</p></section>}
      </div>}
      {tab==='subscription'&&<section className="dealer-editor-panel"><p className="dw-eyebrow">Мой доступ</p><h2 className="dw-title">{fullAccess?'Все возможности':'Базовый доступ'}</h2><p className="dw-muted">{fullAccess?`Доступ до ${dealerAccessLevel(s.dealerId,membership).until?new Date(dealerAccessLevel(s.dealerId,membership).until).toLocaleDateString('ru-RU'):'окончания демо'}.`:'Общий каталог остаётся доступен. Собственные автомобили, фото выдач и расширенное оформление включаются с подпиской.'}</p><div className="dw-grid mt-5">{[[1,program.monthRub],[6,program.halfYearRub],[12,program.yearRub]].map(([m,price])=><div key={m} className="dw-card"><span className="dw-muted">{m===12?'Год':m===6?'6 месяцев':'Месяц'}</span><strong className="dw-stat">{price.toLocaleString('ru-RU')} ₽</strong></div>)}</div><p className="dw-muted mt-5">Комиссия по завершённым продажам из заявок АвтоЦены — {program.commissionPercent}% {program.commissionBasis==='sale'?'от стоимости проданного автомобиля':'от вознаграждения дилера'}. Подписка оплачивается отдельно. Для продления свяжитесь с командой АвтоЦены через вашу заявку на подключение.</p></section>}
      {tab==='administration'&&administration}
      {!fullAccess&&['offers','buyers','pricing','rates'].includes(tab)?<section className="dealer-editor-panel"><h2 className="font-bold text-xl">Доступно с подпиской</h2><p className="dw-muted mt-3">Ваши данные сохранены. Продлите доступ, чтобы снова редактировать и показывать собственные автомобили и галерею.</p><button type="button" className={button+' mt-4'} onClick={()=>setTab('subscription')}>Посмотреть условия</button></section>:<div className="dealer-editor-layout" data-offer-editor={tab==='offers'&&!!active}>
      <fieldset disabled={busy} className="dealer-editor-main min-w-0 space-y-4">
        {tab === "profile" && (
          <section className="dealer-editor-panel space-y-5">
            <Toggle
              label="Показывать публичную страницу дилера"
              value={s.profileEnabled}
              onChange={(v) => patch({ profileEnabled: v })}
            />
            <p className="text-sm text-[var(--ac-muted)]">
              Страница появится после сохранения. До включения её можете
              посмотреть только вы.
            </p>
            <Link
              className="text-red-500 underline"
              onClick={openDemoPreview}
              href={`/dealers/${s.dealerId}?preview=1`}
              target="_blank"
            >
              Предпросмотр страницы дилера
            </Link>
            <div className="dealer-editor-panel space-y-3"><h2 className="font-bold">Ваша ссылка</h2><div className="grid grid-cols-2 gap-3"><Field label="Код города (nvkz, msk…)" value={s.citySlug||''} onChange={v=>patch({citySlug:v.toLowerCase()})}/><Field label="Никнейм дилера" value={s.slug||''} onChange={v=>patch({slug:v.toLowerCase()})}/></div><p className="break-all text-sm">https://avtocena.com{dealerProfilePath(s)}</p><p className="text-xs text-[var(--ac-muted)]">Латинские буквы, цифры и дефис. Ссылка закрепится за вашей компанией после сохранения.</p></div>
            <Field
              label="Название компании"
              value={s.name}
              onChange={(v) => patch({ name: v })}
            />
            <label className="grid gap-2">
              О компании
              <textarea
                className={input}
                rows={3}
                value={s.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            {fullAccess&&<div className="grid gap-4 md:grid-cols-2">
              {[
                ["headerIcon", "Иконка в шапке"],
                ["logoLight", "Логотип для светлой темы"],
                ["logoDark", "Логотип для тёмной темы"],
                ["banner", "Баннер компании"],
              ].map(([key, label]) => (
                <section className="space-y-2" key={key}>
                  <h3>{label}</h3>
                  {key === "headerIcon" && <p className="text-xs text-[var(--ac-muted)]">Квадратное изображение от 128 × 128 px. Показывается рядом с названием компании при просмотре её каталога и автомобилей.</p>}
                  {key === "banner" && <>
                    <p className="text-xs text-[var(--ac-muted)]">1800 × 600 px · пропорции 3:1. Логотип загружается отдельно; края обложки могут обрезаться на телефоне.</p>
                    {s.dealerId === "dealer_topavto" && <button type="button" className={button} onClick={() => patch({ banner: "/dealers/topavto-banner-v3.webp" })}>Использовать новый баннер TopAvto</button>}
                  </>}
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
            }
            <Field label="Телефон компании (только для АвтоЦены)" value={s.phone} onChange={phone=>patch({phone})}/><p className="text-sm text-[var(--ac-muted)]">Обращения поступают через АвтоЦену. Телефоны и мессенджеры компании в публичном профиле не показываются.</p>
          </section>
        )}
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
              onChange={(buyerPhotos) => patch({ buyerPhotos })}
            />
          </section>
        )}
        {(tab === "offers" || tab === "pricing") && <DealerSpecialsEditor section={tab==='pricing'?'pricing':'offers'} s={s} patch={patch} pricing={pricing} updateOffer={updateOffer} activeId={active?.id||''} setActiveId={setActiveId}/>}
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
       {tab==='offers'&&active&&<section className="dealer-editor-panel space-y-3" aria-label="Предпросмотр спецпредложения">
        <h2 className="font-bold">Так выглядит карточка</h2>
        {specialPublicationFields(active).length>0&&<p className="text-sm text-[var(--ac-muted)]">Для публикации заполните: {specialPublicationFields(active).join(', ')}.</p>}
        {active.photos[0]?<img src={active.photos[0].url} alt={specialTitle(active)} className="aspect-[4/3] w-full rounded-xl object-cover"/>:<div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-sm text-[var(--ac-muted)]">Добавьте фото автомобиля</div>}
        <h3 className="text-xl font-black">{specialTitle(active)||'Название автомобиля'}</h3>
        <p className="text-sm text-[var(--ac-muted)]">{[active.year&&`${active.year} г.`,active.engineCc&&`${active.engineCc} см³`,active.powerHp&&`${active.powerHp} л.с.`,s.pricing.baseCity].filter(Boolean).join(' · ')}</p>
        <p className="text-2xl font-black">{quote?.totalRub?`${quote.totalRub.toLocaleString('ru-RU')} ₽`:'Заполните данные для расчёта'}</p>
        {quote?.complete?quote.lines.map(line=><div key={line.id} className="flex justify-between gap-3 text-xs"><span>{line.title}</span><strong className="whitespace-nowrap">{line.amountRub.toLocaleString('ru-RU')} ₽</strong></div>):<ul className="list-inside list-disc space-y-1 text-xs text-[var(--ac-muted)]">{quote?.errors.map(error=><li key={error}>{error}</li>)}</ul>}
        <p className="text-xs text-[var(--ac-muted)]">Предпросмотр обновляется при вводе. На сайте изменения появятся после сохранения.</p>
       </section>}

      </div>}
      </div></div>
    </div></DealerDemoContext.Provider>
  );
}
