import {
  MarketStructuredFields,
  CpaStructuredFields,
} from "@/components/crm/settings/StructuredSettingsFields";
import { money } from "@/lib/avtocena";
import { ContractTemplateForm } from "./ContractTemplateForm";

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: any;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-sm font-bold text-white placeholder:text-white/25 normal-case tracking-normal"
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: any;
}) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42 md:col-span-2">
      {label}
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={3}
        className="soft-input min-w-0 resize-y rounded-xl px-3 py-2.5 text-sm font-bold text-white placeholder:text-white/25 normal-case leading-6 tracking-normal"
      />
    </label>
  );
}

const MARKET_FLAGS: Record<string, string> = {
  japan: "🇯🇵",
  china: "🇨🇳",
  korea: "🇰🇷",
  uae: "🇦🇪",
  europe: "🇪🇺",
};

function marketLabel(market: any) {
  return `${MARKET_FLAGS[market.id] || "🌐"} ${market.name}`;
}

function StatCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.045] p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.08em] text-white/35">
        {label}
      </div>
      <div className="mt-1 break-words text-base font-black text-white/90">
        {value}
      </div>
    </div>
  );
}

export function BusinessSettingsPanel({
  markets,
  siteSettings,
  partnerProgram,
  cpaNetworks,
  contracts,
  changeLog,
  partners = [],
  canEdit,
}: any) {
  const site = siteSettings;
  const partner = partnerProgram;

  return (
    <div className="space-y-5">
      <section
        className="glass scroll-mt-32 rounded-[2rem] p-5 md:scroll-mt-36"
        id="markets"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black tracking-[-0.02em] text-white">
              Рынки
            </h2>
            <p className="mt-1 text-sm font-bold text-white/48">
              Активные версии коммерческих условий. Новая версия не
              пересчитывает старые заявки.
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/60">
            {markets.length} рынков
          </span>
        </div>
        <div className="mt-5 grid gap-4">
          {markets.map((market: any, index: number) => {
            const version =
              market.effectiveVersion ||
              market.versions?.find(
                (item: any) => item.id === market.activeVersionId,
              ) ||
              market.versions?.[0] ||
              {};
            return (
              <details
                key={market.id}
                className="group rounded-2xl border border-white/10 bg-black/20 p-0 transition open:border-red-400/40 open:bg-red-950/10 hover:border-white/20"
                open={market.id === "japan"}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 font-black text-white transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/70 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="break-words text-lg">
                      {marketLabel(market)}
                    </span>
                    <span className="ml-2 rounded-full bg-red-500/20 px-2 py-1 text-[11px] text-red-100">
                      {version.status} · v{version.version}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition group-open:rotate-180 group-open:border-red-300/50 group-open:text-red-100"
                  >
                    ⌄
                  </span>
                </summary>
                <div className="mx-4 mt-1 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="Рынок" value={marketLabel(market)} />
                  <StatCard label="Валюта" value={version.currency || "—"} />
                  <StatCard
                    label="Обеспечительный"
                    value={
                      version.securityDepositRub
                        ? `${money(version.securityDepositRub)} ₽`
                        : "—"
                    }
                  />
                  <StatCard
                    label="Комиссия"
                    value={
                      version.topAvtoCommissionRub
                        ? `${money(version.topAvtoCommissionRub)} ₽`
                        : "—"
                    }
                  />
                </div>
                <p className="mx-4 mt-3 break-words text-sm font-bold leading-6 text-white/55">
                  {version.conditionsDescription}
                </p>
                <div
                  id={index === 0 ? "stages" : undefined}
                  className="mx-4 mt-3 grid scroll-mt-32 gap-2 md:scroll-mt-36"
                >
                  {(version.dealStages || []).map((stage: any) => (
                    <div
                      key={`${market.id}-${stage.order}-${stage.title}`}
                      className="grid gap-2 rounded-xl border border-white/8 bg-white/[0.035] p-3 text-sm font-bold text-white/58 md:grid-cols-[48px_minmax(0,1fr)_120px_120px]"
                    >
                      <div>#{stage.order}</div>
                      <div className="min-w-0 break-words text-white">
                        {stage.title}
                      </div>
                      <div>{stage.amountType}</div>
                      <div>{stage.active ? "активен" : "выкл"}</div>
                    </div>
                  ))}
                </div>
                {canEdit ? (
                  <form
                    action="/api/crm/settings/markets"
                    method="post"
                    className="mx-4 mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-2 lg:grid-cols-4"
                  >
                    <input type="hidden" name="marketId" value={market.id} />
                    <Field
                      label="Название"
                      name="name"
                      defaultValue={market.name}
                    />
                    <Field
                      label="Валюта"
                      name="currency"
                      defaultValue={version.currency}
                    />
                    <Field
                      label="Обеспечительный ₽"
                      name="securityDepositRub"
                      type="number"
                      defaultValue={version.securityDepositRub}
                    />
                    <Field
                      label="Комиссия ₽"
                      name="topAvtoCommissionRub"
                      type="number"
                      defaultValue={version.topAvtoCommissionRub}
                    />
                    <Field
                      label="Первый платёж ₽"
                      name="contractInitialPaymentRub"
                      type="number"
                      defaultValue={version.contractInitialPaymentRub}
                    />
                    <Field
                      label="Резерв курса %"
                      name="exchangeRateReservePercent"
                      type="number"
                      defaultValue={version.exchangeRateReservePercent}
                    />
                    <Field
                      label="Export ₽"
                      name="exportExpensesRub"
                      type="number"
                      defaultValue={version.exportExpensesRub}
                    />
                    <Field
                      label="Логистика ₽"
                      name="logisticsRub"
                      type="number"
                      defaultValue={version.logisticsRub}
                    />
                    <Field
                      label="Брокер ₽"
                      name="brokerRub"
                      type="number"
                      defaultValue={version.brokerRub}
                    />
                    <Field
                      label="СВХ ₽"
                      name="svhRub"
                      type="number"
                      defaultValue={version.svhRub}
                    />
                    <Field
                      label="Лаборатория ₽"
                      name="laboratoryRub"
                      type="number"
                      defaultValue={version.laboratoryRub}
                    />
                    <Field
                      label="СБКТС ₽"
                      name="sbktsRub"
                      type="number"
                      defaultValue={version.sbktsRub}
                    />
                    <Field
                      label="ЭПТС ₽"
                      name="eptsRub"
                      type="number"
                      defaultValue={version.eptsRub}
                    />
                    <Field
                      label="Доставка РФ ₽"
                      name="rfDeliveryRub"
                      type="number"
                      defaultValue={version.rfDeliveryRub}
                    />
                    <Field
                      label="Другие расходы ₽"
                      name="otherFixedExpensesRub"
                      type="number"
                      defaultValue={version.otherFixedExpensesRub}
                    />
                    <Field
                      label="Effective from"
                      name="effectiveFrom"
                      type="datetime-local"
                    />
                    <Field
                      label="Сроки"
                      name="deliveryDays"
                      defaultValue={version.deliveryDays}
                    />
                    <label className="flex items-center gap-2 text-sm font-bold text-white/70">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={version.active}
                      />{" "}
                      Активен
                    </label>
                    <TextArea
                      label="Условия"
                      name="conditionsDescription"
                      defaultValue={version.conditionsDescription}
                    />
                    <div
                      id={index === 0 ? "calculations" : undefined}
                      className="scroll-mt-32 md:scroll-mt-36 md:col-span-2 lg:col-span-4"
                    >
                      <MarketStructuredFields version={version} />
                    </div>
                    <TextArea
                      label="Комментарий к изменению"
                      name="comment"
                      defaultValue=""
                    />
                    <button
                      className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white md:col-span-2 lg:col-span-4"
                      formAction="/api/crm/settings/markets"
                      formMethod="post"
                    >
                      Создать новую версию рынка
                    </button>
                  </form>
                ) : null}
              </details>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section
          className="glass scroll-mt-32 rounded-[2rem] p-5 md:scroll-mt-36"
          id="partners"
        >
          <h2 className="text-2xl font-black">Партнёрские выплаты</h2>
          <p className="mt-2 text-sm font-bold text-white/50">
            Текущая ставка прямой партнёрки:{" "}
            <b className="text-white">
              {money(partner?.defaultSignedContractPayoutRub || 0)} ₽
            </b>
            . CPA-сети используют отдельные настройки.
          </p>
          <div className="mt-3 grid gap-2">
            {partners.map((item: any) => (
              <div
                key={item.id}
                className="rounded-xl bg-white/[0.04] p-3 text-sm font-bold text-white/58"
              >
                <span className="text-white">{item.name}</span> · {item.code} ·
                ставка {money(Number(item.payoutRub || 0))} ₽
              </div>
            ))}
          </div>
          {canEdit && (
            <form
              action="/api/crm/settings/partners"
              method="post"
              className="mt-4 grid gap-3"
            >
              <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42">
                Партнёр для индивидуальной ставки
                <select
                  name="partnerCode"
                  className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-sm font-bold text-white placeholder:text-white/25 normal-case tracking-normal"
                >
                  <option value="">Базовая ставка</option>
                  {partners.map((item: any) => (
                    <option key={item.id} value={item.code}>
                      {item.name} · {item.code}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Новая ставка ₽"
                name="amountRub"
                type="number"
                defaultValue={partner?.defaultSignedContractPayoutRub}
              />
              <Field
                label="Дата действия"
                name="effectiveFrom"
                type="datetime-local"
              />
              <TextArea label="Комментарий" name="comment" />
              <button className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white">
                Создать новую ставку
              </button>
            </form>
          )}
        </section>
        <section
          className="glass scroll-mt-32 rounded-[2rem] p-5 md:scroll-mt-36"
          id="cpa"
        >
          <h2 className="text-2xl font-black">CPA-сети</h2>
          <p className="mt-2 text-sm font-bold text-white/50">
            По умолчанию сети неактивны до согласования условий.
          </p>
          <div className="mt-4 grid gap-2">
            {cpaNetworks.map((network: any) => (
              <div
                key={network.id}
                className="rounded-xl bg-white/[0.045] p-3 text-sm font-bold text-white/60"
              >
                <div className="break-words text-white">{network.name}</div>
                <div>
                  {network.status} · {network.payoutType} · cap{" "}
                  {network.dailyCap || "—"}/{network.monthlyCap || "—"}
                </div>
              </div>
            ))}
          </div>
          {canEdit && (
            <form
              action="/api/crm/settings/cpa"
              method="post"
              className="mt-4 grid gap-3 md:grid-cols-2"
            >
              <Field
                label="ID записи"
                name="id"
                defaultValue={cpaNetworks[0]?.id}
              />
              <Field
                label="Название"
                name="name"
                defaultValue={cpaNetworks[0]?.name}
              />
              <Field
                label="Network ID"
                name="networkId"
                defaultValue={cpaNetworks[0]?.networkId}
              />
              <Field
                label="Offer ID"
                name="offerId"
                defaultValue={cpaNetworks[0]?.offerId}
              />
              <Field
                label="Payout type"
                name="payoutType"
                defaultValue={cpaNetworks[0]?.payoutType}
              />
              <Field
                label="Payout amount"
                name="payoutAmount"
                type="number"
                defaultValue={cpaNetworks[0]?.payoutAmount}
              />
              <Field
                label="Hold days"
                name="holdDays"
                type="number"
                defaultValue={cpaNetworks[0]?.holdDays}
              />
              <Field
                label="Attribution window"
                name="attributionWindowDays"
                type="number"
                defaultValue={cpaNetworks[0]?.attributionWindowDays}
              />
              <Field
                label="Daily cap"
                name="dailyCap"
                type="number"
                defaultValue={cpaNetworks[0]?.dailyCap}
              />
              <Field
                label="Monthly cap"
                name="monthlyCap"
                type="number"
                defaultValue={cpaNetworks[0]?.monthlyCap}
              />
              <Field
                label="Effective from"
                name="effectiveFrom"
                type="datetime-local"
              />
              <label className="flex items-center gap-2 text-sm font-bold text-white/70">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={cpaNetworks[0]?.enabled}
                />{" "}
                Включить после подтверждения
              </label>
              <TextArea
                label="Разрешённые источники"
                name="allowedTrafficSources"
                defaultValue={(
                  cpaNetworks[0]?.allowedTrafficSources || []
                ).join("\n")}
              />
              <TextArea
                label="Запрещённые источники"
                name="forbiddenTrafficSources"
                defaultValue={(
                  cpaNetworks[0]?.forbiddenTrafficSources || []
                ).join("\n")}
              />
              <CpaStructuredFields network={cpaNetworks[0] || {}} />
              <TextArea label="Комментарий" name="comment" />
              <button className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white md:col-span-2">
                Сохранить CPA draft
              </button>
            </form>
          )}
        </section>
        <section
          className="glass scroll-mt-32 rounded-[2rem] p-5 md:scroll-mt-36"
          id="site"
        >
          <h2 className="text-2xl font-black">Настройки сайта</h2>
          <p className="mt-2 text-sm font-bold text-white/50">
            Бизнес-значения без переноса дизайна в JSON.
          </p>
          {canEdit && (
            <form
              action="/api/crm/settings/site"
              method="post"
              className="mt-4 grid gap-3 md:grid-cols-2"
            >
              <Field
                label="Выплата на сайте ₽"
                name="displayPartnerPayoutRub"
                type="number"
                defaultValue={site?.displayPartnerPayoutRub}
              />
              <Field
                label="Мин. бюджет ₽"
                name="minimumBudgetRub"
                type="number"
                defaultValue={site?.minimumBudgetRub}
              />
              <Field
                label="Резерв расчёта %"
                name="calculationReservePercent"
                type="number"
                defaultValue={site?.calculationReservePercent}
              />
              <Field
                label="Telegram"
                name="telegram"
                defaultValue={site?.contacts?.telegram}
              />
              <Field
                label="Телефон"
                name="phone"
                defaultValue={site?.contacts?.phone}
              />
              <Field
                label="Email"
                name="email"
                defaultValue={site?.contacts?.email}
              />
              <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42 md:col-span-2">
                Активные рынки
                <div className="flex flex-wrap gap-2 normal-case tracking-normal">
                  {markets.map((market: any) => (
                    <label
                      key={market.id}
                      className="rounded-xl bg-white/8 px-3 py-2 text-sm font-bold text-white/70"
                    >
                      <input
                        type="checkbox"
                        name="activeMarkets"
                        value={market.id}
                        defaultChecked={(site?.activeMarkets || []).includes(
                          market.id,
                        )}
                        className="mr-2"
                      />
                      {marketLabel(market)}
                    </label>
                  ))}
                </div>
              </label>
              <TextArea
                label="Сроки / пояснение"
                name="deliveryTermsText"
                defaultValue={site?.deliveryTermsText}
              />
              <TextArea label="Комментарий" name="comment" />
              <button className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white md:col-span-2">
                Создать новую версию сайта
              </button>
            </form>
          )}
        </section>
        <section
          className="glass scroll-mt-32 rounded-[2rem] p-5 md:scroll-mt-36"
          id="contracts"
        >
          <h2 className="text-2xl font-black">Договоры / Шаблоны</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-white/50">
            Архитектура готова: метаданные шаблонов, placeholders,
            сопоставления, PNG-подпись директора как визуальное наложение.
            Реальная генерация зависит от предоставленного файла шаблона.
          </p>
          <div className="mt-4 text-sm font-bold text-white/60">
            Шаблонов: {contracts.templates?.length || 0}
          </div>
          {canEdit && <ContractTemplateForm />}
        </section>
      </div>

      <section
        className="glass scroll-mt-32 rounded-[2rem] p-5 md:scroll-mt-36"
        id="history"
      >
        <h2 className="text-2xl font-black">История изменений</h2>
        <div className="mt-4 grid gap-2">
          {changeLog.slice(0, 20).map((entry: any) => (
            <div
              key={entry.id}
              className="rounded-xl bg-white/[0.04] p-3 text-sm font-bold text-white/58"
            >
              <div className="break-words text-white">
                {entry.entityType} ·{" "}
                {entry.changedByName || entry.changedByUserId}
              </div>
              <div>{entry.createdAt}</div>
              <div className="break-words">
                {entry.comment || "Без комментария"}
              </div>
            </div>
          ))}
          {!changeLog.length && (
            <div className="text-sm font-bold text-white/45">
              История пока пуста.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
