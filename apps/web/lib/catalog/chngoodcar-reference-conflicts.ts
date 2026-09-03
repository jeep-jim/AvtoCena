export type GoodCarVerifiedReferenceConflict = {
  field: "fuel";
  sourceValue: string;
  verifiedValue: string;
  reason: string;
  referenceSource: string;
  referenceUrl: string;
};

type GoodCarReferenceCandidate = {
  sourceTitle?: unknown;
  engineCc?: unknown;
  powerKw?: unknown;
  fuel?: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function near(value: unknown, expected: number, tolerance: number) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number - expected) <= tolerance;
}

/**
 * Narrow, evidence-backed source-conflict ledger. These rules only reject a
 * source row; they never overwrite Good Car with a reference value.
 *
 * A rule is added only after an independent exact-version reference proves the
 * same identity/engine/power combination and the Good Car named field conflicts.
 */
export function goodCarVerifiedReferenceConflict(input: GoodCarReferenceCandidate): GoodCarVerifiedReferenceConflict | null {
  const title = clean(input.sourceTitle);
  const fuel = clean(input.fuel);

  // Good Car offer 1869632025078525952 labels the exact 2016 Prado 3.5 AT TX
  // as diesel while also exposing 3.5L / 206 kW. Autohome exact spec 23948
  // identifies the same 2016 3.5L AT TX as gasoline, 206 kW. Fail closed; do
  // not rewrite the source fuel automatically.
  if (/^丰田\s*普拉多\s+2016\s*款\s+3\.5L\s+自动TX(?:\s|$)/i.test(title)
    && near(input.engineCc, 3500, 100)
    && near(input.powerKw, 206, 1)
    && fuel === "柴油") {
    return {
      field: "fuel",
      sourceValue: fuel,
      verifiedValue: "汽油",
      reason: "goodcar_named_fuel_conflicts_with_exact_2016_prado_3_5_tx_reference",
      referenceSource: "Autohome exact spec 23948",
      referenceUrl: "https://www.autohome.com.cn/spec/23948/",
    };
  }

  return null;
}
