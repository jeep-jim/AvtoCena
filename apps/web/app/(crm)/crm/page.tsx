import { CrmShell } from "@/components/crm/CrmShell";
import { readDataJson } from "@/lib/data";
import { money } from "@/lib/avtocena";

export default function CrmPage() {
  const leads = readDataJson<any[]>("leads/leads.json", []);
  const partners = readDataJson<any[]>("partners/partners.json", []);
  const deals = readDataJson<any[]>("deals/deals.json", []);

  return (
    <CrmShell title="Панель управления" subtitle="Первый каркас CRM: лиды, сделки, партнёры, выплаты и источники трафика.">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Лиды</div><div className="mt-2 text-4xl font-black">{leads.length}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Сделки</div><div className="mt-2 text-4xl font-black">{deals.length}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Партнёры</div><div className="mt-2 text-4xl font-black">{partners.length}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Выплата за договор</div><div className="mt-2 text-4xl font-black">{money(10000)} ₽</div></div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">Воронка</h2>
          <div className="mt-5 space-y-3">
            {["Расчёт АвтоЦены", "Заявка", "Договор", "Поиск авто", "Инвойс", "Таможня", "Выдача"].map((step, index) => (
              <div key={step} className="flex items-center justify-between rounded-2xl bg-white/7 px-4 py-3">
                <span className="font-bold text-white/68">{step}</span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black">{index + 1}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">Что дальше добавляем</h2>
          <div className="mt-5 space-y-3 text-sm font-bold text-white/62">
            <p>1. Авторизация сотрудников через Telegram ID.</p>
            <p>2. Статусы сделок и карточка клиента.</p>
            <p>3. Назначение менеджера и журнал действий.</p>
            <p>4. Автоматическое начисление партнёрского вознаграждения.</p>
          </div>
        </div>
      </div>
    </CrmShell>
  );
}
