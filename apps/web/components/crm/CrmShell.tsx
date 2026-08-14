import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { CrmThemeToggle } from "@/components/crm/CrmThemeToggle";
import { CrmLiveAlerts } from "@/components/crm/CrmLiveAlerts";
import { defaultManagerAvatar } from "@/lib/default-avatars";

type CrmShellProps = {
  title: string;
  subtitle: string;
  activeHref: string;
  children: React.ReactNode;
};

const roleLabels: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  partner: "Дилер",
};

export function CrmShell({ title, subtitle, activeHref, children }: CrmShellProps) {
  const user = getCurrentUser();
  const links = [
    ["/crm", "Обзор"],
    ["/crm/leads", "Заявки"],
    ["/crm/clients", "Клиенты"],
    ["/crm/managers", "Команда и права"],
    ["/crm/settings", "Рынки и расчёт"],
    ["/crm/dealers", "Дилеры"],
  ] as const;
  const avatar = user?.avatarUrl || defaultManagerAvatar(user?.id || user?.telegramUsername);

  return (
    <main className="crm-root min-h-screen px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-white text-base font-black text-black">AC</div>
            <div>
              <div className="font-black">АвтоЦена CRM</div>
              <div className="text-xs font-bold text-white/45">рабочее пространство команды</div>
            </div>
          </Link>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <CrmLiveAlerts />
            <CrmThemeToggle />
            <Link href={user?.id ? `/crm/managers/${encodeURIComponent(user.id)}` : "/crm/managers"} className="crm-user-chip flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/8 py-1.5 pl-1.5 pr-4 text-sm font-black text-white/70">
              <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
              <span>{user?.displayName || "Пользователь"} · {roleLabels[user?.role || ""] || user?.role || "гость"}</span>
            </Link>
            <form action="/api/auth/logout?redirect=/login" method="post">
              <button className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 hover:bg-white/15">Выйти</button>
            </form>
          </div>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Разделы CRM">
          {links.map(([href, label]) => {
            const active = href === activeHref;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition",
                  active
                    ? "order-first border-red-400/70 bg-red-500 text-white md:order-none"
                    : "border-white/10 bg-white/10 text-white/70 hover:border-white/20 hover:bg-white/15 hover:text-white",
                ].join(" ")}
              >
                {label}
              </Link>
            );
          })}
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
