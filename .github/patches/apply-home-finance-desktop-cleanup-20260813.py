from pathlib import Path

path = Path("apps/web/components/home/HomePageClient.tsx")
text = path.read_text()

old_budget = '<div className="w-full min-w-0"><HomeSelect value={budget} options={budgets} onChange={setBudget} /></div>'
new_budget = '<div className="ac-budget-select w-full min-w-0 max-w-none"><HomeSelect value={budget} options={budgets} onChange={setBudget} /></div>'
if text.count(old_budget) != 1:
    raise SystemExit(f"budget wrapper anchor count={text.count(old_budget)}")
text = text.replace(old_budget, new_budget, 1)

old_start = '      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">\n        <section className="ac-hide-scrollbar -mr-4 flex min-h-[168px] snap-x snap-mandatory gap-3 overflow-x-auto pr-4 md:mr-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:pr-0" aria-label="Финансовые сервисы">'
start = text.find(old_start)
end_token = '        </section>\n        <CurrencyRatesStrip rates={rates} variant="desktop" className="hidden lg:block" />\n      </div>'
end_anchor = text.find(end_token, start)
if start < 0 or end_anchor < 0:
    raise SystemExit("finance desktop block anchors not found")
end = end_anchor + len(end_token)

new_block = '''      <div className="mt-4 hidden gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
        <section className="grid min-h-[168px] grid-cols-2 gap-4" aria-label="Финансовые сервисы">
          <article className="ac-executor-block relative min-h-[168px] overflow-hidden rounded-[1.6rem] p-6 pr-[160px]">
            <div className="relative z-10 flex h-full min-h-[120px] flex-col justify-center">
              <h3 className="max-w-[290px] text-xl font-black leading-tight text-[var(--ac-text)]">Кредитный калькулятор</h3>
              <p className="mt-2 max-w-[300px] text-sm font-medium leading-5 text-[var(--ac-muted)]">Рассчитайте платёж и подберите удобные условия покупки автомобиля.</p>
            </div>
            <img src="/avatars/manager-green.webp" alt="" className="pointer-events-none absolute bottom-0 right-3 h-[162px] w-[145px] object-contain xl:h-[170px] xl:w-[152px]" aria-hidden="true" />
          </article>
          <article className="ac-executor-block relative min-h-[168px] overflow-hidden rounded-[1.6rem] p-6 pr-[160px]">
            <div className="relative z-10 flex h-full min-h-[120px] flex-col justify-center">
              <h3 className="max-w-[290px] text-xl font-black leading-tight text-[var(--ac-text)]">Страховой полис ОСАГО</h3>
              <p className="mt-2 max-w-[300px] text-sm font-medium leading-5 text-[var(--ac-muted)]">Быстрый расчёт стоимости полиса для выбранного автомобиля.</p>
            </div>
            <img src="/avatars/manager-yellow.webp" alt="" className="pointer-events-none absolute bottom-0 right-3 h-[162px] w-[145px] object-contain xl:h-[170px] xl:w-[152px]" aria-hidden="true" />
          </article>
        </section>
        <CurrencyRatesStrip rates={rates} variant="desktop" className="hidden lg:block" />
      </div>'''
text = text[:start] + new_block + text[end:]

old_style = '@media(max-width:1023px){.ac-home-filter-drawer{padding:20px!important}'
new_style = '@media(max-width:1023px){.ac-home-page .ac-budget-select,.ac-home-page .ac-budget-select>div,.ac-home-page .ac-budget-select .ac-filter-control{width:100%!important;max-width:none!important;min-width:0!important}.ac-home-filter-drawer{padding:20px!important}'
if text.count(old_style) != 1:
    raise SystemExit(f"inline mobile style anchor count={text.count(old_style)}")
text = text.replace(old_style, new_style, 1)

for token in (
    'ac-budget-select w-full min-w-0 max-w-none',
    'mt-4 hidden gap-4 lg:grid',
    '/avatars/manager-green.webp',
    '/avatars/manager-yellow.webp',
):
    if token not in text:
        raise SystemExit(f"missing required token: {token}")

if '>Автокредит</span>' in text or '>ОСАГО</span>' in text:
    raise SystemExit("desktop finance chip markup remained")

path.write_text(text)
