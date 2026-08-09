from pathlib import Path

p = Path("scripts/catalog-live-recovery-market.mjs")
text = p.read_text()
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
  // AUTO.GE exact detail pages expose displacement as a labelled value such as
  // "Engine 1.5" rather than "1.5 L". Read only that exact source label;
  // never infer displacement from model names or unrelated numbers.
  const engineLabelLiters = Number(sourceText.match(/\\bEngine\\s+([0-9]+(?:[.,][0-9]+)?)\\b/i)?.[1]?.replace(",", ".") || 0);
  const exactEngineCc = cc
    || (engineLabelLiters >= 0.3 && engineLabelLiters <= 15 ? Math.round(engineLabelLiters * 1_000) : undefined)
    || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined);
  const hp = autoGeorgiaInteger(sourceText.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|horsepower)\\b/i)?.[1]);
  const exactFuel = sourceText.match(/\\bFuel\\s+(Hybrid Engine|ELECTRIC|Electric|Gasoline|Petrol|Diesel|COMPRESSED NATURAL GAS|CNG|LPG|Gas|Other)\\b/i)?.[1];
  const exactTransmission = sourceText.match(/\\bTransmission\\s+(Automatic|Manual|Automanual|CVT|Variator|Robot)\\b/i)?.[1];
  const exactDrive = sourceText.match(/\\bDrive Train\\s+(Front-wheel Drive|Rear-wheel Drive|All-wheel Drive|4WD|AWD|2WD)\\b/i)?.[1];
  if (!(Number(offer.engineCc || 0) > 0) && exactEngineCc) offer.engineCc = exactEngineCc;
  if (exactFuel) offer.fuel = exactFuel;
  if (!offer.transmission && exactTransmission) offer.transmission = exactTransmission;
  if (!offer.drive && exactDrive) offer.drive = exactDrive;
  if (!(Number(offer.powerHp || 0) > 0) && hp) {
    offer.powerHp = hp;
    offer.powerKw ||= Math.round((hp / 1.359621617) * 10) / 10;
  }
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one AUTO.GE detail-spec anchor, got {count}")
p.write_text(text.replace(old, new, 1))
