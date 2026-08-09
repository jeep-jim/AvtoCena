from pathlib import Path

p = Path("scripts/catalog-live-recovery-market.mjs")
text = p.read_text()

old = '''  const rejections = {};
  const errors = [];
  const pendingElectrified = new Map();
  const cursors = new Set();'''
new = '''  const rejections = {};
  const errors = [];
  const pendingElectrified = new Map();
  const calculationPendingModels = new Map();
  const cursors = new Set();'''
if text.count(old) != 1:
    raise SystemExit("pending diagnostics source anchor mismatch")
text = text.replace(old, new, 1)

old = '''      if (!exactCalculation(calculated)) {
        const kind = String(calculated?.powertrainKind || "");
        const fuel = String(calculated?.fuel || "").toLowerCase();'''
new = '''      if (!exactCalculation(calculated)) {
        const kind = String(calculated?.powertrainKind || "");
        const fuel = String(calculated?.fuel || "").toLowerCase();
        const pendingKey = `${String(calculated?.make || "").trim()}|${String(calculated?.model || "").trim()}|${Number(calculated?.year || 0)}|${kind || fuel || "unknown"}`;
        const pendingRow = calculationPendingModels.get(pendingKey) || {
          make: calculated?.make || "",
          model: calculated?.model || "",
          year: Number(calculated?.year || 0),
          powertrainKind: kind || "unknown",
          fuel: calculated?.fuel || "",
          engineCc: Number(calculated?.engineCc || 0) || null,
          powerHp: Number(calculated?.powerHp || 0) || null,
          power30MinKw: Number(calculated?.power30MinKw || 0) || null,
          utilizationPowerKw: Number(calculated?.utilizationPowerKw || 0) || null,
          icePowerKw: Number(calculated?.icePowerKw || 0) || null,
          customsStatus: String(calculated?.calculationSnapshot?.customs?.status || ""),
          calculationStatus: String(calculated?.calculationStatus || ""),
          count: 0,
          missing: new Set(),
        };
        pendingRow.count += 1;
        if (!(Number(calculated?.engineCc || 0) > 0) && !["electric", "series_hybrid"].includes(kind)) pendingRow.missing.add("engineCc");
        if (!(Number(calculated?.powerHp || 0) > 0) && !["electric", "series_hybrid", "other_hybrid"].includes(kind)) pendingRow.missing.add("powerHp");
        if (["electric", "series_hybrid", "other_hybrid"].includes(kind)) {
          if (!(Number(calculated?.utilizationPowerKw || 0) > 0)) pendingRow.missing.add("utilizationPowerKw");
          const pendingMotor30 = Number(calculated?.power30MinKw || 0) || (Array.isArray(calculated?.power30MinKwByMotor) ? calculated.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) : 0);
          if (!(pendingMotor30 > 0)) pendingRow.missing.add("power30MinKw");
          if (kind === "other_hybrid" && !(Number(calculated?.icePowerKw || 0) > 0)) pendingRow.missing.add("icePowerKw");
        }
        if (String(calculated?.calculationSnapshot?.customs?.status || "") !== "ready") pendingRow.missing.add("customs_ready");
        calculationPendingModels.set(pendingKey, pendingRow);'''
if text.count(old) != 1:
    raise SystemExit("pending calculation anchor mismatch")
text = text.replace(old, new, 1)

old = '''    pendingElectrifiedModels: [...pendingElectrified.values()].map((row) => ({ ...row, missing: [...row.missing] })).sort((a, b) => b.count - a.count).slice(0, 100),
    errors: errors.slice(0, 100),'''
new = '''    pendingElectrifiedModels: [...pendingElectrified.values()].map((row) => ({ ...row, missing: [...row.missing] })).sort((a, b) => b.count - a.count).slice(0, 100),
    calculationPendingModels: [...calculationPendingModels.values()].map((row) => ({ ...row, missing: [...row.missing] })).sort((a, b) => b.count - a.count).slice(0, 100),
    errors: errors.slice(0, 100),'''
if text.count(old) != 1:
    raise SystemExit("source report anchor mismatch")
text = text.replace(old, new, 1)

old = '''  pendingElectrifiedModels: reports.flatMap((sourceReport) => sourceReport.pendingElectrifiedModels || []).sort((a, b) => b.count - a.count).slice(0, 200),
  sources: reports.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),'''
new = '''  pendingElectrifiedModels: reports.flatMap((sourceReport) => sourceReport.pendingElectrifiedModels || []).sort((a, b) => b.count - a.count).slice(0, 200),
  calculationPendingModels: reports.flatMap((sourceReport) => sourceReport.calculationPendingModels || []).sort((a, b) => b.count - a.count).slice(0, 200),
  sources: reports.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),'''
if text.count(old) != 1:
    raise SystemExit("top report anchor mismatch")
text = text.replace(old, new, 1)

p.write_text(text)
