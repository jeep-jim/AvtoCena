from pathlib import Path

path = Path("scripts/catalog-live-recovery-market.mjs")
text = path.read_text()
old = '''  const sourceText = autoGeorgiaPlainText(markup);
  const cc = autoGeorgiaInteger(sourceText.match(/([0-9][0-9\\s,.']{2,5})\\s*(?:cc|cm3|cm³)/i)?.[1]);
  const liters = Number(sourceText.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);
  const hp = autoGeorgiaInteger(sourceText.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|horsepower)\\b/i)?.[1]);
  if (!(Number(offer.engineCc || 0) > 0)) offer.engineCc = cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : offer.engineCc);
  if (!(Number(offer.powerHp || 0) > 0) && hp) {
    offer.powerHp = hp;
    offer.powerKw ||= Math.round((hp / 1.359621617) * 10) / 10;
  }
'''
new = '''  const sourceText = autoGeorgiaPlainText(markup);
  const cc = autoGeorgiaInteger(sourceText.match(/([0-9][0-9\\s,.']{2,5})\\s*(?:cc|cm3|cm³)/i)?.[1]);
  const liters = Number(sourceText.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);
  const engineLabel = Number(sourceText.match(/\\bEngine\\s+([0-9]+(?:[.,][0-9]+)?)\\b/i)?.[1]?.replace(",", ".") || 0);
  const labeledEngineCc = engineLabel >= 0.3 && engineLabel <= 15 ? Math.round(engineLabel * 1_000) : undefined;
  const hp = autoGeorgiaInteger(sourceText.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|horsepower)\\b/i)?.[1]);
  const exactFuel = sourceText.match(/\\bFuel\\s+(Plug-in Hybrid|Hybrid Engine|ELECTRIC|Electric|Gasoline|Petrol|Diesel|LPG|CNG|Gas)\\b/i)?.[1];
  if (!(Number(offer.engineCc || 0) > 0)) offer.engineCc = cc || labeledEngineCc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : offer.engineCc);
  if (exactFuel) offer.fuel = exactFuel;
  if (!(Number(offer.powerHp || 0) > 0) && hp) {
    offer.powerHp = hp;
    offer.powerKw ||= Math.round((hp / 1.359621617) * 10) / 10;
  }
'''
if text.count(old) != 1:
    raise SystemExit(f"expected exactly one AUTO.GE detail-spec anchor, got {text.count(old)}")
text = text.replace(old, new, 1)
old_raw = '''      recoveryExactSpecSource: sourceUrl,
      recoveryExactSourceEngineCc: Number(offer.engineCc || 0) || null,
      recoveryExactSourcePowerHp: Number(offer.powerHp || 0) || null,
'''
new_raw = '''      recoveryExactSpecSource: sourceUrl,
      recoveryExactSourceEngineLabel: engineLabel > 0 ? engineLabel : null,
      recoveryExactSourceFuel: exactFuel || null,
      recoveryExactSourceEngineCc: Number(offer.engineCc || 0) || null,
      recoveryExactSourcePowerHp: Number(offer.powerHp || 0) || null,
'''
if text.count(old_raw) != 1:
    raise SystemExit(f"expected exactly one AUTO.GE raw diagnostic anchor, got {text.count(old_raw)}")
path.write_text(text.replace(old_raw, new_raw, 1))
