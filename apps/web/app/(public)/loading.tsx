import { PublicHeader } from "@/components/layout/PublicHeader";

export default function PublicLoading() {
  return <main className="ac-page-copy min-h-screen bg-[#0f172a] text-white" aria-busy="true" aria-label="Загружаем страницу">
    <PublicHeader />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="h-10 w-[min(72vw,560px)] animate-pulse rounded-2xl bg-white/[0.09] md:h-14" />
      <div className="mt-4 h-5 w-[min(54vw,360px)] animate-pulse rounded-full bg-white/[0.055]" />
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,.75fr)]">
        <div className="min-h-[320px] animate-pulse rounded-[1.7rem] bg-white/[0.055] md:min-h-[500px]" />
        <div className="grid content-start gap-3">
          <div className="h-24 animate-pulse rounded-[1.35rem] bg-white/[0.065]" />
          <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-white/[0.045]" />)}</div>
          <div className="h-28 animate-pulse rounded-[1.35rem] bg-white/[0.045]" />
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-[1.35rem] bg-white/[0.045]" />)}</div>
    </section>
  </main>;
}
