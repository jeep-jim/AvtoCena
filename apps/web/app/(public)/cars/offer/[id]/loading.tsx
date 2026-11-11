import { PublicHeader } from "@/components/layout/PublicHeader";

export default function OfferLoading() {
  return <main className="ac-offer-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white" aria-busy="true" aria-label="Загружаем карточку автомобиля">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="h-4 w-44 animate-pulse rounded-full bg-white/[0.07]" />
      <div className="mt-3 h-10 w-[min(82vw,720px)] animate-pulse rounded-2xl bg-white/[0.09] md:h-14" />
      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(390px,.75fr)] xl:items-start 2xl:grid-cols-[minmax(0,1.6fr)_480px]">
        <div className="aspect-[16/10] min-h-[300px] animate-pulse rounded-[1.6rem] bg-white/[0.055] md:min-h-[520px]" />
        <div className="space-y-4">
          <div className="min-h-36 animate-pulse rounded-[1.35rem] bg-white/[0.065]" />
          <div className="grid grid-cols-2 gap-2.5">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-white/[0.045]" />)}</div>
          <div className="h-28 animate-pulse rounded-[1.35rem] bg-white/[0.045]" />
        </div>
      </div>
    </section>
  </main>;
}
