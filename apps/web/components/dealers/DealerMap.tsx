"use client";
import { useState } from "react";
import type { DealerOffice } from "@/lib/dealers/showcase-model";
import { yandexOfficeUrls } from "@/lib/dealers/yandex-map";

export function DealerMap({ offices }: { offices: DealerOffice[] }) {
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState('');
  const available = offices.filter(o => o.address.trim() || (o.lat !== null && o.lon !== null));
  const office = available.find(o => o.id === selected) || available[0];
  if (!office) return null;
  const urls = yandexOfficeUrls(office);
  return (
    <section className="mt-6" aria-label="Офисы на Яндекс Картах">
      <h2 className="mb-3 text-2xl font-black">Офисы на карте</h2>
      {available.length > 1 && (
        <label className="mb-3 grid gap-2 text-sm">
          Выберите офис
          <select className="soft-input w-full min-w-0 rounded-xl p-3" value={office.id} onChange={e => setSelected(e.target.value)}>
            {available.map(o => <option key={o.id} value={o.id}>{o.city} — {o.address}</option>)}
          </select>
        </label>
      )}
      {enabled ? (
        <iframe key={urls.widget} src={urls.widget} title={`Яндекс Карты: ${office.city}, ${office.address}`} loading="lazy" allowFullScreen className="relative z-0 h-80 w-full rounded-2xl border-0" />
      ) : (
        <button type="button" className="w-full rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-10 font-bold" onClick={() => setEnabled(true)}>
          Показать Яндекс Карту
        </button>
      )}
      <a className="mt-2 inline-block text-sm text-red-500 underline" href={urls.full} target="_blank" rel="noreferrer">Открыть в Яндекс Картах ↗</a>
    </section>
  );
}
