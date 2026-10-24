import './catalog-loading.css';
/** Streamed sections signal the single page loader without duplicating its UI. */
export function CatalogSectionLoading({active=false}:{active?:boolean}) {
 return <span hidden data-catalog-stream-pending={active?'true':'false'}/>;
}
