import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { readDataJson } from "@/lib/data";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const pilotDealer = {
  id: "dealer_topavto",
  name: "TopAvto",
  city: "Новокузнецк",
  status: "verified",
  pilot: true,
  markets: ["Япония", "Китай", "Корея", "ОАЭ", "Европа", "Грузия"],
  telegramChannel: "",
  telegramConnected: false,
  logoUrl: "",
  headerImageUrl: "",
  reviewsEnabled: true,
  photoFeedEnabled: true,
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export default async function CrmDealerEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SearchParams> }) {
  const { id } = await params;
  const query: SearchParams = (await searchParams) || {};
  const stored = await readDataJson<any[]>("dealers/dealers.json", []);
  const dealers = stored.length ? stored : [pilotDealer];
  const dealer = dealers.find((item) => item.id === id);
  if (!dealer) notFound();
  const verified = dealer.status === "verified";
  const state = first(query.state);
  const message = first(query.message);

  return (
    <CrmShell activeHref="/crm/dealers" title={dealer.name} subtitle="Публичная карточка компании, Telegram-подключение, города, рынки и возможности проверенного профиля.">
      <div className="mb-4"><Link href="/crm/dealers" className="text-sm font-black text-red-300">← Назад к дилерам</Link></div>
      {state === "saved" ? <div className="mb-4 rounded-2xl bg-emerald-400/12 px-4 py-3 text-sm font-black text-emerald-300">Карточка компании сохранена.</div> : null}
      {state === "error" ? <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-black text-red-200">{message || "Не удалось сохранить карточку компании."}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form action="/api/crm/dealers" method="post" encType="multipart/form-data" className="glass grid gap-4 rounded-[1.8rem] p-5 md:grid-cols-2 md:p-6">
          <input type="hidden" name="dealerId" value={dealer.id} />
          <input type="hidden" name="logoUrl" value={dealer.logoUrl || ""} />
          <input type="hidden" name="telegramChatId" value={dealer.telegramChatId || ""} />

          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Название компании<input required name="name" defaultValue={dealer.name || ""} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Основной город<input required name="city" defaultValue={dealer.city || ""} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Статус<select name="status" defaultValue={dealer.status || "active"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal"><option value="active">Подключён</option><option value="verified">Проверен АвтоЦена</option><option value="paused">Приостановлен</option></select></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Telegram-канал<input name="telegramChannel" defaultValue={dealer.telegramChannel || ""} placeholder="@channel" className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42 md:col-span-2">Рынки<textarea name="markets" rows={3} defaultValue={Array.isArray(dealer.markets) ? dealer.markets.join(", ") : ""} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>

          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42 md:col-span-2">
            Шапка профиля {verified ? "" : "— только после верификации"}
            {dealer.headerImageUrl && verified ? <img src={dealer.headerImageUrl} alt="Текущая шапка" className="mb-1 aspect-[3/1] w-full rounded-2xl object-cover" /> : null}
            <input name="headerImage" type="file" accept="image/jpeg,image/png,image/webp" disabled={!verified} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal disabled:cursor-not-allowed disabled:opacity-50" />
            <span className="normal-case tracking-normal text-white/38">JPG, PNG или WebP до 8 МБ. Новая загрузка заменит текущую шапку.</span>
          </label>

          <div className="rounded-xl bg-white/[.045] px-4 py-3 text-sm font-bold text-white/68">
            <div className="font-black">Telegram: {dealer.telegramConnected ? "подключён" : "ожидает подключения"}</div>
            <div className="mt-1 text-xs leading-5 text-white/42">Подключение фиксируется автоматически после добавления бота администратором канала.</div>
          </div>
          <label className="flex items-center gap-3 rounded-xl bg-white/[.045] px-4 py-3 text-sm font-bold text-white/68"><input type="checkbox" name="reviewsEnabled" defaultChecked={verified && dealer.reviewsEnabled !== false} disabled={!verified} />Отзывы подтверждённых клиентов</label>
          <label className="flex items-center gap-3 rounded-xl bg-white/[.045] px-4 py-3 text-sm font-bold text-white/68 md:col-span-2"><input type="checkbox" name="photoFeedEnabled" defaultChecked={verified && dealer.photoFeedEnabled !== false} disabled={!verified} />Фото выдач и новости из Telegram в профиле</label>

          <button className="rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black text-white md:col-span-2">Сохранить карточку компании</button>
        </form>

        <aside className="space-y-4">
          <section className="glass rounded-[1.8rem] p-5">
            <div className="flex items-center gap-4">
              {dealer.logoUrl ? <img src={dealer.logoUrl} alt="" className="h-20 w-20 rounded-2xl object-cover" referrerPolicy="no-referrer" /> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-white text-xl font-black text-black">{String(dealer.name || "Д").slice(0, 2).toUpperCase()}</div>}
              <div><div className="text-xs font-black uppercase tracking-[.12em] text-red-300">Telegram-профиль</div><div className="mt-2 text-lg font-black">{dealer.telegramConnected ? "Подключён" : "Ожидает подключения"}</div></div>
            </div>
            <ol className="mt-4 grid gap-2 text-sm font-bold leading-6 text-white/48">
              <li>1. Укажите username канала и сохраните карточку.</li>
              <li>2. Добавьте бота АвтоЦена администратором без права публикации.</li>
              <li>3. Система автоматически получит аватар канала и подключит живую ленту.</li>
            </ol>
          </section>

          <section className="glass rounded-[1.8rem] p-5">
            <div className="text-xs font-black uppercase tracking-[.12em] text-red-300">Ограничения профиля</div>
            <h2 className="mt-2 text-2xl font-black">{verified ? "Профиль подтверждён" : "Нужна верификация"}</h2>
            <p className="mt-3 text-sm font-bold leading-6 text-white/48">Шапка, фотоотзывы, публичная Telegram-лента и участие в распределении заявок доступны только проверенным дилерам.</p>
          </section>
        </aside>
      </div>
    </CrmShell>
  );
}
