import { PublicHeader } from "@/components/layout/PublicHeader";

function SkeletonCard() {
  return <div className="overflow-hidden rounded-[1.35rem] bg-[var(--ac-surface-2)]" aria-hidden="true">
    <div className="h-24 animate-pulse bg-[var(--ac-surface-3)] sm:h-40 md:h-44" />
    <div className="space-y-3 p-2.5 sm:p-3.5">
      <div className="h-3 w-20 animate-pulse rounded-full bg-[var(--ac-surface-3)]" />
      <div className="h-6 w-32 animate-pulse rounded-lg bg-[var(--ac-surface-3)]" />
      <div className="flex gap-2">
        <div className="h-7 w-20 animate-pulse rounded-full bg-[var(--ac-surface-3)]" />
        <div className="h-7 w-24 animate-pulse rounded-full bg-[var(--ac-surface-3)]" />
      </div>
    </div>
  </div>;
}

export default function CarsLoading() {
  return <main className="ac-catalog-page ac-page-copy min-h-screen bg-[var(--ac-surface)] text-[var(--ac-text)]" aria-busy="true" aria-live="polite">
    <PublicHeader backHref="/" backLabel="На главную" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
      <div className="max-w-4xl">
        <div className="mb-4 h-3 w-48 animate-pulse rounded-full bg-[var(--ac-surface-3)] md:mb-5" aria-hidden="true" />
        <div className="h-9 w-64 animate-pulse rounded-xl bg-[var(--ac-surface-3)] sm:h-11 md:h-14 md:w-96" aria-hidden="true" />
        <p className="mt-3 text-sm font-bold text-[var(--ac-muted)]">Обновляем каталог…</p>
      </div>
      <div className="mt-6 flex gap-2 overflow-hidden" aria-hidden="true">
        <div className="h-11 w-32 shrink-0 animate-pulse rounded-xl bg-[var(--ac-surface-3)]" />
        <div className="h-11 w-36 shrink-0 animate-pulse rounded-xl bg-[var(--ac-surface-3)]" />
        <div className="h-11 w-40 shrink-0 animate-pulse rounded-xl bg-[var(--ac-surface-3)]" />
        <div className="h-11 w-28 shrink-0 animate-pulse rounded-xl bg-[var(--ac-surface-3)]" />
      </div>
      <div className="mt-8">
        <div className="mb-4 h-8 w-44 animate-pulse rounded-lg bg-[var(--ac-surface-3)]" aria-hidden="true" />
        <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <SkeletonCard key={index} />)}
        </div>
      </div>
    </section>
  </main>;
}
