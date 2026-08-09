from pathlib import Path


def patch_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, got {count}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


market = "scripts/catalog-live-recovery-market.mjs"

patch_once(
    market,
    'const adapterMap = new Map(catalogImportSources.map((source) => [source.sourceId, source]));',
    r'''const AUTO_GEORGIA_DETAIL_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
function autoGeorgiaPlainText(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}
function autoGeorgiaCompact(value) { return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, ""); }
function autoGeorgiaInteger(value) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function autoGeorgiaIdentityMatches(markup, offer) {
  const text = autoGeorgiaCompact(autoGeorgiaPlainText(markup).slice(0, 30_000));
  const make = autoGeorgiaCompact(offer?.make);
  const tokens = String(offer?.model || "").split(/\s+/).map(autoGeorgiaCompact).filter((token) => token.length >= 2).slice(0, 3);
  return Boolean(make && text.includes(make) && tokens.some((token) => text.includes(token)));
}
async function enrichAutoGeorgiaExactSpecs(offer) {
  if (String(offer?.sourceId || "") !== "auto_georgia_open") return offer;
  const sourceUrl = String(offer?.operational?.sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) return offer;
  const response = await fetch(sourceUrl, { headers: { ...AUTO_GEORGIA_DETAIL_HEADERS, referer: sourceUrl }, redirect: "follow" });
  const markup = await response.text();
  if (!response.ok) throw new Error(`auto_georgia_detail_http_${response.status}`);
  if (/captcha|cloudflare|access denied|request blocked|verify you are human|forbidden/i.test(markup.slice(0, 3_000))) throw new Error(`auto_georgia_detail_blocked_${response.status}`);
  if (!autoGeorgiaIdentityMatches(markup, offer)) throw new Error(`auto_georgia_detail_identity_mismatch:${offer?.sourceOfferId || ""}`);
  const sourceText = autoGeorgiaPlainText(markup);
  const cc = autoGeorgiaInteger(sourceText.match(/([0-9][0-9\s,.']{2,5})\s*(?:cc|cm3|cm³)/i)?.[1]);
  const liters = Number(sourceText.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|liter|litre)\b/i)?.[1]?.replace(",", ".") || 0);
  const hp = autoGeorgiaInteger(sourceText.match(/\b([0-9]{2,4})\s*(?:HP|PS|horsepower)\b/i)?.[1]);
  if (!(Number(offer.engineCc || 0) > 0)) offer.engineCc = cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : offer.engineCc);
  if (!(Number(offer.powerHp || 0) > 0) && hp) {
    offer.powerHp = hp;
    offer.powerKw ||= Math.round((hp / 1.359621617) * 10) / 10;
  }
  offer.operational = {
    ...(offer.operational || {}),
    raw: {
      ...(offer.operational?.raw || {}),
      detailIdentityVerified: true,
      recoveryExactSpecSource: sourceUrl,
      recoveryExactSourceEngineCc: Number(offer.engineCc || 0) || null,
      recoveryExactSourcePowerHp: Number(offer.powerHp || 0) || null,
    },
  };
  return offer;
}
function thirtyMinutePower(offer) {
  const single = Number(offer?.power30MinKw || 0);
  if (single > 0) return single;
  return Array.isArray(offer?.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
    : 0;
}
function calculationPendingDiagnostic(offer) {
  const kind = String(offer?.powertrainKind || "unknown");
  const utilization = Number(offer?.utilizationPowerKw || 0);
  const motor30 = thirtyMinutePower(offer);
  const ice = Number(offer?.icePowerKw || 0);
  const engineCc = Number(offer?.engineCc || 0);
  const powerHp = Number(offer?.powerHp || 0);
  const electrified = ["electric", "series_hybrid", "other_hybrid"].includes(kind);
  let reason = "exact_calculation_incomplete";
  if (electrified && utilization <= 0 && motor30 <= 0) reason = "missing_certified_utilization_or_30min_power";
  else if (kind === "other_hybrid" && utilization <= 0 && ice <= 0) reason = "missing_ice_power_kw";
  else if (!electrified && engineCc <= 0) reason = "missing_engine_cc";
  else if (!electrified && powerHp <= 0) reason = "missing_power_hp";
  else if (String(offer?.calculationSnapshot?.customs?.status || "") !== "ready") reason = `customs_${String(offer?.calculationSnapshot?.customs?.status || "missing")}`;
  return {
    make: String(offer?.make || ""), model: String(offer?.model || ""), trim: String(offer?.trim || ""), year: Number(offer?.year || 0),
    powertrainKind: kind, sourceId: String(offer?.sourceId || ""), sourceOfferId: String(offer?.sourceOfferId || ""),
    sourceUrl: String(offer?.operational?.sourceUrl || ""), reason, engineCc: engineCc || null, powerHp: powerHp || null,
    utilizationPowerKw: utilization || null, power30MinKw: motor30 || null, icePowerKw: ice || null,
  };
}

const adapterMap = new Map(catalogImportSources.map((source) => [source.sourceId, source]));'''
)

patch_once(
    market,
    '    catch (error) { errors.push({ stage: "page", cursor, error: errorText(error).slice(0, 800) }); stopReason = "source_error"; break; }',
    '''    catch (error) {
      const pageError = errorText(error);
      if (source.sourceId === "auto_georgia_open" && pages > 0 && /auto_georgia_strict_parsed_zero_200_\\d+/i.test(pageError)) {
        finished = true;
        stopReason = "source_exhausted";
        break;
      }
      errors.push({ stage: "page", cursor, error: pageError.slice(0, 800) });
      stopReason = "source_error";
      break;
    }'''
)

patch_once(
    market,
    '      offer = normalizeVehicleOfferSpecs(await safeVariantEnrich(offer));\n',
    '''      if (source.sourceId === "auto_georgia_open" && (!(Number(offer.engineCc || 0) > 0) || !(Number(offer.powerHp || 0) > 0))) {
        try { offer = normalizeVehicleOfferSpecs(await retry(`${source.sourceId}_detail_specs`, () => enrichAutoGeorgiaExactSpecs(offer))); }
        catch (error) { errors.push({ stage: "detail_specs", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) }); }
      }
      offer = normalizeVehicleOfferSpecs(await safeVariantEnrich(offer));
'''
)

patch_once(market, 'const reports = [];\n', 'const reports = [];\nconst pendingElectrifiedModels = new Map();\nconst pendingCombustionModels = new Map();\n')

patch_once(
    market,
    '      if (!exactCalculation(calculated)) { reject(rejections, "calculation_pending"); return null; }',
    '''      if (!exactCalculation(calculated)) {
        const diagnostic = calculationPendingDiagnostic(calculated);
        const diagnosticKey = `${diagnostic.make}|${diagnostic.model}|${diagnostic.trim}|${diagnostic.year}|${diagnostic.powertrainKind}|${diagnostic.reason}`.toLocaleLowerCase("en-US");
        const targetDiagnostics = ["electric", "series_hybrid", "other_hybrid"].includes(diagnostic.powertrainKind) ? pendingElectrifiedModels : pendingCombustionModels;
        if (targetDiagnostics.size < 500 && !targetDiagnostics.has(diagnosticKey)) targetDiagnostics.set(diagnosticKey, diagnostic);
        reject(rejections, "calculation_pending");
        return null;
      }'''
)

patch_once(
    market,
    '  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,\n',
    '  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,\n  calculationPendingElectrifiedModels: [...pendingElectrifiedModels.values()].slice(0, 250),\n  calculationPendingCombustionModels: [...pendingCombustionModels.values()].slice(0, 100),\n'
)

spec = "apps/web/lib/catalog/spec-normalization.ts"
patch_once(
    spec,
    '  const primary = primaryText(offer);\n  const full = allText(offer);\n  const engineCc = reasonable(offer.engineCc, 300, 10_000)\n    || structuredEngineCc(offer)\n    || inferEngineCc(primary)\n    || inferEngineCc(full);',
    '''  const primary = primaryText(offer);
  const full = allText(offer);
  const knownPureElectricModel = String(offer.make || "").trim().toLowerCase() === "audi"
    && /\\be[- ]?tron\\b/i.test(`${offer.model || ""} ${offer.trim || ""}`);
  const parsedEngineCc = reasonable(offer.engineCc, 300, 10_000)
    || structuredEngineCc(offer)
    || inferEngineCc(primary)
    || inferEngineCc(full);
  const engineCc = knownPureElectricModel ? undefined : parsedEngineCc;'''
)
patch_once(
    spec,
    '  const strongElectric = /electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기/.test(primary);',
    '  const strongElectric = knownPureElectricModel || /electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기/.test(primary);'
)
patch_once(
    spec,
    '  const primaryPowertrainKind = inferPowertrainKind(primary, engineCc);',
    '  const primaryPowertrainKind = knownPureElectricModel ? "electric" : inferPowertrainKind(primary, engineCc);'
)
patch_once(
    spec,
    '  const explicitPowertrainKind = offer.powertrainKind && offer.powertrainKind !== "unknown" ? offer.powertrainKind : undefined;',
    '  if (knownPureElectricModel) fuel = "electric";\n\n  const explicitPowertrainKind = offer.powertrainKind && offer.powertrainKind !== "unknown" ? offer.powertrainKind : undefined;'
)
