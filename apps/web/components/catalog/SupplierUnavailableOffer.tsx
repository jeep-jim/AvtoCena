import Link from 'next/link';
/** Supplier refusal is local to this offer; keep the site shell and navigation. */
export function SupplierUnavailableOffer({disabled=false}:{disabled?:boolean}){
 return <main className="ac-page-copy mx-auto min-h-[55vh] max-w-3xl px-4 py-16" data-supplier-unavailable>
  <h1 className="text-3xl font-black">{disabled?'Карточка больше недоступна':'Не удалось загрузить автомобиль'}</h1>
  <p role="status" className="mt-4 leading-7 text-[var(--ac-muted)]">{disabled?'Выберите автомобиль в актуальном каталоге.':'Сейчас не удалось загрузить данные автомобиля. Попробуйте открыть карточку позже. Остальной каталог доступен.'}</p>
  <Link href="/cars" className="avto-button mt-6 inline-flex rounded-xl px-5 py-3 font-bold">Вернуться в каталог</Link>
 </main>;
}
