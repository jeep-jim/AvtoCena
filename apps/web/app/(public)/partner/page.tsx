import type { Metadata } from "next";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { money } from "@/lib/avtocena";
import { readChunkedDataJson, readDataJson } from "@/lib/data";
import { getCurrentUser, isAdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Кабинет партнёра — АвтоЦена",
  robots: { index: false, follow: false }
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PartnerPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const user = getCurrentUser();
  const partners = readDataJson<any[]>("partners/partners.json", []);
  const leads = readChunkedDataJson<any>("leads/leads.json", []);
  const requestedRef = firstParam(params.ref);
  const code = isAdminRole(user?.role) ? requestedRef || user?.partnerCode || "demo" : user?.partnerCode || "demo";
  const partner = partners.find((item) => item.code === code) || partners[0] || { name: "Партнёр", code, clicks: 0, calculations: 0, leads: 0, contracts: 0, balanceRub: 0 };
  const partnerLeads = leads.filter((lead) => lead.partnerRef === partner.code);
  const link = `https://avtocena.com/?ref=${partner.code}`;

  return (
    <PartnerShell title="Личный кабинет" subtitle="Партнёр видит только свои переходы, заявки, статусы и выплаты. Контакты клиентов скрыты.">
      <div className="grid gap-4 md:grid-cols-5">
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Переходы</div><div className="mt-2 text-4xl font-black">{partner.clicks || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Расчёты</div><div className="mt-2 text-4xl font-black">{partner.calculations || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Заявки</div><div className="mt-2 text-4xl font-black">{partnerLeads.length || partner.leads || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Договоры</div><div className="mt-2 text-4xl font-black">{partner.contracts || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Баланс</div><div className="mt-2 text-4xl font-black">{money(Number(partner.balanceRub || 0))} ₽</div></div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">Ваша ссылка</h2>
          <div className="mt-4 overflow-auto rounded-2xl bg-black/30 p-4 font-mono text-sm text-white/78">{link}</div>
          <p className="mt-4 text-sm font-bold text-white/55">Передавайте эту ссылку или QR. Все заявки по ref попадут в ваш кабинет.</p>
        </div>
        <div className="glass rounded-[2rem] p-6 text-center">
          <div className="mx-auto grid h-48 w-48 place-items-center rounded-3xl bg-white text-center text-xl font-black text-black">
            QR<br />{partner.code}
          </div>
          <div className="mt-4 text-sm font-bold text-white/55">QR-заглушка. Генератор подключим следующим шагом.</div>
        </div>
      </div>

      <div className="glass mt-5 overflow-hidden rounded-[2rem]">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-2xl font-black">Мои заявки</h2>
          <p className="mt-1 text-sm font-bold text-white/45">Партнёр видит безопасную карточку без телефона клиента.</p>
        </div>

        {partnerLeads.map((lead) => (
          <div key={lead.id} className="grid gap-3 border-b border-white/7 p-5 last:border-0 md:grid-cols-4">
            <div className="font-black">{lead.car || [lead.brand, lead.model].filter(Boolean).join(" ") || "Авто не выбрано"}</div>
            <div className="text-white/60">{lead.budgetRub ? `${money(Number(lead.budgetRub))} ₽` : "Бюджет не указан"}</div>
            <div className="text-white/60">{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("ru-RU") : "—"}</div>
            <div><span className="rounded-full bg-red-500/20 px-3 py-1 text-sm font-black text-red-100">{lead.status || "new"}</span></div>
          </div>
        ))}

        {!partnerLeads.length && <div className="p-8 text-center text-sm font-bold text-white/50">Заявок по вашей ссылке пока нет.</div>}
      </div>
    </PartnerShell>
  );
}
