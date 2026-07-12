import type { Metadata } from "next";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { CopyCodeBlock } from "@/components/partner/CopyCodeBlock";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CPA API — АвтоЦена",
  robots: { index: false, follow: false },
};

const trackingUrl =
  "https://avtocena.com/?ref={partner_id}&click_id={click_id}&sub1={sub1}&sub2={sub2}&sub3={sub3}&sub4={sub4}&sub5={sub5}";

const outboundPostback =
  "https://network.example/postback?click_id={click_id}&status={status}&lead_id={lead_id}&payout={payout}";

const statusRows = [
  ["lead_created", "new", "Заявка создана и попала в CRM"],
  ["lead_status_changed", "in_progress", "Менеджер начал работу с клиентом"],
  ["lead_status_changed", "rejected", "Отказ с обязательной причиной"],
  ["lead_status_changed", "duplicate", "Дубль заявки"],
  ["contract_signed", "approved", "Договор подписан — целевое действие"],
];

const statusChipStyles: Record<
  string,
  { backgroundColor: string; borderColor: string; color: string }
> = {
  new: {
    backgroundColor: "#0ea5e9",
    borderColor: "#38bdf8",
    color: "#ffffff",
  },
  in_progress: {
    backgroundColor: "#facc15",
    borderColor: "#fde047",
    color: "#111827",
  },
  rejected: {
    backgroundColor: "#ef4444",
    borderColor: "#f87171",
    color: "#ffffff",
  },
  duplicate: {
    backgroundColor: "#64748b",
    borderColor: "#94a3b8",
    color: "#ffffff",
  },
  approved: {
    backgroundColor: "#22c55e",
    borderColor: "#4ade80",
    color: "#ffffff",
  },
};

const statusDotColors: Record<string, string> = {
  new: "#ffffff",
  in_progress: "#111827",
  rejected: "#ffffff",
  duplicate: "#ffffff",
  approved: "#ffffff",
};

const trackingParams = [
  ["ref", "Идентификатор партнёра или CPA-сети"],
  ["click_id", "Уникальный click ID сети"],
  ["sub1–sub5", "Subaccount-параметры вебмастера и рекламной кампании"],
  ["utm_*", "Дополнительная маркетинговая разметка"],
];

export default function PartnerApiPage() {
  return (
    <PartnerShell
      title="CPA API"
      subtitle="Техническая документация для CPA-сетей и крупных партнёров. Страница закрыта от индексации и доступна только после согласования."
    >
      <div className="space-y-4 sm:space-y-5">
        <section className="glass rounded-[1.6rem] p-4 sm:rounded-[2rem] sm:p-6">
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold leading-6 text-red-100">
            Основной сценарий: CPA-сеть передаёт нам click_id в ссылке. После
            обработки клиента наш сервер сам отправляет S2S-postback на URL
            сети. Статус подписанного договора формируется только в нашей CRM.
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {[
              ["1", "Клик", "Сеть добавляет click_id"],
              ["2", "Лид", "Заявка попадает в CRM"],
              ["3", "Статус", "Менеджер ведёт клиента"],
              ["4", "Postback", "Мы отправляем событие сети"],
            ].map(([number, title, text]) => (
              <div
                key={number}
                className="rounded-2xl border border-white/8 bg-white/[0.04] p-4"
              >
                <div className="grid h-8 w-8 place-items-center rounded-full bg-red-500 text-sm font-black text-white">
                  {number}
                </div>
                <div className="mt-3 font-black text-white">{title}</div>
                <div className="mt-1 text-xs font-bold leading-5 text-white/45">
                  {text}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] xl:gap-5">
          <section className="glass min-w-0 rounded-[1.6rem] p-4 sm:rounded-[2rem] sm:p-6">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-red-300">
              Входящий трафик
            </div>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">
              Tracking URL
            </h2>
            <p className="mt-3 text-sm font-bold leading-7 text-white/52">
              Сеть подставляет свои значения в ссылку. Мы сохраняем их как
              first-party атрибуцию и переносим в расчёт, заявку и CRM.
            </p>

            <div className="mt-5">
              <CopyCodeBlock
                label="Шаблон ссылки"
                value={trackingUrl}
                hint="Обязательный параметр для CPA-интеграции — click_id."
              />
            </div>

            <div className="mt-5 grid gap-2">
              {trackingParams.map(([name, description]) => (
                <div
                  key={name}
                  className="grid min-w-0 gap-1 rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-3"
                >
                  <code className="break-all font-mono text-sm font-black text-white">
                    {name}
                  </code>
                  <div className="text-sm font-bold leading-6 text-white/48">
                    {description}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass min-w-0 rounded-[1.6rem] p-4 sm:rounded-[2rem] sm:p-6">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-red-300">
              Исходящая конверсия
            </div>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">
              S2S Postback
            </h2>
            <p className="mt-3 text-sm font-bold leading-7 text-white/52">
              CPA-сеть предоставляет callback URL и правила параметров. Мы
              сохраняем шаблон в адаптере сети и отправляем событие после
              изменения статуса менеджером.
            </p>

            <div className="mt-5">
              <CopyCodeBlock
                label="Пример URL сети"
                value={outboundPostback}
                hint="Это пример адреса сети, а не endpoint АвтоЦены."
              />
            </div>

            <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-400/8 p-4">
              <div className="font-black text-emerald-100">
                Целевое действие
              </div>
              <div className="mt-2 text-sm font-bold leading-6 text-emerald-100/72">
                Подписанный договор. Внутреннее событие:
                <code className="ml-1 break-all font-mono text-white">
                  contract_signed
                </code>
                . В сеть передаётся согласованный статус, обычно approved.
              </div>
            </div>
          </section>
        </div>

        <section className="glass overflow-hidden rounded-[1.6rem] sm:rounded-[2rem]">
          <div className="border-b border-white/10 p-4 sm:p-6">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-red-300">
              Сопоставление событий
            </div>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">
              Статусы CRM → CPA-сеть
            </h2>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-white/50">
              Точные названия статусов и параметры postback настраиваются
              отдельно для каждой сети. Причина отказа хранится и может быть
              передана в соответствующее поле сети.
            </p>
          </div>

          <div className="hidden grid-cols-[190px_150px_minmax(0,1fr)] gap-3 border-b border-white/8 px-6 py-3 text-xs font-black uppercase tracking-[0.12em] text-white/35 md:grid">
            <div>Событие АвтоЦены</div>
            <div>Статус сети</div>
            <div>Смысл</div>
          </div>

          {statusRows.map(([event, status, description]) => (
            <div
              key={`${event}-${status}`}
              className="grid min-w-0 gap-2 border-b border-white/7 p-4 last:border-0 md:grid-cols-[190px_150px_minmax(0,1fr)] md:gap-3 md:px-6"
            >
              <div className="min-w-0">
                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                  Событие
                </div>
                <code className="break-all font-mono text-sm font-black text-white/82">
                  {event}
                </code>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                  Статус сети
                </div>
                <span
                  className="inline-flex min-w-[112px] items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black"
                  style={statusChipStyles[status]}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: statusDotColors[status] ?? "#ffffff" }}
                  />
                  {status}
                </span>
              </div>
              <div className="text-sm font-bold leading-6 text-white/48">
                {description}
              </div>
            </div>
          ))}
        </section>

        <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
          <section className="glass rounded-[1.6rem] p-4 sm:rounded-[2rem] sm:p-6">
            <h2 className="text-2xl font-black">Надёжность доставки</h2>
            <div className="mt-4 grid gap-3 text-sm font-bold leading-6 text-white/58">
              {[
                "дедупликация по событию и click_id",
                "очередь pending / sent / failed / retry",
                "повторная отправка при временной ошибке",
                "журнал ответа сети и числа попыток",
                "обязательная причина rejected / duplicate",
              ].map((item) => (
                <div key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="glass rounded-[1.6rem] p-4 sm:rounded-[2rem] sm:p-6">
            <h2 className="text-2xl font-black">Проверка интеграции</h2>
            <div className="mt-4 space-y-3">
              {[
                "Сеть передаёт тестовый click_id по Tracking URL",
                "Мы подтверждаем сохранение клика и создаём тестовый лид",
                "Менеджер меняет статус в CRM",
                "CPA Gateway отправляет тестовый postback",
                "Сверяем click_id, статус и ответ сервера сети",
              ].map((step, index) => (
                <div
                  key={step}
                  className="flex gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-3"
                >
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-500 text-xs font-black text-white">
                    {index + 1}
                  </div>
                  <div className="text-sm font-bold leading-6 text-white/58">
                    {step}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PartnerShell>
  );
}
