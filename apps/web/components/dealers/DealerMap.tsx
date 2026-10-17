"use client";
import { useId, useState } from "react";
import {MapPin,ChevronUp} from 'lucide-react';
import type { DealerOffice } from "@/lib/dealers/showcase-model";
import { yandexOfficeUrls } from "@/lib/dealers/yandex-map";

export function DealerMap({ offices, selectedId, onSelect, compact=false }: { offices: Omit<DealerOffice, "phone">[]; compact?:boolean; selectedId?:string; onSelect?:(id:string)=>void }) {
  const [enabled, setEnabled] = useState(false);
  const mapId=useId();
  const [selected, setSelected] = useState('');
  const available = offices.filter(o => o.address.trim() || (o.lat !== null && o.lon !== null));
  const office = available.find(o => o.id === (selectedId || selected)) || available[0];
  if (!office) return null;
  const urls = yandexOfficeUrls(office);
  return (
    <section className={compact?"mt-3":"mt-6"} aria-label="Офисы на Яндекс Картах">
      {!compact&&<h2 className="mb-3 text-base font-bold">Офисы на карте</h2>}
      {!compact && available.length > 1 && (
        <label className="mb-3 grid gap-2 text-sm">
          Выберите офис
          <select className="soft-input w-full min-w-0 rounded-xl p-3" value={office.id} onChange={e => {setSelected(e.target.value);onSelect?.(e.target.value);}}>
            {available.map(o => <option key={o.id} value={o.id}>{o.city} — {o.address}</option>)}
          </select>
        </label>
      )}
      <button type="button" aria-expanded={enabled} aria-controls={mapId} className="dealer-map-toggle" onClick={() => setEnabled(value=>!value)}><MapPin size={20}/>{enabled?'Скрыть карту':'Показать на карте'}{enabled&&<ChevronUp size={16}/>}</button>
      <div id={mapId} hidden={!enabled}>
      {enabled && (
        <iframe key={urls.widget} src={urls.widget} title={`Яндекс Карты: ${office.city}, ${office.address}`} loading="lazy" allowFullScreen className="relative z-0 h-60 w-full rounded-2xl border-0" />
      )}
      {enabled&&<a className="mt-2 inline-block text-sm underline" href={urls.full} target="_blank" rel="noreferrer">Открыть в Яндекс Картах ↗</a>}
      </div>
      <style>{`.dealer-map-toggle{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:46px;padding:10px 16px;border:1px solid #b9c6bb;border-radius:14px;background:linear-gradient(#ffffff65,#ffffff65),url('/map-preview.svg') center/cover;color:#183c50;font-size:14px;font-weight:750}.dealer-map-toggle:focus-visible{outline:3px solid var(--ac-accent);outline-offset:3px}.dealer-map-toggle[aria-expanded=true]{margin-bottom:12px}`}</style>
    </section>
  );
}
