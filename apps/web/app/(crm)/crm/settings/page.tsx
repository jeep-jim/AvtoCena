import { CrmShell } from "@/components/crm/CrmShell";

export default function CrmSettingsPage() {
  return (
    <CrmShell activeHref="/crm/settings" title="Настройки" subtitle="Пока это карта настроек MVP. Дальше сюда добавим роли, страны, комиссии, ставки и доступы.">
      <div className="grid gap-4 md:grid-cols-2">
        {["Комиссии по странам", "Утильсбор и таможня", "Telegram ID сотрудников", "CPA postback secret", "Статусы сделок", "Шаблоны SEO"].map((item) => (
          <div key={item} className="glass rounded-3xl p-5 text-xl font-black">{item}</div>
        ))}
      </div>
    </CrmShell>
  );
}
