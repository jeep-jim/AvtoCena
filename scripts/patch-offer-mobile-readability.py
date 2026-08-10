from pathlib import Path

# presentation.ts
p = Path('apps/web/lib/catalog/presentation.ts')
s = p.read_text()
s = s.replace(
'''  text = text\n    .replace(/[가-힣]+/g, " ")\n    .replace(/([0-9]{4})款/g, "$1 ")''',
'''  text = text\n    .replace(/[가-힣\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]+/gu, " ")\n    .replace(/([0-9]{4})款/g, "$1 ")'''
)
s = s.replace(
'''  if (/cvt|无级变速|вариатор/.test(raw)) return "вариатор";\n  if (/robot|dct|dsg|双离合|робот/.test(raw)) return label("робот");''',
'''  if (/电动车?单速变速箱|电动汽车单速变速箱|单速变速箱|固定齿比|固定传动比/.test(raw)) return "Одноступенчатый редуктор";\n  if (/电子无级变速|e[- ]?cvt/.test(raw)) return "вариатор (e-CVT)";\n  if (/cvt|无级变速|вариатор/.test(raw)) return "вариатор";\n  if (/robot|dct|dsg|双离合|робот/.test(raw)) return label("робот");'''
)
s = s.replace('return cleaned || "Китайский бренд";', 'return cleaned || "Марка уточняется";')
s = s.replace('return cleaned || "модель";', 'return cleaned || "Модель уточняется";')
p.write_text(s)

# power-display.ts: never expose peak/preview power as 30-minute power.
p = Path('apps/web/lib/catalog/power-display.ts')
s = p.read_text()
old = '''  const kind = String(offer.powertrainKind || "").toLowerCase();\n  const customsPower = positive(offer.calculationSnapshot?.customs?.utilizationPowerKw);\n  const snapshotPreviewPower = positive(offer.calculationSnapshot?.utilizationPowerPreviewKw);\n  const storedUtilizationPower = positive(offer.utilizationPowerKw);\n  const peakPowerKw = positive(offer.powerKw)\n    || (positive(offer.powerHp) ? Math.round((Number(offer.powerHp) / 1.35962) * 100) / 100 : undefined);\n  const legacyEstimate = isElectricOrHybrid(offer)\n    ? storedUtilizationPower || snapshotPreviewPower || peakPowerKw\n    : undefined;\n  const certifiedMissing = Boolean(offer.calculationSnapshot?.certified30MinutePowerMissing);\n  const thirtyMinutePowerKw = summedMotors\n    || explicitThirtyMinute\n    || (["electric", "series_hybrid"].includes(kind) ? customsPower : undefined)\n    || legacyEstimate;\n\n  if (!thirtyMinutePowerKw) return null;\n\n  const exactAvailable = Boolean(summedMotors || explicitThirtyMinute);\n  const estimated = !exactAvailable && (certifiedMissing || Boolean(legacyEstimate));\n  const utilizationPowerKw = storedUtilizationPower || customsPower || snapshotPreviewPower || (estimated ? thirtyMinutePowerKw : undefined);'''
new = '''  const customsPower = positive(offer.calculationSnapshot?.customs?.utilizationPowerKw);\n  const snapshotPreviewPower = positive(offer.calculationSnapshot?.utilizationPowerPreviewKw);\n  const storedUtilizationPower = positive(offer.utilizationPowerKw);\n  // Public 30-minute power is shown ONLY when the exact 30-minute value exists.\n  // Peak motor power, hp->kW conversion and preliminary utilization previews must never\n  // masquerade as 30-minute power. Preliminary cards simply omit this tile.\n  const thirtyMinutePowerKw = summedMotors || explicitThirtyMinute;\n\n  if (!thirtyMinutePowerKw) return null;\n\n  const estimated = false;\n  const utilizationPowerKw = storedUtilizationPower || customsPower || snapshotPreviewPower;'''
if old not in s:
    raise SystemExit('power-display block not found')
s = s.replace(old, new, 1)
s = s.replace('''    thirtyMinuteLabel: estimated\n      ? `${formatKw(thirtyMinutePowerKw)} кВт`\n      : `30 мин: ${motorEquation}`,''', '''    thirtyMinuteLabel: `30 мин: ${motorEquation}`,''')
s = s.replace('''    sourceLabel: estimated\n      ? "Для предварительного расчёта использована доступная мощность электромотора. Точная 30-минутная мощность будет подтверждена по документам автомобиля."\n      : motorPowersKw.length > 1\n        ? "Сумма максимальной 30-минутной мощности тяговых электромоторов"\n        : "Максимальная 30-минутная мощность тягового электромотора",''', '''    sourceLabel: motorPowersKw.length > 1\n      ? "Сумма максимальной 30-минутной мощности тяговых электромоторов"\n      : "Максимальная 30-минутная мощность тягового электромотора",''')
p.write_text(s)

# Offer page UI.
p = Path('apps/web/app/(public)/cars/offer/[id]/page.tsx')
s = p.read_text()
s = s.replace(
'''function knownValue(value: unknown) {\n  const normalized = sentence(value);\n  return normalized && !/уточняется|не указан|unknown|неизвест/i.test(normalized) ? normalized : "";\n}''',
'''function knownValue(value: unknown) {\n  const normalized = sentence(value);\n  if (!normalized || /уточняется|не указан|unknown|неизвест/i.test(normalized)) return "";\n  // Never leak unresolved Chinese/Japanese/Korean source text into public specs.\n  if (/[가-힣\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]/u.test(normalized)) return "";\n  return normalized;\n}'''
)
s = s.replace(
'''    {info ? <details className="group relative z-30 ml-auto shrink-0">\n      <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-white/12 bg-white/10 text-xs font-black text-[var(--ac-text)] shadow-[inset_0_1px_0_rgba(255,255,255,.12)] backdrop-blur-md transition hover:bg-white/15 [&::-webkit-details-marker]:hidden" aria-label={`Что означает ${label}`}>?</summary>\n      <div className="absolute right-0 top-9 z-50 w-[min(280px,75vw)] rounded-2xl border border-white/10 bg-[var(--ac-surface)] p-4 text-left text-xs font-semibold leading-5 text-[var(--ac-muted)] shadow-2xl">{info}</div>\n    </details> : null}''',
'''    {info ? <details className="group static z-30 ml-auto shrink-0">\n      <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-white/12 bg-white/10 text-xs font-black text-[var(--ac-text)] shadow-[inset_0_1px_0_rgba(255,255,255,.12)] backdrop-blur-md transition hover:bg-white/15 [&::-webkit-details-marker]:hidden" aria-label={`Что означает ${label}`}>?</summary>\n      <div className="ac-spec-info-popover absolute right-0 top-[calc(100%+.5rem)] z-50 w-[min(290px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[var(--ac-surface)] p-4 text-left text-xs font-semibold leading-5 text-[var(--ac-muted)] shadow-2xl">{info}</div>\n    </details> : null}'''
)
s = s.replace(
'''  const powerValue = o.powerHp ? `${o.powerHp} л.с.` : o.powerKw ? `${o.powerKw} кВт` : "";''',
'''  const powerValue = o.powerHp ? `${o.powerHp} л.с.` : o.powerKw ? `${o.powerKw} кВт` : "";\n  const mileageKm = Number(o.mileageKm || 0);\n  const mileageTile = mileageKm > 0 ? { label: "Пробег", value: `${money(mileageKm)} км`, icon: "mileage" as const } : null;'''
)
s = s.replace('o.mileageKm ? { label: "Пробег", value: `${money(o.mileageKm)} км`, icon: "mileage" as const } : null,', 'mileageTile,')
s = s.replace('o.mileageKm ? { label: "Пробег", value: `${money(o.mileageKm)} км`, icon: "mileage" as const } : null,', 'mileageTile,')
s = s.replace(
'''          {String(raw?.calculationStatus || "") === "preliminary_power_pending" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold leading-5 text-amber-200">Предварительный расчёт: платежи, зависящие от неподтверждённой мощности электромотора/гибридной системы, пока не включены. Финальную стоимость подтвердит менеджер.</p> : null}''',
'''          {String(raw?.calculationStatus || "") === "preliminary_power_pending" ? <p className="ac-preliminary-notice mt-2 rounded-2xl border border-amber-300/15 bg-amber-400/10 p-3 text-sm font-bold leading-5 text-amber-200">Предварительный расчёт: платежи, зависящие от неподтверждённой мощности электромотора/гибридной системы, пока не включены. Финальную стоимость подтвердит менеджер.</p> : null}'''
)
s = s.replace(
'''            <div className="grid min-w-0 grid-cols-2 gap-2.5">{specs.map((spec) => <SpecTile key={spec.label} {...spec} />)}</div>''',
'''            <div className="ac-offer-spec-grid grid min-w-0 grid-flow-row-dense grid-cols-2 gap-2.5">{specs.map((spec) => <SpecTile key={spec.label} {...spec} />)}</div>'''
)
needle = '''      html[data-theme="light"] .ac-offer-page .ac-offer-form .soft-input::placeholder{color:#737d8e!important;opacity:1!important}\n'''
addition = '''      html[data-theme="light"] .ac-offer-page .ac-preliminary-notice{background:#fff2cc!important;border-color:#e9c56b!important;color:#704500!important;box-shadow:0 8px 24px rgba(111,75,0,.08)!important}\n      html[data-theme="light"] .ac-offer-page .ac-spec-info-popover{background:#fff!important;border-color:rgba(30,36,48,.14)!important;color:#394150!important}\n      .ac-offer-page .ac-offer-spec-grid>.ac-offer-spec-tile:last-child:nth-child(odd){grid-column:span 2}\n'''
if addition not in s:
    if needle not in s:
        raise SystemExit('offer page CSS marker not found')
    s = s.replace(needle, needle + addition, 1)
s = s.replace(
'''      @media (max-width:639px){.ac-offer-page .ac-public-header{z-index:1000!important;isolation:isolate!important;background:var(--ac-surface)!important}.ac-offer-page .ac-price-trend-arrow{z-index:0!important}.ac-offer-page .ac-price-trend-popover{z-index:40!important}.ac-offer-page button[aria-label="Открыть фотографии автомобиля"]{height:300px!important}.ac-offer-page .ac-vehicle-thumbnails{margin-top:10px!important}}''',
'''      @media (max-width:639px){.ac-offer-page .ac-public-header{z-index:1000!important;isolation:isolate!important;background:var(--ac-surface)!important}.ac-offer-page .ac-price-trend-arrow{z-index:0!important}.ac-offer-page .ac-price-trend-popover{z-index:40!important}.ac-offer-page button[aria-label="Открыть фотографии автомобиля"]{height:300px!important}.ac-offer-page .ac-vehicle-thumbnails{margin-top:10px!important}.ac-offer-page .ac-offer-spec-tile:nth-child(odd) .ac-spec-info-popover{left:0!important;right:auto!important}.ac-offer-page .ac-offer-spec-tile:nth-child(even) .ac-spec-info-popover{left:auto!important;right:0!important}}'''
)
p.write_text(s)

print('offer_mobile_readability_patch_ok')
