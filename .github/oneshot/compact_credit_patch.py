from pathlib import Path

path = Path("apps/web/components/catalog/OfferContactActions.tsx")
text = path.read_text(encoding="utf-8")

# 1) Replace the bulky desktop credit mock with a compact placeholder.
start = text.index("function CreditCalculatorMockup() {")
end = text.index("function ActionButtons", start)
compact = '''function CreditCalculatorMockup() {
  return (
    <section className="ac-credit-calculator-mock rounded-[1.35rem] border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4" aria-label="Кредитный калькулятор">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-500">Финансирование</div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-black tracking-[-0.035em] text-[var(--ac-text)]">Кредитный калькулятор</h2>
            <span className="text-xs font-semibold text-[var(--ac-muted)]">Сюда подключим форму партнёра.</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-500">Скоро</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5">
          <div className="text-[10px] font-bold text-[var(--ac-muted)]">Стоимость авто</div>
          <div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">из карточки</div>
        </div>
        <div className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5">
          <div className="text-[10px] font-bold text-[var(--ac-muted)]">Первый взнос</div>
          <div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">0 ₽</div>
        </div>
        <div className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5">
          <div className="text-[10px] font-bold text-[var(--ac-muted)]">Срок</div>
          <div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">60 мес</div>
        </div>
      </div>

      <div className="mt-2 flex items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl bg-red-500/10 px-3 py-2.5">
          <span className="text-xs font-black text-[var(--ac-text)]">Ежемесячный платёж</span>
          <span className="text-lg font-black text-red-500">— ₽</span>
        </div>
        <button type="button" aria-disabled="true" className="min-w-[176px] cursor-default rounded-xl bg-[#111318] px-4 py-2.5 text-xs font-black text-white">Подобрать кредит</button>
      </div>
    </section>
  );
}

'''
text = text[:start] + compact + text[end:]

# 2) Clean up all dynamically created hosts between route changes.
old_cleanup = '    document.querySelectorAll<HTMLElement>("[data-offer-actions-host]").forEach((node) => node.remove());'
new_cleanup = '    document.querySelectorAll<HTMLElement>("[data-offer-actions-host], [data-offer-credit-host], [data-offer-credit-mobile-host]").forEach((node) => node.remove());'
if old_cleanup in text:
    text = text.replace(old_cleanup, new_cleanup, 1)
elif new_cleanup not in text:
    raise RuntimeError("host cleanup anchor changed")

# 3) Add a mobile-only credit button host inside the price breakdown details.
old_vars = '    let creditHost: HTMLElement | null = null;'
new_vars = '    let creditHost: HTMLElement | null = null;\n    let mobileCreditHost: HTMLElement | null = null;'
if new_vars not in text:
    if old_vars not in text:
        raise RuntimeError("credit host vars anchor changed")
    text = text.replace(old_vars, new_vars, 1)

old_lookup = '      const desktopSlot = page?.querySelector<HTMLElement>("[data-offer-desktop-actions-slot]");'
new_lookup = old_lookup + '\n      const breakdown = page?.querySelector<HTMLElement>(".ac-offer-breakdown");'
if new_lookup not in text:
    if old_lookup not in text:
        raise RuntimeError("breakdown lookup anchor changed")
    text = text.replace(old_lookup, new_lookup, 1)

host_marker = '      creditHost.dataset.offerCreditHost = "true";\n      mediaColumn.appendChild(creditHost);'
mobile_block = '''

      if (breakdown) {
        mobileCreditHost = document.createElement("div");
        mobileCreditHost.dataset.offerCreditMobileHost = "true";
        const mobileCreditButton = document.createElement("button");
        mobileCreditButton.type = "button";
        mobileCreditButton.className = "ac-mobile-credit-button";
        mobileCreditButton.textContent = "Кредитный калькулятор";
        mobileCreditHost.appendChild(mobileCreditButton);
        breakdown.appendChild(mobileCreditHost);
      }'''
if 'mobileCreditHost.dataset.offerCreditMobileHost = "true";' not in text:
    if host_marker not in text:
        raise RuntimeError("credit host mount anchor changed")
    text = text.replace(host_marker, host_marker + mobile_block, 1)

old_remove = '      creditHost?.remove();'
new_remove = '      creditHost?.remove();\n      mobileCreditHost?.remove();'
if new_remove not in text:
    if old_remove not in text:
        raise RuntimeError("credit cleanup anchor changed")
    text = text.replace(old_remove, new_remove, 1)

# 4) Add authoritative responsive overrides: no calculator body on mobile,
#    only the black button at the bottom of an opened price structure.
css_marker = '''        .ac-offer-page > section > section {
          border-top: 1px solid rgba(255,255,255,.085) !important;'''
responsive_css = '''        .ac-offer-page [data-offer-credit-host],
        .ac-offer-page [data-offer-credit-mobile-host] {
          display: none !important;
        }
        @media (max-width: 1279px) {
          .ac-offer-page [data-offer-credit-mobile-host] {
            display: block !important;
            padding: 0 1rem 1rem;
          }
          .ac-mobile-credit-button {
            display: flex;
            width: 100%;
            height: 46px;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(255,255,255,.08);
            border-radius: .9rem;
            background: #0b0d11;
            color: #fff !important;
            font-size: 13px;
            font-weight: 900;
            line-height: 1;
            box-shadow: 0 8px 18px rgba(0,0,0,.12);
          }
          html[data-theme="light"] .ac-mobile-credit-button {
            border-color: #0b0d11;
            background: #0b0d11;
            color: #fff !important;
          }
        }
        @media (min-width: 1280px) {
          .ac-offer-page:has(.ac-offer-breakdown[open]) [data-offer-credit-host] {
            display: block !important;
            margin-top: 1rem;
          }
          .ac-credit-calculator-mock {
            box-shadow: 0 12px 28px rgba(0,0,0,.10) !important;
          }
          html[data-theme="light"] .ac-credit-calculator-mock {
            box-shadow: 0 12px 26px rgba(38,43,57,.07) !important;
          }
        }
'''
if '        .ac-mobile-credit-button {' not in text:
    if css_marker not in text:
        raise RuntimeError("responsive CSS anchor changed")
    text = text.replace(css_marker, responsive_css + css_marker, 1)

path.write_text(text, encoding="utf-8")
