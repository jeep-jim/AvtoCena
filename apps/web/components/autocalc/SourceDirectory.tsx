'use client';
import {useState} from 'react';
import {AUTOCALC_MARKETS,VERIFIED_LINK_SOURCES} from '../../lib/autocalc/sources';
const flags:Record<string,string>={japan:'🇯🇵',china:'🇨🇳',korea:'🇰🇷',uae:'🇦🇪',europe:'🇪🇺',georgia:'🇬🇪'};
export function SourceDirectory(){
 const [market,setMarket]=useState('uae');const sources=VERIFIED_LINK_SOURCES.filter(s=>s.market===market);
 return <details className="rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4">
  <summary className="cursor-pointer text-sm font-bold">Проверенные источники по странам</summary>
  <label className="mt-4 block text-xs font-semibold">Где искать автомобиль<select aria-label="Страна источников" value={market} onChange={e=>setMarket(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 text-base text-[var(--ac-text)]">{Object.entries(AUTOCALC_MARKETS).map(([key,name])=><option key={key} value={key}>{flags[key]} {name}</option>)}</select></label>
  <div className="mt-3 space-y-2">{sources.map(s=><a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-between rounded-xl bg-[var(--ac-surface)] px-4 text-sm font-bold text-[var(--ac-text)]">{s.name}<span aria-hidden>↗</span></a>)}</div>
  <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">{sources.length?'Загрузку карточек проверили 27 сентября. Откройте сайт, выберите автомобиль и вставьте ссылку на его объявление.':'Пока нет подтверждённого прямого источника для этого рынка. Выберите автомобиль в нашем каталоге или заполните характеристики вручную.'}</p>
  <a href={`/cars?market=${market}`} className="mt-3 inline-block text-sm font-semibold text-[var(--ac-text)] underline underline-offset-4">Автомобили из {({japan:'Японии',china:'Китая',korea:'Кореи',uae:'ОАЭ',europe:'Европы',georgia:'Грузии'} as Record<string,string>)[market]} в АвтоЦене →</a>
  <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">Зарубежные сайты иногда отвечают медленно или временно ограничивают загрузку. Если данные недоступны, расчёт можно продолжить вручную.</p>
 </details>;
}
