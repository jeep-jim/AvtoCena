import { CrmShell } from "@/components/crm/CrmShell";
import { readDataJson } from "@/lib/data";
import { money } from "@/lib/avtocena";

export default function CrmDealsPage() {
  const deals = readDataJson<any[]>("deals/deals.json", []);
  const demo = deals.length ? deals : [{ id: "deal_demo", car: "Audi A3 Sportback", client: "Демо клиент", stage: "Расчёт", totalRub: 2560800 }];

  return (
    <CrmShell title="Сделки" subtitle="Карточки договоров: от АвтоЦены до выдачи автомобиля клиенту.">
      <div className="grid gap-4 md:grid-cols-3">
        {demo.map((deal) => (
          <article key={deal.id} className="glass rounded-[2rem] p-5">
            <div className="text-sm font-black text-red-200">{deal.stage}</div>
            <h2 className="mt-2 text-2xl font-black">{deal.car}</h2>
            <p className="mt-1 text-sm font-bold text-white/50">{deal.client}</p>
            <div className="mt-5 text-3xl font-black">{money(Number(deal.totalRub || 0))} ₽</div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/4 bg-red-500" /></div>
          </article>
        ))}
      </div>
    </CrmShell>
  );
}
