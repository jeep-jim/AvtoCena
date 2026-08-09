from pathlib import Path

p = Path("apps/web/lib/catalog/spec-normalization.ts")
text = p.read_text()

old_hybrid = '  if (/plug[ -]?in|\\bphev\\b|parallel[ -]?hybrid|power[ -]?split|mixed[ -]?hybrid|гибрид|hybrid|混合动力|하이브리드/.test(text)) return "other_hybrid";'
new_hybrid = '  if (/plug[ -]?in|\\b(?:phev|hev|mhev)\\b|parallel[ -]?hybrid|power[ -]?split|mixed[ -]?hybrid|гибрид|hybrid|混合动力|하이브리드/.test(text)) return "other_hybrid";'
if text.count(old_hybrid) != 1:
    raise SystemExit(f"hybrid anchor count={text.count(old_hybrid)}")
text = text.replace(old_hybrid, new_hybrid, 1)

old_ev = '''  const knownPureElectricModel = String(offer.make || "").trim().toLowerCase() === "audi"
    && /\\be[- ]?tron\\b/i.test(`${offer.model || ""} ${offer.trim || ""}`);'''
new_ev = '''  const normalizedMake = String(offer.make || "").trim().toLowerCase();
  const normalizedModelTrim = `${offer.model || ""} ${offer.trim || ""}`.trim();
  // Only source-exact, manufacturer-defined BEV model names are allowed here.
  // This improves powertrain classification but does not supply customs power.
  const knownPureElectricModel = (normalizedMake === "audi" && /\\be[- ]?tron\\b/i.test(normalizedModelTrim))
    || /\\b(?:ev3|ev4|ev5|ev6|ev9)\\b/i.test(normalizedModelTrim)
    || /아이오닉\\s*[56]/i.test(normalizedModelTrim)
    || /(?:코나|캐스퍼).*?(?:electric|일렉트릭)/i.test(normalizedModelTrim)
    || /(?:레이|니로|쏘울(?:\\s+부스터)?).*?\\bev\\b/i.test(normalizedModelTrim)
    || (/tesla|테슬라/i.test(normalizedMake) && /\\bmodel\\s*[3sxy]\\b|cybertruck/i.test(normalizedModelTrim))
    || (/chevrolet|쉐보레/i.test(normalizedMake) && /\\bbolt\\s*(?:ev|euv)\\b/i.test(normalizedModelTrim))
    || (/nissan|닛산/i.test(normalizedMake) && /\\b(?:leaf|ariya)\\b|리프|아리야/i.test(normalizedModelTrim))
    || (/peugeot|푸조/i.test(normalizedMake) && /\\be[- ]?(?:208|2008)\\b/i.test(normalizedModelTrim));'''
if text.count(old_ev) != 1:
    raise SystemExit(f"EV anchor count={text.count(old_ev)}")
text = text.replace(old_ev, new_ev, 1)

p.write_text(text)
