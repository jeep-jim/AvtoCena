import './catalog-loading.css';
/** Each streamed section owns its feedback; it never covers the header. */
export function CatalogSectionLoading({active=false}:{active?:boolean}) {
 return active?<p role="status" data-catalog-stream-pending="true" className="py-4 text-sm text-[var(--ac-muted)]">Загружаем автомобили…</p>:null;
}
