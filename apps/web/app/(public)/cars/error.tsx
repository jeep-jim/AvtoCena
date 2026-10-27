'use client';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CatalogUnavailable} from '@/components/catalog/CatalogUnavailable';
/** Keep the public navigation usable when an unexpected catalog render fails. */
export default function CarsError({reset}:{error:Error&{digest?:string};reset:()=>void}) {
 return <main className="ac-catalog-page min-h-screen text-[var(--ac-text)]">
  <PublicHeader backHref="/" backLabel="На главную"/>
  <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8">
   <CatalogUnavailable reset={reset}/>
  </div>
 </main>;
}
