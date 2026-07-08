import { CrmShell } from "@/components/crm/CrmShell";
import { readDataJson } from "@/lib/data";
import { money } from "@/lib/avtocena";

export default function CrmPartnersPage() {
  const partners = readDataJson<any[]>("partners/partners.json", []);

  return (
    <CrmShell title="Партнёры" subtitle="Арбитражники, вебмастера, представители и CPA-источники.">
      <div className="glass overflow-hidden rounded-[2rem]">
        <div className="grid grid-cols-5 gap-3 border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.14em] text-white/42">
          <div>Партнёр</div><div>Код</div><div>Переходы</div><div>Договоры</div><div>К выплате</div>
        </div>
        {partners.map((partner) => (
          <div key={partner.id} className="grid grid-cols-5 gap-3 border-b border-white/7 p-4 text-sm font-bold text-white/70 last:border-0">
            <div>{partner.name}</div>
            <div>{partner.code}</div>
            <div>{partner.clicks || 0}</div>
            <div>{partner.contracts || 0}</div>
            <div>{money(Number(partner.balanceRub || 0))} ₽</div>
          </div>
        ))}
      </div>
    </CrmShell>
  );
}
