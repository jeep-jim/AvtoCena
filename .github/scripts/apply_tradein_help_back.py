from pathlib import Path

path = Path('apps/web/components/home/HomePageClient.tsx')
s = path.read_text()
old = '{tradeInfoOpen ? <button type="button" onClick={() => setTradeInfoOpen(false)} className="flex h-full w-full items-center justify-center px-6 text-center text-[13px] font-bold leading-5 text-[var(--ac-text)]" aria-label="Вернуться к выбору бюджета"><span>Условия по трейд-ин уточняются индивидуально с менеджером дилера в вашем городе.</span></button> : <div className="grid h-full grid-cols-2 grid-rows-5 gap-1.5">'
new = '''{tradeInfoOpen ? <div className="relative h-full w-full">
        <button type="button" onClick={() => setTradeInfoOpen(false)} className="absolute left-1 top-1 z-10 px-2 py-1 text-[11px] font-black text-[var(--ac-muted)]" aria-label="Вернуться к выбору бюджета">← Назад</button>
        <div className="flex h-full w-full items-center justify-center px-6 text-center text-[13px] font-bold leading-5 text-[var(--ac-text)]"><span>Условия по трейд-ин уточняются индивидуально с менеджером дилера в вашем городе.</span></div>
      </div> : <div className="grid h-full grid-cols-2 grid-rows-5 gap-1.5">'''
if old not in s:
    raise SystemExit('target Trade-in info shell not found')
path.write_text(s.replace(old, new, 1))
