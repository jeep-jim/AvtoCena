"use client";
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
  platformOwner = false,
}: {
  initial: DealerShowcase;
  features: PublicFeatures;
  platformOwner?: boolean;
}) {
  const prepared=()=>{
    const value=structuredClone(initial);
    if(value.dealerId==='dealer_topavto'&&!value.pricing.tariffs.some(t=>t.city.toLowerCase()==='новосибирск'))value.pricing.tariffs.push({id:'novosibirsk',city:'Новосибирск',usd:900,daysFrom:5,daysTo:7});
    return value;
  };
  const [s, setS] = useState(prepared),
    [f, setF] = useState(features),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("profile");
  const [activeId,setActiveId]=useState(initial.offers[0]?.id||'');
  const [conflict,setConflict]=useState<{current:DealerShowcase;proposed:DealerShowcase}|null>(null);
  const [recovery,setRecovery]=useState<any>(null);
  const base=useRef(initial);
  const [loaded,setLoaded]=useState(false);
  const draftKey=`avtocena_dealer_draft_${initial.dealerId}`;
  useEffect(()=>{
    try{const draft=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(draft?.value?.dealerId===initial.dealerId)setRecovery(draft);}catch{}
    setLoaded(true);
  },[draftKey,initial.dealerId]);
  useEffect(()=>{if(!loaded||recovery)return;try{if(JSON.stringify(s)===JSON.stringify(base.current))sessionStorage.removeItem(draftKey);else sessionStorage.setItem(draftKey,JSON.stringify({value:s,base:base.current}));}catch{}},[s,draftKey,loaded,recovery]);
  const active=s.offers.find(o=>o.id===activeId)||s.offers[0];
  const quote=active?calculateSpecial(s,active):null;

  const patch = (v: Partial<DealerShowcase>) => setS((s) => ({ ...s, ...v }));
  const pricing = (v: Partial<DealerShowcase["pricing"]>) =>
    setS((s) => ({ ...s, pricing: { ...s.pricing, ...v } }));
  async function save(global = false, draft = false, resolved?: DealerShowcase) {
    if (
      !confirm(
        global
          ? "Изменить видимость ОСАГО и кредита на всём сайте?"
          : "Сохранить настройки дилера? Включённые разделы станут доступны посетителям.",
      )
    )
      return;
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
    <div className="dealer-editor space-y-4">
      <div className="dealer-editor-navigation flex flex-wrap gap-2">
        {[
          ["profile", "Профиль"],
          ["markets", "Рынки и каталог"],
          ["offices", "Адреса офисов"],
          ["buyers", "Фото покупателей"],
          ["offers", "Автомобили"],
          ["pricing", "Цена и доставка авто"],
          ["rates", "Расценки по рынкам"],
          ...(platformOwner ? [["services", "ОСАГО и кредит"]] : []),
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={`${button} ${tab === id ? "bg-red-600 text-white" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {recovery&&<div className="dealer-editor-panel"><p>Есть несохранённые изменения из прошлой сессии.</p><div className="mt-3 flex gap-2"><button className={button} onClick={()=>{base.current=recovery.base||initial;setS(recovery.value);setRecovery(null);}}>Восстановить изменения</button><button className={button} onClick={()=>setRecovery(null)}>Оставить сохранённую версию</button></div></div>}
      <aside className="dealer-editor-toolbar" aria-label="Сохранение настроек">
       <section className="dealer-editor-panel space-y-3">
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">Публикация</h2><span className="text-xs text-[var(--ac-muted)]">{s.profileEnabled?"Страница включена":"Страница скрыта"}</span></div>
        <button type="button" disabled={busy} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" onClick={()=>void save(tab==='services')}>{busy?'Сохраняем…':tab==='services'?'Сохранить видимость сервисов':'Сохранить настройки дилера'}</button>
        {tab==='offers'&&active&&<button type="button" disabled={busy} className={button} onClick={()=>void save(false,true)}>Сохранить черновик автомобиля</button>}
        <p role="status" className="text-sm leading-5">{message||(tab==='offers'?'Черновик можно сохранить с незаполненными полями. Для публикации заполните карточку, выберите статус «Опубликован» и включите показ предложений.':'Изменения появятся на странице после сохранения.')}</p>
        {conflict&&<div className="space-y-2 rounded-xl border border-amber-500/50 p-3 text-sm"><p>В другой вкладке изменены те же поля. Ваш ввод сохранён. Можно применить свои значения, сохранив остальные изменения.</p><button className={button} onClick={()=>{if(confirm('Применить ваши значения в спорных полях?')){base.current=conflict.current;void save(false,false,{...conflict.proposed,version:conflict.current.version});}}}>Применить мои изменения</button></div>}
        <Link className="block text-sm text-red-500 underline" target="_blank" href={`/dealers/${s.dealerId}?preview=1`}>Предпросмотр</Link>
       </section>
</aside>
      <div className="dealer-editor-layout">
      <fieldset disabled={busy} className="dealer-editor-main min-w-0 space-y-4">
        {tab === "profile" && (
          <>
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            <Field label="Телефон компании (только для АвтоЦены)" value={s.phone} onChange={phone=>patch({phone})}/><p className="text-sm text-[var(--ac-muted)]">Обращения поступают через АвтоЦену. Телефоны и мессенджеры компании в публичном профиле не показываются.</p>
          </>
        )}
        {tab === "markets" && <div className="space-y-5">
          <div><h2 className="text-xl font-black">Откуда вы доставляете автомобили</h2><p className="mt-2 text-sm text-[var(--ac-muted)]">Выберите направления вашей компании. На странице будут доступны только эти рынки общего каталога АвтоЦены.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">{DEALER_MARKETS.map(m=><label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[var(--ac-border)] p-4"><input type="checkbox" checked={dealerMarkets(s.catalogMarkets).includes(m.id)} onChange={e=>patch({catalogMarkets:e.target.checked?[...dealerMarkets(s.catalogMarkets),m.id]:dealerMarkets(s.catalogMarkets).filter(id=>id!==m.id)})}/><CatalogMarketFlag market={m.id} className="h-5 w-7 shrink-0"/><strong>{m.label}</strong></label>)}</div>
          <p className="text-sm text-[var(--ac-muted)]">{s.catalogMarkets?.length?`Выбрано направлений: ${s.catalogMarkets.length}`:'Направления не выбраны — общий каталог на странице компании не показывается.'}</p>
          <section className="dealer-editor-panel"><h3 className="font-bold">Собственные предложения</h3><p className="mt-2 text-sm text-[var(--ac-muted)]">Автомобили, которые вы добавите самостоятельно, появятся отдельно во вкладке «Предложения». Выбор рынков не делает автомобили АвтоЦены собственными предложениями компании.</p><button type="button" className={button+' mt-3'} onClick={()=>setTab('offers')}>Управлять предложениями</button></section>
        </div>}
        {tab === "rates" && <section className="space-y-6"><h2 className="text-xl font-black">Расценки услуг по рынкам</h2><p className="text-sm text-[var(--ac-muted)]">Отметьте только услуги вашей компании и укажите стоимость в рублях. Здесь сохраняется ваш прайс для работы с клиентом. Цены общего каталога пока рассчитываются по тарифам АвтоЦены.</p>{dealerMarkets(s.catalogMarkets).length===0?<p>Сначала выберите направления в разделе «Рынки и каталог».</p>:DEALER_MARKETS.filter(m=>dealerMarkets(s.catalogMarkets).includes(m.id)).map(m=><section key={m.id} className="space-y-3 border-t border-[var(--ac-border)] pt-5"><h3 className="flex items-center gap-2 font-bold"><CatalogMarketFlag market={m.id}/>{m.label}</h3><div className="grid gap-4 md:grid-cols-3">{DEALER_SERVICES.map(service=>{const value=s.servicePricing?.[m.id]?.[service.id]||{enabled:false,priceRub:0};const change=(v:Partial<typeof value>)=>patch({servicePricing:{...s.servicePricing,[m.id]:{...s.servicePricing?.[m.id],[service.id]:{...value,...v}}}});return <div key={service.id} className="space-y-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={e=>change({enabled:e.target.checked})}/>{service.label}</label>{value.enabled&&<Field label={`${service.label} · ${m.label}, ₽`} type="number" value={value.priceRub} onChange={priceRub=>change({priceRub})}/>}</div>;})}</div></section>)}</section>}
        {tab === "offices" && (
          <>
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
                  <Photos
                    dealerId={s.dealerId}
                    value={o.photos}
                    onChange={(photos) => change({ photos })}
                  />
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
          </>
        )}
        {tab === "buyers" && (
          <>
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
          </>
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
        <p className="text-sm text-[var(--ac-muted)]">{[active.year&&`${active.year} г.`,active.engineCc&&`${active.engineCc} см³`,active.powerHp&&`${active.powerHp} л.с.`,active.defaultCity].filter(Boolean).join(' · ')}</p>
        <p className="text-2xl font-black">{quote?.totalRub?`${quote.totalRub.toLocaleString('ru-RU')} ₽`:'Заполните данные для расчёта'}</p>
        {quote?.complete?quote.lines.map(line=><div key={line.id} className="flex justify-between gap-3 text-xs"><span>{line.title}</span><strong className="whitespace-nowrap">{line.amountRub.toLocaleString('ru-RU')} ₽</strong></div>):<ul className="list-inside list-disc space-y-1 text-xs text-[var(--ac-muted)]">{quote?.errors.map(error=><li key={error}>{error}</li>)}</ul>}
        <p className="text-xs text-[var(--ac-muted)]">Предпросмотр обновляется при вводе. На сайте изменения появятся после сохранения.</p>
       </section>}

      </div>
      <style>{`
       .dealer-editor-navigation{padding:0;gap:8px;background:transparent;border:0}
       .dealer-editor-layout{display:block}.dealer-editor-main{border:0;border-radius:0;background:transparent;padding:0;margin:0;min-width:0}
       .dealer-editor-panel{padding:16px 0;border:0;border-top:1px solid var(--ac-border);border-radius:0;background:transparent}
       .dealer-editor-toolbar{position:sticky;top:64px;z-index:20;background:var(--ac-bg);padding:10px 0;border-bottom:1px solid var(--ac-border)}
       .dealer-editor-toolbar>.dealer-editor-panel{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:0;border:0}.dealer-editor-toolbar>.dealer-editor-panel>*{margin:0}.dealer-editor-toolbar>.dealer-editor-panel>p{flex-basis:100%}
       .dealer-editor-main input,.dealer-editor-main select{min-height:40px}
       .dealer-editor-layout>[aria-label="Предпросмотр спецпредложения"]{max-width:480px;margin-top:24px}
       @media(max-width:600px){.dealer-editor-toolbar{position:static}.dealer-editor-toolbar>.dealer-editor-panel>div:first-child{width:100%}}
      `}</style>
    </div>
  );
}
