"use client";
/** The global loader observes this state; filters never mount a second loader. */
export function CatalogFilterPending({pending}:{pending:boolean}){
 return <span hidden data-catalog-pending={pending?'true':'false'}/>;
}
