from pathlib import Path

path = Path("apps/web/components/home/HomePageClient.tsx")
text = path.read_text()

old_budget = '<div className="w-1/2 min-w-0 lg:w-full"><HomeSelect value={budget} options={budgets} onChange={setBudget} /></div>'
new_budget = '<div className="w-full min-w-0"><HomeSelect value={budget} options={budgets} onChange={setBudget} /></div>'
if text.count(old_budget) != 1:
    raise SystemExit(f"budget anchor count={text.count(old_budget)}")
text = text.replace(old_budget, new_budget, 1)

old_logo = '<img src="/brands/topavto-logo.png" alt="TopAvto" className="mb-1 block h-auto w-[82px] shrink-0 object-contain sm:w-[108px]" />'
new_logo = '<img src="/brands/topavto-logo.png" alt="TopAvto" className="mb-1 hidden h-auto w-[108px] shrink-0 object-contain lg:block" />'
if text.count(old_logo) != 1:
    raise SystemExit(f"TopAvto logo anchor count={text.count(old_logo)}")
text = text.replace(old_logo, new_logo, 1)

start_token = '        <section className="ac-hide-scrollbar -mr-4 flex min-h-[168px] snap-x snap-mandatory gap-3 overflow-x-auto pr-4 md:mr-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:pr-0" aria-label="Финансовые сервисы">'
end_token = '        </section>\n        <CurrencyRatesStrip rates={rates} variant="desktop" className="hidden lg:block" />'
start = text.find(start_token)
end_anchor = text.find(end_token, start)
if start < 0 or end_anchor < 0:
    raise SystemExit("finance cards anchors not found")
end = end_anchor + len('        </section>')

new_services = '''        <section className="ac-hide-scrollbar -mr-4 flex min-h-[168px] snap-x snap-mandatory gap-3 overflow-x-auto pr-4 md:mr-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:pr-0" aria-label="Финансовые сервисы">
          <article className="ac-executor-block relative min-h-[168px] min-w-[82%] snap-start overflow-hidden rounded-[1.6rem] p-5 md:min-w-0 lg:pr-[150px]">
            <div className="relative z-10 flex h-full flex-col">
              <div className="flex items-start justify-between gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ffd21f] text-[#111827]"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M3.5 10h17M7 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></div><span className="rounded-full border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-3 py-1 text-[10px] font-black uppercase tracking-[.12em] text-[var(--ac-text)]">Автокредит</span></div>
              <div className="mt-auto pt-5 lg:max-w-[270px]"><h3 className="text-lg font-black leading-tight text-[var(--ac-text)] md:text-xl">Кредитный калькулятор</h3><p className="mt-2 max-w-[330px] text-sm font-medium leading-5 text-[var(--ac-muted)]">Рассчитайте платёж и подберите удобные условия покупки автомобиля.</p></div>
            </div>
            <img src="/avatars/manager-green.webp" alt="" className="pointer-events-none absolute bottom-0 right-2 hidden h-[156px] w-[138px] object-contain lg:block xl:h-[166px] xl:w-[148px]" aria-hidden="true" />
          </article>
          <article className="ac-executor-block relative min-h-[168px] min-w-[82%] snap-start overflow-hidden rounded-[1.6rem] p-5 md:min-w-0 lg:pr-[150px]">
            <div className="absolute inset-y-5 left-0 w-[3px] rounded-r-full bg-[#ffd21f]" aria-hidden="true" />
            <div className="relative z-10 flex h-full flex-col">
              <div className="flex items-start justify-between gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ffd21f] text-[#111827]"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 19 6v5.3c0 4.2-2.8 7.5-7 9.2-4.2-1.7-7-5-7-9.2V6l7-2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></div><span className="rounded-full border border-[#d6ad00] bg-[#ffd21f] px-3 py-1 text-[10px] font-black uppercase tracking-[.12em] text-[#111827]">ОСАГО</span></div>
              <div className="mt-auto pt-5 lg:max-w-[270px]"><h3 className="text-lg font-black leading-tight text-[var(--ac-text)] md:text-xl">Страховой полис ОСАГО</h3><p className="mt-2 max-w-[330px] text-sm font-medium leading-5 text-[var(--ac-muted)]">Быстрый расчёт стоимости полиса для выбранного автомобиля.</p></div>
            </div>
            <img src="/avatars/manager-yellow.webp" alt="" className="pointer-events-none absolute bottom-0 right-2 hidden h-[156px] w-[138px] object-contain lg:block xl:h-[166px] xl:w-[148px]" aria-hidden="true" />
          </article>
        </section>'''

text = text[:start] + new_services + text[end:]

required = [
    'className="w-full min-w-0"><HomeSelect value={budget}',
    'hidden h-auto w-[108px] shrink-0 object-contain lg:block',
    '>Автокредит</span>',
    '/avatars/manager-green.webp',
    '/avatars/manager-yellow.webp',
    'bg-[#ffd21f] text-[#111827]',
]
for token in required:
    if token not in text:
        raise SystemExit(f"missing required token: {token}")

path.write_text(text)
