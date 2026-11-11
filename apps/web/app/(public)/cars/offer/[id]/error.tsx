"use client";
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CatalogUnavailable} from '@/components/catalog/CatalogUnavailable';
export default function OfferError({reset}:{reset:()=>void}) {
 return <main className="ac-catalog-page min-h-screen text-[var(--ac-text)]">
  <PublicHeader backHref="/cars" backLabel="К каталогу"/>
  <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8"><CatalogUnavailable reset={reset} message="Не удалось открыть данные автомобиля. Мы поможем проверить его наличие."/></div>
 </main>;
}
