"use client";
import { useState } from "react";
import Link from "next/link";
import {
  calculateSpecial,
  type DealerShowcase,
  type DealerPhoto,
  type SpecialOffer,
  specialTitle,
  specialPath,
} from "@/lib/dealers/showcase-model";
import type { PublicFeatures } from "@/lib/dealers/showcase-store";
const input = "soft-input w-full min-w-0 rounded-xl p-3 text-sm";
const button =
  "rounded-xl border border-white/20 px-4 py-2 text-sm font-bold disabled:opacity-40";
function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: any) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input
        className={input}
        type={type}
        value={value}
        step={type === "number" ? "any" : undefined}
        onChange={(e) =>
          onChange(type === "number" ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-white/15 p-3">
      <input
        className="h-5 w-5 accent-red-500"
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
function Photos({
  dealerId,
  value,
  onChange,
  single = false,
}: {
  dealerId: string;
  value: DealerPhoto[];
  onChange: (p: DealerPhoto[]) => void;
  single?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState("");
  async function upload(files?: FileList | null) {
    setBusy(true);
    setError("");
    try {
      const added: DealerPhoto[] = [];
      for (const file of files ? Array.from(files) : [null]) {
        const data = new FormData();
        if (file) data.set("file", file);
        else data.set("url", url);
        const r = await fetch(`/api/crm/dealers/${dealerId}/media`, {
          method: "POST",
          body: data,
        });
        const result = await r.json();
        if (!r.ok) throw Error(result.error);
        added.push(result);
      }
      onChange(single ? added.slice(-1) : [...value, ...added]);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.map((p, i) => (
          <div key={`${p.id}-${i}`} className="w-28">
            <img
              className="h-20 w-28 rounded-xl object-cover"
              src={p.url}
              alt={p.caption || `Фото ${i + 1}`}
            />
            <div className="flex justify-between text-xs">
              <button
                type="button"
                disabled={busy || i === 0}
                onClick={() => {
                  const next = [...value];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange(next);
                }}
              >
                ←
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChange(value.filter((_, n) => n !== i))}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
      <input
        aria-label="Загрузить фотографии"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={!single}
        disabled={busy}
        onChange={(e) => void upload(e.target.files)}
        className="max-w-full text-sm"
      />
      <div className="flex gap-2">
        <input
          className={input}
          type="url"
          aria-label="Ссылка на изображение"
          placeholder="https://… — ссылка на фото"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !url}
          className={button}
          onClick={() => void upload()}
        >
          Загрузить
        </button>
      </div>
      <p className="text-xs text-white/60">
        {busy
          ? "Загружаем…"
          : "JPG, PNG, WebP до 8 МБ. Первое фото будет обложкой."}
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
function newOffer(): SpecialOffer {
  return {
    id: crypto.randomUUID(),
    status: "draft",
    make: "",
    model: "",
    trim: "",
    year: new Date().getFullYear(),
    productionMonth: 0,
    engineCc: 0,
    powerHp: 0,
    power30MinKw: 0,
    fuel: "petrol",
    transmission: "",
    drive: "",
    body: "",
    color: "",
    steering: "left",
    mileageKm: 0,
    description: "",
    equipment: "",
    photos: [],
    priceUsd: 0,
    customsIncluded: false,
    customsExtraRub: 0,
    personalUseEligible: false,
    defaultCity: "",
    updatedAt: "",
  };
}
export function DealerEditor({
  initial,
  features,
}: {
  initial: DealerShowcase;
  features: PublicFeatures;
}) {
  const [s, setS] = useState(initial),
    [f, setF] = useState(features),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("profile"),
    [mapPolicy, setMapPolicy] = useState(false);
  const patch = (v: Partial<DealerShowcase>) => setS((s) => ({ ...s, ...v }));
  const pricing = (v: Partial<DealerShowcase["pricing"]>) =>
    setS((s) => ({ ...s, pricing: { ...s.pricing, ...v } }));
  async function save(global = false) {
    if (
      !confirm(
        global
          ? "Изменить видимость ОСАГО и кредита на всём сайте?"
          : "Сохранить настройки дилера? Включённые разделы станут доступны посетителям.",
      )
    )
      return;
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
          body: JSON.stringify(global ? f : s),
        },
      );
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      if (global) setF(result);
      else setS(result);
      setMessage("Настройки сохранены");
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
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {[
          ["profile", "Компания и офисы"],
          ["buyers", "Фото покупателей"],
          ["pricing", "Цена и доставка"],
          ["offers", "Спецпредложения"],
          ["services", "ОСАГО и кредит"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={`${button} ${tab === id ? "bg-red-600" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        {tab === "profile" && (
          <>
            <Toggle
              label="Показывать публичную страницу дилера"
              value={s.profileEnabled}
              onChange={(v) => patch({ profileEnabled: v })}
            />
            <p className="text-sm text-white/60">
              Страница появится после сохранения. До включения её можете
              посмотреть только вы.
            </p>
            <Link
              className="text-red-300 underline"
              href={`/dealers/${s.dealerId}?preview=1`}
              target="_blank"
            >
              Предпросмотр страницы дилера ↗
            </Link>
            <Field
              label="Название компании"
              value={s.name}
              onChange={(v) => patch({ name: v })}
            />
            <label className="grid gap-2">
              О компании
              <textarea
                className={input}
                rows={5}
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
            <label className="text-sm">
              <input
                type="checkbox"
                checked={mapPolicy}
                onChange={(e) => setMapPolicy(e.target.checked)}
              />{" "}
              Подключить поиск адресов OpenStreetMap: не чаще одного запроса в
              секунду, без массового поиска.{" "}
              <a
                className="underline"
                target="_blank"
                rel="noreferrer"
                href="https://operations.osmfoundation.org/policies/nominatim/"
              >
                Условия сервиса
              </a>
              . Используем только публичные адреса офисов.
            </label>
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
                  className="space-y-3 rounded-2xl border border-white/15 p-4"
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
                  <button
                    type="button"
                    className={button}
                    onClick={async () => {
                      try {
                        const r = await fetch(
                          `/api/crm/dealers/${s.dealerId}/geocode`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              city: o.city,
                              address: o.address,
                              acceptPolicy: mapPolicy,
                            }),
                          },
                        );
                        const d = await r.json();
                        if (!r.ok) throw Error(d.error);
                        change({ lat: d.lat, lon: d.lon });
                        setMessage(
                          "Адрес найден. Проверьте точку на предпросмотре после сохранения.",
                        );
                      } catch (e) {
                        setMessage(
                          e instanceof Error
                            ? e.message
                            : "Не удалось найти адрес",
                        );
                      }
                    }}
                  >
                    Найти адрес на карте
                  </button>
                  <p className="text-xs text-white/60">
                    Поиск OpenStreetMap. Если адрес не найден, укажите
                    координаты вручную.
                  </p>
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
            <p className="text-sm text-white/60">
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
        {tab === "pricing" && (
          <>
            <h2 className="text-xl font-black">Расчёт спецпредложений</h2>
            <p className="text-sm text-white/60">
              Цена автомобиля и доставка в USD пересчитываются по одному курсу.
              Обычный каталог использует свои настройки.
            </p>
            <a
              href="https://www.profinance.ru/chart/usdrub/"
              target="_blank"
              rel="noreferrer"
              className="text-red-300 underline"
            >
              Открыть курс USD/RUB на ProFinance ↗
            </a>
            <p className="text-sm">
              Укажите проверенный курс и подтвердите дату. Курс старше 7 дней не
              используется для публичной цены.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["usdRub", "Курс USD/RUB"],
                ["fxMarkupRub", "Надбавка к курсу, ₽"],
                ["deliveryMarkupRub", "Надбавка к доставке, ₽"],
                ["commissionRub", "Комиссия, ₽"],
                ["documentsRub", "СБКТС + ЭПТС, ₽"],
              ].map(([key, label]) => (
                <Field
                  key={key}
                  type="number"
                  label={label}
                  value={(s.pricing as any)[key]}
                  onChange={(v) => pricing({ [key]: v })}
                />
              ))}
            </div>
            <button
              type="button"
              className={button}
              onClick={() => pricing({ rateAt: new Date().toISOString() })}
            >
              Подтверждаю курс на сегодня
            </button>
            <p className="text-xs">
              {s.pricing.rateAt
                ? `Подтверждён: ${new Date(s.pricing.rateAt).toLocaleString("ru-RU")}`
                : "Курс ещё не подтверждён"}
            </p>
            <h3 className="text-lg font-bold">Доставка по городам</h3>
            {s.pricing.tariffs.map((t, i) => (
              <div
                key={t.id}
                className="grid gap-3 rounded-xl border border-white/15 p-3 md:grid-cols-5"
              >
                {[
                  ["city", "Город", "text"],
                  ["usd", "Доставка, $", "number"],
                  ["daysFrom", "От, дней", "number"],
                  ["daysTo", "До, дней", "number"],
                ].map(([k, l, type]) => (
                  <Field
                    key={k}
                    label={l}
                    type={type}
                    value={(t as any)[k]}
                    onChange={(v) =>
                      pricing({
                        tariffs: s.pricing.tariffs.map((x, n) =>
                          n === i ? { ...x, [k]: v } : x,
                        ),
                      })
                    }
                  />
                ))}
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    pricing({
                      tariffs: s.pricing.tariffs.filter((_, n) => n !== i),
                    })
                  }
                >
                  Удалить
                </button>
              </div>
            ))}
            <button
              type="button"
              className={button}
              onClick={() =>
                pricing({
                  tariffs: [
                    ...s.pricing.tariffs,
                    {
                      id: crypto.randomUUID(),
                      city: "",
                      usd: 0,
                      daysFrom: 5,
                      daysTo: 10,
                    },
                  ],
                })
              }
            >
              + Добавить город доставки
            </button>
          </>
        )}
        {tab === "offers" && (
          <>
            <Toggle
              label="Показывать ленту спецпредложений"
              value={s.specialsEnabled}
              onChange={(v) => patch({ specialsEnabled: v })}
            />
            <Field
              label="Заголовок ленты"
              value={s.specialHeading}
              onChange={(v) => patch({ specialHeading: v })}
            />
            <p className="text-sm text-white/60">
              На главной лента TopAvto появится под фотографиями покупателей.
              Публикуются только готовые автомобили; черновики видит только
              владелец.
            </p>
            {s.offers.map((o) => {
              const quote = calculateSpecial(s, o);
              return (
                <details
                  key={o.id}
                  className="rounded-2xl border border-white/15 p-4"
                  open={undefined}
                >
                  <summary className="cursor-pointer font-bold">
                    {specialTitle(o) || "Новый автомобиль"} ·{" "}
                    {o.status === "published"
                      ? "Опубликован"
                      : o.status === "sold"
                        ? "Продан"
                        : "Черновик"}
                  </summary>
                  <div className="mt-4 space-y-4">
                    <label className="grid gap-2">
                      Статус
                      <select
                        className={input}
                        value={o.status}
                        onChange={(e) =>
                          updateOffer(o.id, {
                            status: e.target.value as SpecialOffer["status"],
                          })
                        }
                      >
                        <option value="draft">Черновик</option>
                        <option value="published">Опубликован</option>
                        <option value="sold">Продан</option>
                      </select>
                    </label>
                    <Photos
                      dealerId={s.dealerId}
                      value={o.photos}
                      onChange={(photos) => updateOffer(o.id, { photos })}
                    />
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        ["make", "Марка", "text"],
                        ["model", "Модель", "text"],
                        ["trim", "Комплектация", "text"],
                        ["year", "Год выпуска", "number"],
                        [
                          "productionMonth",
                          "Месяц производства (1–12)",
                          "number",
                        ],
                        ["engineCc", "Объём двигателя, см³", "number"],
                        [
                          "powerHp",
                          "Мощность ДВС / электромобиля, л.с.",
                          "number",
                        ],
                        [
                          "power30MinKw",
                          "30-минутная мощность электромоторов, кВт",
                          "number",
                        ],
                        ["transmission", "Коробка передач", "text"],
                        ["drive", "Привод", "text"],
                        ["body", "Кузов", "text"],
                        ["color", "Цвет", "text"],
                        ["mileageKm", "Пробег, км", "number"],
                        ["priceUsd", "Цена автомобиля, $", "number"],
                        [
                          "customsExtraRub",
                          "Таможенные платежи сверх цены, ₽",
                          "number",
                        ],
                      ].map(([k, label, type]) => (
                        <Field
                          key={k}
                          label={label}
                          type={type}
                          value={(o as any)[k]}
                          onChange={(v) => updateOffer(o.id, { [k]: v })}
                        />
                      ))}
                      <label className="grid gap-1 text-sm">
                        Двигатель
                        <select
                          className={input}
                          value={o.fuel}
                          onChange={(e) =>
                            updateOffer(o.id, {
                              fuel: e.target.value as SpecialOffer["fuel"],
                            })
                          }
                        >
                          {[
                            ["petrol", "Бензин"],
                            ["diesel", "Дизель"],
                            ["electric", "Электро"],
                            ["hybrid", "Параллельный гибрид"],
                            ["series_hybrid", "Последовательный гибрид"],
                          ].map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm">
                        Руль
                        <select
                          className={input}
                          value={o.steering}
                          onChange={(e) =>
                            updateOffer(o.id, {
                              steering: e.target
                                .value as SpecialOffer["steering"],
                            })
                          }
                        >
                          <option value="left">Левый</option>
                          <option value="right">Правый</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm">
                        Город цены на карточке
                        <select
                          className={input}
                          value={o.defaultCity}
                          onChange={(e) =>
                            updateOffer(o.id, { defaultCity: e.target.value })
                          }
                        >
                          <option value="">Выберите город</option>
                          {s.pricing.tariffs.map((t) => (
                            <option key={t.id}>{t.city}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <Toggle
                      label="Таможенные платежи включены в закупочную цену"
                      value={o.customsIncluded}
                      onChange={(v) =>
                        updateOffer(o.id, { customsIncluded: v })
                      }
                    />
                    <Toggle
                      label="Подтверждены условия льготного утильсбора для личного пользования"
                      value={o.personalUseEligible}
                      onChange={(v) =>
                        updateOffer(o.id, { personalUseEligible: v })
                      }
                    />
                    <p className="text-xs text-white/60">
                      Льгота применяется только при подходящих характеристиках.
                      Перед публикацией проверьте условия ввоза и состав
                      закупочной цены.
                    </p>
                    {[
                      ["description", "Описание"],
                      ["equipment", "Оснащение"],
                    ].map(([k, label]) => (
                      <label key={k} className="grid gap-2">
                        {label}
                        <textarea
                          className={input}
                          rows={4}
                          value={(o as any)[k]}
                          onChange={(e) =>
                            updateOffer(o.id, { [k]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    <div className="rounded-xl bg-white/5 p-4">
                      <strong>
                        {quote.complete
                          ? `${quote.totalRub!.toLocaleString("ru-RU")} ₽ — ${quote.city}`
                          : "Для публикации заполните расчёт"}
                      </strong>
                      {quote.complete ? (
                        quote.lines.map((l) => (
                          <p
                            key={l.id}
                            className="flex justify-between gap-3 text-sm"
                          >
                            <span>{l.title}</span>
                            <span>{l.amountRub.toLocaleString("ru-RU")} ₽</span>
                          </p>
                        ))
                      ) : (
                        <ul className="list-inside list-disc text-sm">
                          {quote.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Link
                        className={button}
                        target="_blank"
                        href={`${specialPath(s.dealerId, o.id)}?preview=1`}
                      >
                        Предпросмотр после сохранения ↗
                      </Link>
                      <button
                        type="button"
                        className={button}
                        onClick={() => {
                          if (confirm("Удалить автомобиль из витрины?"))
                            patch({
                              offers: s.offers.filter((x) => x.id !== o.id),
                            });
                        }}
                      >
                        Удалить автомобиль
                      </button>
                    </div>
                  </div>
                </details>
              );
            })}
            <button
              type="button"
              className={button}
              onClick={() => patch({ offers: [...s.offers, newOffer()] })}
            >
              + Добавить автомобиль
            </button>
          </>
        )}
        {tab === "services" && (
          <>
            <h2 className="text-xl font-black">Сервисы на всём сайте</h2>
            <Toggle
              label="Показывать ОСАГО и кредит"
              value={f.affiliatesEnabled}
              onChange={(v) => setF({ ...f, affiliatesEnabled: v })}
            />
            <p className="text-sm text-white/60">
              Один переключатель управляет кнопками и ссылками на главной, в
              карточках автомобилей и в подвале, включая мобильную версию.
            </p>
          </>
        )}
      </fieldset>
      <div className="sticky bottom-3 z-20 rounded-2xl border border-white/20 bg-slate-950 p-4 shadow-xl">
        <button
          type="button"
          disabled={busy}
          className="rounded-xl bg-red-600 px-6 py-3 font-black disabled:opacity-50"
          onClick={() => void save(tab === "services")}
        >
          {busy
            ? "Сохраняем…"
            : tab === "services"
              ? "Сохранить видимость сервисов"
              : "Сохранить настройки дилера"}
        </button>
        <p role="status" className="mt-2 text-sm">
          {message ||
            "Изменения применятся только после сохранения и подтверждения."}
        </p>
      </div>
    </div>
  );
}
