import { getCurrentUser } from "@/lib/auth";
import { BrandMark } from "@/components/brand/BrandMark";

export function CrmShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const user = getCurrentUser();
  const links = [
    ["/crm", "Обзор"],
    ["/crm/feed", "Лента"],
    ["/crm/leads", "Лиды"],
    ["/crm/clients", "Клиенты"],
    ["/crm/deals", "Сделки"],
    ["/crm/managers", "Менеджеры"],
    ["/crm/partners", "Партнёры"],
    ["/crm/settings", "Настройки"]
  ];

  return (
    <main className="min-h-screen px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10 shrink-0" />
            <div>
              <div className="font-black">TopAvto CRM</div>
              <div className="text-xs font-bold text-white/45">внутренняя система</div>
            </div>
          </a>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-black text-white/70">
              {user?.displayName || "Менеджер"} · {user?.role || "guest"}
            </div>
            <form action="/api/auth/logout?redirect=/login" method="post">
              <button className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 hover:bg-white/15">Выйти</button>
            </form>
          </div>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map(([href, label]) => (
            <a key={href} href={href} className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 hover:bg-white/15">
              {label}
            </a>
          ))}
        </nav>

        <section className="mt-7">
          <div className="mb-6">
            <div className="text-sm font-black uppercase tracking-[0.18em] text-red-300">CRM</div>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] md:text-5xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-white/56">{subtitle}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
