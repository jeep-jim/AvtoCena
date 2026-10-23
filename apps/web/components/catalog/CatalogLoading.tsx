/** Shared stripe treatment for a pending result section and streamed results. */
export function CatalogSectionLoading({active=false}:{active?:boolean}) {
 return <div className={`ac-catalog-section-loading ac-catalog-more ${active?'is-active':''}`} role="status" aria-live="polite">
  <span className="ac-catalog-more__candy" aria-hidden="true"/>
  <span className="ac-catalog-more__label">Обновляем автомобили</span>
 </div>;
}
