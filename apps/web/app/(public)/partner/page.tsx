import type { Metadata } from "next";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { money } from "@/lib/avtocena";
import { readChunkedDataJson, readDataJson } from "@/lib/data";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { leadStatusLabel } from "@/lib/crm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Кабинет партнёра — АвтоЦена",
  robots: { index: false, follow: false }
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function uniqueCount(items: any[], key: string) {
  return new Set(items.map((item) => item[key]).filter(Boolean)).size;
}

function isSignedStatus(status?: string) {
  return ["contract_signed", "paid", "in_progress", "delivered", "completed"].includes(status || "");
}

export default async function PartnerPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const user = getCurrentUser();
  const partners = readDataJson<any[]>("partners/partners.json", []);
  const leads = readChunkedDataJson<any>("leads/leads.json", []);
  const events = readChunkedDataJson<any>("cpa/events.json", []);
  const payoutConfig = readDataJson<any>("cpa/payouts.json", { defaultSignedContractPayoutRub: 10000 });
  const requestedRef = firstParam(params.ref);
  const code = isAdminRole(user?.role) ? requestedRef || user?.partnerCode || "demo" : user?.partnerCode || "demo";
  const partner = partners.find((item) => item.code === code) || partners[0] || { name: "Партнёр", code };
  const partnerLeads = leads.filter((lead) => lead.partnerRef === partner.code);
  const partnerEvents = events.filter((event) => event.partnerRef === partner.code || event.partnerId === partner.code || event.partnerId === partner.id);
  const visitEvents = partnerEvents.filter((event) => event.eventType === "visit" || event.status === "visit");
  const calculationEvents = partnerEvents.filter((event) => event.eventType === "calculation_completed" || event.status === "calculation");
  const signedContracts = partnerLeads.filter((lead) => isSignedStatus(lead.status));
  const payoutRub = Number(partner.payoutRub || payoutConfig.defaultSignedContractPayoutRub || 10000);
  const trackedClicks = uniqueCount(visitEvents, "clickId");
  const trackedCalculations = uniqueCount(calculationEvents, "dedupeKey") || uniqueCount(calculationEvents, "clickId");
  const balanceRub = signedContracts.length * payoutRub;
  const link = `https://avtocena.com/?ref=${partner.code}`;

  return (
    <PartnerShell title="Личный кабинет" subtitle="Партнёр видит только свои переходы, заявки, статусы и выплаты. Контакты клиентов скрыты.">
      <div className="grid gap-4 md:grid-cols-5">
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Переходы</div><div className="mt-2 text-4xl font-black">{trackedClicks || partner.clicks || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Расчёты</div><div className="mt-2 text-4xl font-black">{trackedCalculations || partner.calculations || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Заявки</div><div className="mt-2 text-4xl font-black">{partnerLeads.length || partner.leads || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Договоры</div><div className="mt-2 text-4xl font-black">{signedContracts.length || partner.contracts || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Баланс</div><div className="mt-2 text-4xl font-black">{money(balanceRub || Number(partner.balanceRub || 0))} ₽</div></div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">Ваша ссылка</h2>
          <div className="mt-4 overflow-auto rounded-2xl bg-black/30 p-4 font-mono text-sm text-white/78">{link}</div>
          <p className="mt-4 text-sm font-bold text-white/55">Можно добавлять click_id, sub1–sub5 и UTM-метки. Они сохранятся до заявки и будут видны в статистике.</p>
        </div>
        <div className="glass rounded-[2rem] p-6 text-center">
          <div className="mx-auto grid h-48 w-48 place-items-center rounded-3xl bg-white text-center text-xl font-black text-black">
            QR<br />{partner.code}
          </div>
          <div className="mt-4 text-sm font-bold text-white/55">QR-заглушка. Генератор подключим отдельным блоком.</div>
        </div>
      </div>

      <div className="glass mt-5 overflow-hidden rounded-[2rem]">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-2xl font-black">Мои заявки</h2>
          <p className="mt-1 text-sm font-bold text-white/45">Без ФИО, телефона, Telegram и внутренних комментариев менеджеров.</p>
        </div>

        {partnerLeads.map((lead) => (
          <div key={lead.id} className="grid gap-3 border-b border-white/7 p-5 last:border-0 md:grid-cols-[1.3fr_1fr_0.8fr_1fr]">
            <div>
              <div className="font-black">{lead.car || [lead.brand, lead.model].filter(Boolean).join(" ") || "Авто не выбрано"}</div>
              {(lead.attribution?.sub1 || lead.attribution?.utmCampaign) && (
                <div className="mt-1 text-xs font-bold text-white/40">Кампания: {lead.attribution?.sub1 || lead.attribution?.utmCampaign}</div>
              )}
            </div>
            <div className="text-white/60">{lead.budgetRub ? `${money(Number(lead.budgetRub))} ₽` : "Бюджет не указан"}</div>
            <div className="text-white/60">{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("ru-RU") : "—"}</div>
            <div><span className="rounded-full bg-red-500/20 px-3 py-1 text-sm font-black text-red-100">{leadStatusLabel(lead.status)}</span></div>
          </div>
        ))}

        {!partnerLeads.length && <div className="p-8 text-center text-sm font-bold text-white/50">Заявок по вашей ссылке пока нет.</div>}
      </div>
    </PartnerShell>
  );
}
