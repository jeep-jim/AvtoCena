import type { Metadata } from "next";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { money } from "@/lib/avtocena";
import { readChunkedDataJson, readDataJson } from "@/lib/data";
import { getCurrentUser, isAdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Кабинет партнёра — АвтоЦена",
  robots: { index: false, follow: false },
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
};

type PayoutRequest = {
  id: string;
  createdAt: string;
  partnerCode: string;
  amountRub: number;
  status: "pending" | "approved" | "paid" | "rejected";
};

function StatCard({ label, value, wide = false }: StatCardProps) {
  return (
    <div
      className={[
        "glass min-w-0 rounded-[1.2rem] p-3.5 sm:rounded-3xl sm:p-5",
        wide ? "col-span-2 lg:col-span-1" : "",
      ].join(" ")}
    >
      <div className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-white/42 sm:text-[12px]">
        {label}
      </div>
      <div className="mt-2 min-w-0 break-words text-[26px] font-black leading-none tracking-[-0.045em] text-white sm:text-[32px] xl:text-[34px]">
        {value}
      </div>
    </div>
  );
}

function payoutStatusLabel(status: PayoutRequest["status"]) {
  if (status === "paid") return "Выплачено";
  if (status === "approved") return "Одобрено";
  if (status === "rejected") return "Отклонено";
  return "На проверке";
}

export default async function PartnerPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const payoutState = firstParam(params.payout);
  const user = await getCurrentUser();
  const partners = await readDataJson<any[]>("partners/partners.json", []);
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const payoutRequests = await readChunkedDataJson<PayoutRequest>(
    "partners/payout-requests.json",
    [],
  );
  const accruals = await readChunkedDataJson<any>("partners/accruals.json", []);
  const requestedRef = firstParam(params.ref);
  const code = isAdminRole(user?.role)
    ? requestedRef || user?.partnerCode || "demo"
    : user?.partnerCode || "demo";
  const partner = partners.find((item) => item.code === code) ||
    partners[0] || {
      name: "Партнёр",
      code,
      clicks: 0,
      calculations: 0,
      leads: 0,
      contracts: 0,
      balanceRub: 0,
      partnerType: "direct",
    };
  const partnerLeads = leads.filter((lead) => lead.partnerRef === partner.code);
  const partnerPayouts = payoutRequests.filter(
    (request) => request.partnerCode === partner.code,
  );
  const partnerAccruals = accruals.filter((item) => item.partnerCode === partner.code);
  const pendingPayout = partnerPayouts.find(
    (request) => request.status === "pending" || request.status === "approved",
  );
  const availableBalance = Math.max(0, Number(partner.balanceRub || 0));
  const isCpaNetwork = partner.partnerType === "cpa-network";
  const link = `https://avtocena.com/?ref=${partner.code}`;

  return (
    <PartnerShell
      title="Личный кабинет"
      subtitle="Партнёр видит только свои переходы, заявки, статусы и выплаты. Контакты клиентов скрыты."
    >
      <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5 lg:gap-4">
        <StatCard label="Переходы" value={partner.clicks || 0} />
        <StatCard label="Расчёты" value={partner.calculations || 0} />
        <StatCard
          label="Заявки"
          value={partnerLeads.length || partner.leads || 0}
        />
        <StatCard label="Договоры" value={partner.contracts || 0} />
        <StatCard
          label={isCpaNetwork ? "К начислению" : "Баланс к выводу"}
          value={`${money(availableBalance)} ₽`}
          wide
        />
      </div>

      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-5">
        <div className="glass min-w-0 rounded-[1.6rem] p-5 sm:rounded-[2rem] sm:p-6">
          <h2 className="text-xl font-black sm:text-2xl">Ваша ссылка</h2>
          <div className="mt-4 min-w-0 overflow-hidden rounded-2xl bg-black/30 p-3 font-mono text-[12px] font-bold leading-5 text-white/78 sm:p-4 sm:text-sm">
            <span className="block break-all">{link}</span>
          </div>
          <p className="mt-4 text-sm font-bold leading-6 text-white/55">
            Передавайте эту ссылку или QR. Все переходы, расчёты и заявки по
            вашему ref будут привязаны к кабинету.
          </p>
        </div>

        <div className="glass rounded-[1.6rem] p-5 text-center sm:rounded-[2rem] sm:p-6">
          <div className="mx-auto grid h-36 w-36 place-items-center rounded-[1.4rem] bg-white text-center text-lg font-black text-black sm:h-44 sm:w-44 sm:rounded-3xl sm:text-xl">
            QR
            <br />
            <span className="max-w-[120px] break-all text-sm sm:max-w-[148px] sm:text-base">
              {partner.code}
            </span>
          </div>
          <div className="mt-4 text-xs font-bold leading-5 text-white/55 sm:text-sm">
            QR-код будет вести на вашу персональную ссылку.
          </div>
        </div>
      </div>

      <div className="glass mt-4 overflow-hidden rounded-[1.6rem] sm:mt-5 sm:rounded-[2rem]">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-xl font-black sm:text-2xl">Мои заявки</h2>
          <p className="mt-1 text-sm font-bold leading-6 text-white/45">
            Без телефона и других персональных данных клиента.
          </p>
        </div>

        {partnerLeads.map((lead) => (
          <div
            key={lead.id}
            className="grid min-w-0 gap-2 border-b border-white/7 p-5 last:border-0 sm:grid-cols-2 md:grid-cols-4 md:gap-3"
          >
            <div className="min-w-0 break-words font-black">
              {lead.car ||
                [lead.brand, lead.model].filter(Boolean).join(" ") ||
                "Авто не выбрано"}
            </div>
            <div className="min-w-0 break-words text-white/60">
              {lead.budgetRub
                ? `${money(Number(lead.budgetRub))} ₽`
                : "Бюджет не указан"}
            </div>
            <div className="text-white/60">
              {lead.createdAt
                ? new Date(lead.createdAt).toLocaleDateString("ru-RU")
                : "—"}
            </div>
            <div>
              <span className="inline-flex max-w-full rounded-full bg-red-500/20 px-3 py-1 text-sm font-black text-red-100">
                <span className="truncate">{lead.status || "new"}</span>
              </span>
            </div>
          </div>
        ))}

        {!partnerLeads.length ? (
          <div className="p-8 text-center text-sm font-bold text-white/50">
            Заявок по вашей ссылке пока нет.
          </div>
        ) : null}
      </div>

      <div className="glass mt-4 overflow-hidden rounded-[1.6rem] sm:mt-5 sm:rounded-[2rem]">
        <div className="border-b border-white/10 p-5"><h2 className="text-xl font-black sm:text-2xl">История начислений</h2><p className="mt-1 text-sm font-bold leading-6 text-white/45">Сумма и версия ставки фиксируются в момент начисления.</p></div>
        {partnerAccruals.map((item) => <div key={item.id} className="grid gap-2 border-b border-white/7 p-5 text-sm font-bold text-white/60 last:border-0 md:grid-cols-4"><div>{money(Number(item.payoutAmountRub || 0))} ₽</div><div className="break-all">{item.payoutVersionId || "—"}</div><div>{item.event}</div><div>{item.createdAt ? new Date(item.createdAt).toLocaleDateString("ru-RU") : "—"}</div></div>)}
        {!partnerAccruals.length ? <div className="p-6 text-sm font-bold text-white/45">Начислений пока нет.</div> : null}
      </div>

      <section
        id="payout"
        className="glass mt-4 rounded-[1.6rem] p-5 sm:mt-5 sm:rounded-[2rem] sm:p-6"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-red-300">
              Выплаты
            </div>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">
              {isCpaNetwork ? "Расчёты с CPA-сетью" : "Баланс на вывод"}
            </h2>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-white/52">
              {isCpaNetwork
                ? "Для CPA-сетей подтверждённые действия сверяются по реестру. Расчёт производится с сетью, а выплаты вебмастерам проводит сама сеть."
                : "После подписания договора начисление появляется в балансе. Отправьте запрос — менеджер проверит начисления и согласует способ выплаты в Telegram."}
            </p>

            {payoutState === "sent" ? (
              <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm font-bold leading-6 text-emerald-100">
                Запрос выплаты отправлен. Мы проверим начисления и свяжемся с
                вами в Telegram.
              </div>
            ) : null}
            {payoutState === "duplicate" ? (
              <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm font-bold leading-6 text-amber-100">
                У вас уже есть запрос выплаты на проверке.
              </div>
            ) : null}
            {payoutState === "empty" ? (
              <div className="mt-4 rounded-2xl border border-white/12 bg-white/[0.045] p-4 text-sm font-bold leading-6 text-white/65">
                На балансе пока нет доступной суммы для вывода.
              </div>
            ) : null}
            {payoutState === "error" ? (
              <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm font-bold leading-6 text-red-100">
                Не удалось создать запрос. Напишите администратору в Telegram.
              </div>
            ) : null}

            {!isCpaNetwork && partnerPayouts.length ? (
              <div className="mt-5 grid gap-2">
                {partnerPayouts.slice(0, 3).map((request) => (
                  <div
                    key={request.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3"
                  >
                    <div>
                      <div className="font-black text-white">
                        {money(Number(request.amountRub || 0))} ₽
                      </div>
                      <div className="mt-1 text-xs font-bold text-white/42">
                        {new Date(request.createdAt).toLocaleDateString("ru-RU")}
                      </div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs font-black text-white/72">
                      {payoutStatusLabel(request.status)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-white/42">
              {isCpaNetwork ? "Подтверждённые действия" : "Доступно сейчас"}
            </div>
            <div className="mt-3 break-words text-[34px] font-black leading-none tracking-[-0.05em] text-white sm:text-[40px]">
              {money(availableBalance)} ₽
            </div>

            {!isCpaNetwork ? (
              <form action="/api/partners/payout-request" method="post" className="mt-5">
                <label
                  htmlFor="payout-comment"
                  className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/42"
                >
                  Комментарий необязательно
                </label>
                <textarea
                  id="payout-comment"
                  name="comment"
                  rows={3}
                  maxLength={1000}
                  placeholder="Например: напишите мне в Telegram"
                  className="soft-input w-full resize-none rounded-2xl border border-white/12 bg-white/[0.055] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-red-400/55"
                />
                <button
                  type="submit"
                  disabled={!availableBalance || Boolean(pendingPayout)}
                  className="avto-button mt-3 flex min-h-13 w-full items-center justify-center rounded-2xl px-4 py-3.5 font-black disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {pendingPayout ? "Запрос уже на проверке" : "Запросить выплату"}
                </button>
              </form>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-bold leading-6 text-white/55">
                Реестр и реквизиты расчёта согласуются при подключении сети.
              </div>
            )}
          </div>
        </div>
      </section>
    </PartnerShell>
  );
}
