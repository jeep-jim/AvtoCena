export function PartnerShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-base font-black text-black">AC</div>
            <div>
              <div className="font-black">АвтоЦена Partners</div>
              <div className="text-xs font-bold text-white/45">реферальная система</div>
            </div>
          </a>
          <nav className="flex flex-wrap gap-2">
            <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70" href="/partner/landing">Лендос</a>
            <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70" href="/partner">Кабинет</a>
            <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70" href="/partner/api">CPA API</a>
          </nav>
        </header>
        <section className="mt-8">
          <div className="mb-6">
            <div className="text-sm font-black uppercase tracking-[0.18em] text-red-300">Партнёрам</div>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] md:text-5xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-white/56">{subtitle}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
