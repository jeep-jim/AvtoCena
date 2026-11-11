"use client";
/** Filter feedback stays local; changing parameters is not a page navigation. */
export function CatalogFilterPending({pending}:{pending:boolean}){
 return <span className="sr-only" role="status" data-catalog-filter-pending={pending?'true':'false'}>{pending?'Обновляем результаты':''}</span>;
}
