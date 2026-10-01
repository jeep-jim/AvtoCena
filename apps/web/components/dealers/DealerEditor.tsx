"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  calculateSpecial,
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
}: {
  initial: DealerShowcase;
  features: PublicFeatures;
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
      <div className="flex flex-wrap gap-2">
        {[
          ["profile", "Компания и офисы"],
          ["buyers", "Фото покупателей"],
          ["offers", "Спецпредложения"],
          ["services", "ОСАГО и кредит"],
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
              Предпросмотр страницы дилера ↗
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
            <div className="grid gap-4 md:grid-cols-3">
              {[
                ["logoLight", "Логотип для светлой темы"],
                ["logoDark", "Логотип для тёмной темы"],
                ["banner", "Баннер компании"],
              ].map(([key, label]) => (
                <section className="space-y-2" key={key}>
                  <h3>{label}</h3>
                  {key === "banner" && <>
                    <p className="text-xs text-[var(--ac-muted)]">1800 × 600 px · пропорции 3:1. Оставьте текст и логотип с отступом от краёв.</p>
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
            <div className="grid gap-3 md:grid-cols-3">
              <Field
                label="Телефон"
                value={s.phone}
                onChange={(v) => patch({ phone: v })}
              />
              <Field
                label="Telegram — https://t.me/…"
                value={s.telegram}
                onChange={(v) => patch({ telegram: v })}
              />
              <Field
                label="MAX — https://max.ru/…"
                value={s.max}
                onChange={(v) => patch({ max: v })}
              />
            </div>
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
                      label="Телефон офиса"
                      value={o.phone}
                      onChange={(v) => change({ phone: v })}
                    />
                    <Field
                      label="Время работы"
                      value={o.hours}
                      onChange={(v) => change({ hours: v })}
                    />
                    <Field
                      label="Широта"
                      type="number"
                      value={o.lat ?? ""}
                      onChange={(v) => change({ lat: v })}
                    />
                    <Field
                      label="Долгота"
                      type="number"
                      value={o.lon ?? ""}
                      onChange={(v) => change({ lon: v })}
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
        {tab === "offers" && <DealerSpecialsEditor s={s} patch={patch} pricing={pricing} updateOffer={updateOffer} activeId={active?.id||''} setActiveId={setActiveId}/>}
        {tab === "services" && (
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
      <aside className="dealer-editor-sidebar">
       <section className="dealer-editor-panel space-y-3">
        <h2 className="text-lg font-black">Сохранение</h2>
        <button type="button" disabled={busy} className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" onClick={()=>void save(tab==='services')}>{busy?'Сохраняем…':tab==='services'?'Сохранить видимость сервисов':'Сохранить настройки дилера'}</button>
        {tab==='offers'&&active&&<button type="button" disabled={busy} className={button+' w-full'} onClick={()=>void save(false,true)}>Сохранить черновик автомобиля</button>}
        <p role="status" className="text-sm leading-5">{message||(tab==='offers'?'Черновик можно сохранить с незаполненными полями. Для публикации выберите статус «Опубликован» и включите ленту.':'Изменения появятся на странице после сохранения.')}</p>
        {conflict&&<div className="space-y-2 rounded-xl border border-amber-500/50 p-3 text-sm"><p>В другой вкладке изменены те же поля. Ваш ввод сохранён. Можно применить свои значения, сохранив остальные изменения.</p><button className={button} onClick={()=>{if(confirm('Применить ваши значения в спорных полях?')){base.current=conflict.current;void save(false,false,{...conflict.proposed,version:conflict.current.version});}}}>Применить мои изменения</button></div>}
        <Link className="block text-sm text-red-500 underline" target="_blank" href={`/dealers/${s.dealerId}?preview=1`}>Открыть сохранённую страницу ↗</Link>
       </section>
       {tab==='offers'&&active&&<section className="dealer-editor-panel space-y-3" aria-label="Предпросмотр спецпредложения">
        <h2 className="font-bold">Так выглядит карточка</h2>
        {active.photos[0]?<img src={active.photos[0].url} alt={specialTitle(active)} className="aspect-[4/3] w-full rounded-xl object-cover"/>:<div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-sm text-[var(--ac-muted)]">Добавьте фото автомобиля</div>}
        <h3 className="text-xl font-black">{specialTitle(active)||'Название автомобиля'}</h3>
        <p className="text-sm text-[var(--ac-muted)]">{[active.year&&`${active.year} г.`,active.engineCc&&`${active.engineCc} см³`,active.powerHp&&`${active.powerHp} л.с.`,active.defaultCity].filter(Boolean).join(' · ')}</p>
        <p className="text-2xl font-black">{quote?.totalRub?`${quote.totalRub.toLocaleString('ru-RU')} ₽`:'Заполните данные для расчёта'}</p>
        {quote?.complete?quote.lines.map(line=><div key={line.id} className="flex justify-between gap-3 text-xs"><span>{line.title}</span><strong className="whitespace-nowrap">{line.amountRub.toLocaleString('ru-RU')} ₽</strong></div>):<ul className="list-inside list-disc space-y-1 text-xs text-[var(--ac-muted)]">{quote?.errors.map(error=><li key={error}>{error}</li>)}</ul>}
        <p className="text-xs text-[var(--ac-muted)]">Предпросмотр обновляется при вводе. На сайте изменения появятся после сохранения.</p>
       </section>}
       {tab==='profile'&&<section className="dealer-editor-panel space-y-3" aria-label="Предпросмотр компании">{s.banner&&<img src={s.banner} alt="Баннер" className="aspect-[3/1] w-full rounded-xl object-cover"/>}{(s.logoDark||s.logoLight)&&<img src={s.logoDark||s.logoLight} alt="Логотип" className="h-14 max-w-full object-contain"/>}<h2 className="text-xl font-black">{s.name}</h2><p className="whitespace-pre-line text-sm">{s.description}</p><p className="text-sm">{s.phone}</p><p className="break-all text-xs text-red-500">avtocena.com{dealerProfilePath(s)}</p></section>}
      </aside>
      </div>
      <style>{`
       .dealer-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:16px;align-items:start}
       .dealer-editor-main{border:0;padding:0;margin:0}
       .dealer-editor-sidebar{position:sticky;top:90px;display:grid;gap:16px;min-width:0}
       .dealer-editor-panel{padding:14px;border:1px solid var(--ac-border);border-radius:16px;background:var(--ac-surface)}
       .dealer-editor-main input,.dealer-editor-main select{min-height:40px}
       @media(max-width:1000px){.dealer-editor-layout{grid-template-columns:minmax(0,1fr)}.dealer-editor-sidebar{position:static;grid-row:1;grid-template-columns:repeat(2,minmax(0,1fr))}}
       @media(max-width:600px){.dealer-editor-sidebar{grid-template-columns:minmax(0,1fr)}.dealer-editor-panel{padding:14px}}
      `}</style>
    </div>
  );
}
