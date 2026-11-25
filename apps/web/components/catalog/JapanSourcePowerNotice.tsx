import {japanPowerSearchHint,japanPowerUnknown} from '@/lib/catalog/japan-source-power';

export function JapanSourcePowerNotice({offer}:{offer:any}){
 const hint=japanPowerSearchHint(offer);
 if(!hint&&!japanPowerUnknown(offer))return null;
 return <p role="status" data-japan-source-power={hint?.source||'unknown'} className="mb-3 rounded-xl border border-[var(--ac-border)] px-4 py-3 text-sm text-[var(--ac-muted)]">
  {hint?<>Мощность по данным поставщика: <strong>{hint.horsepower.toLocaleString('ru-RU')} л.с. · предварительно</strong>. Использовано первое указанное значение. Для расчёта подтвердите мощность по документам автомобиля.</>:<>Поставщик пока не указал мощность. Автомобиль сохранён в каталоге; перед расчётом уточните этот параметр.</>}
 </p>;
}
