import { CrmShell } from "@/components/crm/CrmShell";
import { readDataJson } from "@/lib/data";
import { money } from "@/lib/avtocena";

export default function CrmLeadsPage() {
  const leads = readDataJson<any[]>("leads/leads.json", []);

  return (
    <CrmShell title="Лиды" subtitle="Все заявки из сайта, PWA, Mini App, бота, CPA и партнёрских ссылок.">
      <div className="glass overflow-hidden rounded-[2rem]">
        <div className="grid grid-cols-5 gap-3 border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.14em] text-white/42">
          <div>Клиент</div><div>Авто</div><div>Бюджет</div><div>Источник</div><div>Статус</div>
        </div>
        {(leads.length ? leads : [{ id: "demo", name: "Демо лид", car: "Audi A3 Sportback", budgetRub: 3000000, source: "site", status: "new" }]).map((lead) => (
          <div key={lead.id} className="grid grid-cols-5 gap-3 border-b border-white/7 p-4 text-sm font-bold text-white/70 last:border-0">
            <div>{lead.name || lead.phone || lead.telegram || "Без имени"}</div>
            <div>{lead.car || "Не выбрано"}</div>
            <div>{lead.budgetRub ? `${money(Number(lead.budgetRub))} ₽` : "—"}</div>
            <div>{lead.partnerRef ? `ref:${lead.partnerRef}` : lead.source || "site"}</div>
            <div><span className="rounded-full bg-red-500/20 px-3 py-1 text-red-100">{lead.status || "new"}</span></div>
          </div>
        ))}
      </div>
    </CrmShell>
  );
}
