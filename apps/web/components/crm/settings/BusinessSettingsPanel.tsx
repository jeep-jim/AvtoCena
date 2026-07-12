import { money } from "@/lib/avtocena";

function Field({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue?: any; type?: string }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42">
      {label}
      <input name={name} type={type} defaultValue={defaultValue ?? ""} className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-sm font-bold normal-case tracking-normal" />
    </label>
  );
}

function TextArea({ label, name, defaultValue }: { label: string; name: string; defaultValue?: any }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42 md:col-span-2">
      {label}
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={3} className="soft-input min-w-0 resize-y rounded-xl px-3 py-2.5 text-sm font-bold normal-case leading-6 tracking-normal" />
    </label>
  );
}

export function BusinessSettingsPanel({ markets, siteSettings, partnerProgram, cpaNetworks, contracts, changeLog, canEdit }: any) {
  const site = siteSettings;
  const partner = partnerProgram;

  return (
    <div className="space-y-5">
      <section className="glass rounded-[2rem] p-5" id="markets">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black">Рынки</h2>
            <p className="mt-1 text-sm font-bold text-white/48">Активные версии коммерческих условий. Новая версия не пересчитывает старые заявки.</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/60">{markets.length} рынков</span>
        </div>
        <div className="mt-5 grid gap-4">
          {markets.map((market: any) => {
            const version = market.versions?.find((item: any) => item.id === market.activeVersionId) || market.versions?.[0] || {};
            return (
              <details key={market.id} className="rounded-2xl border border-white/10 bg-black/20 p-4" open={market.id === "japan"}>
                <summary className="cursor-pointer list-none font-black text-white">
                  <span className="break-words">{market.name}</span>
                  <span className="ml-2 rounded-full bg-red-500/20 px-2 py-1 text-[11px] text-red-100">{version.status} · v{version.version}</span>
                </summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl bg-white/[0.045] p-3"><div className="text-xs text-white/38">Валюта</div><div className="font-black">{version.currency || "—"}</div></div>
                  <div className="rounded-xl bg-white/[0.045] p-3"><div className="text-xs text-white/38">Обеспечительный</div><div className="font-black">{version.securityDepositRub ? `${money(version.securityDepositRub)} ₽` : "—"}</div></div>
                  <div className="rounded-xl bg-white/[0.045] p-3"><div className="text-xs text-white/38">Комиссия</div><div className="font-black">{version.topAvtoCommissionRub ? `${money(version.topAvtoCommissionRub)} ₽` : "—"}</div></div>
                  <div className="rounded-xl bg-white/[0.045] p-3"><div className="text-xs text-white/38">Первый платёж</div><div className="font-black">{version.contractInitialPaymentRub ? `${money(version.contractInitialPaymentRub)} ₽` : "—"}</div></div>
                </div>
                <p className="mt-3 break-words text-sm font-bold leading-6 text-white/55">{version.conditionsDescription}</p>
                <div className="mt-3 grid gap-2">
                  {(version.dealStages || []).map((stage: any) => (
                    <div key={`${market.id}-${stage.order}-${stage.title}`} className="grid gap-2 rounded-xl bg-white/[0.035] p-3 text-sm font-bold text-white/62 md:grid-cols-[48px_minmax(0,1fr)_120px_120px]">
                      <div>#{stage.order}</div><div className="min-w-0 break-words text-white">{stage.title}</div><div>{stage.amountType}</div><div>{stage.active ? "активен" : "выкл"}</div>
                    </div>
                  ))}
                </div>
                {canEdit ? (
                  <form action="/api/crm/settings/markets" method="post" className="mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-2 lg:grid-cols-4">
                    <input type="hidden" name="marketId" value={market.id} />
                    <Field label="Название" name="name" defaultValue={market.name} />
                    <Field label="Валюта" name="currency" defaultValue={version.currency} />
                    <Field label="Обеспечительный ₽" name="securityDepositRub" type="number" defaultValue={version.securityDepositRub} />
                    <Field label="Комиссия ₽" name="topAvtoCommissionRub" type="number" defaultValue={version.topAvtoCommissionRub} />
                    <Field label="Первый платёж ₽" name="contractInitialPaymentRub" type="number" defaultValue={version.contractInitialPaymentRub} />
                    <Field label="Резерв курса %" name="exchangeRateReservePercent" type="number" defaultValue={version.exchangeRateReservePercent} />
                    <Field label="Сроки" name="deliveryDays" defaultValue={version.deliveryDays} />
                    <label className="flex items-center gap-2 text-sm font-bold text-white/70"><input type="checkbox" name="active" defaultChecked={version.active} /> Активен</label>
                    <TextArea label="Условия" name="conditionsDescription" defaultValue={version.conditionsDescription} />
                    <TextArea label="Комментарий к изменению" name="comment" defaultValue="" />
                    <button className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white md:col-span-2 lg:col-span-4" formAction="/api/crm/settings/markets" formMethod="post">Создать новую версию рынка</button>
                  </form>
                ) : null}
              </details>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="glass rounded-[2rem] p-5" id="partners"><h2 className="text-2xl font-black">Партнёрские выплаты</h2><p className="mt-2 text-sm font-bold text-white/50">Текущая ставка прямой партнёрки: <b className="text-white">{money(partner?.defaultSignedContractPayoutRub || 0)} ₽</b>. CPA-сети используют отдельные настройки.</p>{canEdit && <form action="/api/crm/settings/partners" method="post" className="mt-4 grid gap-3"><Field label="Новая ставка ₽" name="amountRub" type="number" defaultValue={partner?.defaultSignedContractPayoutRub} /><Field label="Дата действия" name="effectiveFrom" type="datetime-local" /><TextArea label="Комментарий" name="comment" /><button className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white">Создать новую ставку</button></form>}</section>
        <section className="glass rounded-[2rem] p-5" id="cpa"><h2 className="text-2xl font-black">CPA-сети</h2><p className="mt-2 text-sm font-bold text-white/50">По умолчанию сети неактивны до согласования условий.</p><div className="mt-4 grid gap-2">{cpaNetworks.map((network: any) => <div key={network.id} className="rounded-xl bg-white/[0.045] p-3 text-sm font-bold text-white/60"><div className="break-words text-white">{network.name}</div><div>{network.status} · {network.payoutType} · cap {network.dailyCap || "—"}/{network.monthlyCap || "—"}</div></div>)}</div></section>
        <section className="glass rounded-[2rem] p-5" id="site"><h2 className="text-2xl font-black">Настройки сайта</h2><p className="mt-2 text-sm font-bold text-white/50">Бизнес-значения без переноса дизайна в JSON.</p>{canEdit && <form action="/api/crm/settings/site" method="post" className="mt-4 grid gap-3 md:grid-cols-2"><Field label="Выплата на сайте ₽" name="displayPartnerPayoutRub" type="number" defaultValue={site?.displayPartnerPayoutRub} /><Field label="Мин. бюджет ₽" name="minimumBudgetRub" type="number" defaultValue={site?.minimumBudgetRub} /><Field label="Резерв расчёта %" name="calculationReservePercent" type="number" defaultValue={site?.calculationReservePercent} /><TextArea label="Сроки / пояснение" name="deliveryTermsText" defaultValue={site?.deliveryTermsText} /><TextArea label="Комментарий" name="comment" /><button className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white md:col-span-2">Создать новую версию сайта</button></form>}</section>
        <section className="glass rounded-[2rem] p-5" id="contracts"><h2 className="text-2xl font-black">Договоры / Шаблоны</h2><p className="mt-2 text-sm font-bold leading-6 text-white/50">Архитектура готова: метаданные шаблонов, placeholders, сопоставления, PNG-подпись директора как визуальное наложение. Реальная генерация зависит от предоставленного файла шаблона.</p><div className="mt-4 text-sm font-bold text-white/60">Шаблонов: {contracts.templates?.length || 0}</div></section>
      </div>

      <section className="glass rounded-[2rem] p-5" id="history"><h2 className="text-2xl font-black">История изменений</h2><div className="mt-4 grid gap-2">{changeLog.slice(0, 20).map((entry: any) => <div key={entry.id} className="rounded-xl bg-white/[0.04] p-3 text-sm font-bold text-white/58"><div className="break-words text-white">{entry.entityType} · {entry.changedByName || entry.changedByUserId}</div><div>{entry.createdAt}</div><div className="break-words">{entry.comment || "Без комментария"}</div></div>)}{!changeLog.length && <div className="text-sm font-bold text-white/45">История пока пуста.</div>}</div></section>
    </div>
  );
}
