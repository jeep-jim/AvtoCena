export type GoodCarVerifiedReferenceConflict = {
  field: "fuel" | "bodyType";
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
  bodyType?: unknown;
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
  const bodyType = clean(input.bodyType);

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

  // Good Car sampled the exact Song MAX 2018 1.5T automatic connected flagship
  // 6-seat trim as SUV. Autohome exact spec 33704 identifies that trim as a
  // compact MPV. Reject the conflicting source body; never rewrite it to MPV.
  if (/^比亚迪\s+宋MAX\s+2018款\s+1\.5T\s+自动智联旗舰型\s+6座(?:\s|$)/i.test(title)
    && near(input.engineCc, 1500, 100)
    && near(input.powerKw, 113, 2)
    && bodyType === "SUV") {
    return {
      field: "bodyType",
      sourceValue: bodyType,
      verifiedValue: "MPV",
      reason: "goodcar_named_body_conflicts_with_exact_2018_songmax_flagship_6seat_reference",
      referenceSource: "Autohome exact spec 33704",
      referenceUrl: "https://car.autohome.com.cn/config/spec/33704.html",
    };
  }

  // Good Car sampled the exact 2012 Camry Zunrui 2.5HG luxury trim as gasoline.
  // Autohome exact spec 12931 and the model launch record identify this 2.5HG
  // Zunrui trim as petrol-electric hybrid. Reject; do not auto-convert fuel.
  if (/^丰田\s+凯美瑞\s+2012款\s+尊瑞\s+2\.5HG\s+豪华版(?:\s|$)/i.test(title)
    && near(input.engineCc, 2500, 100)
    && near(input.powerKw, 118, 2)
    && fuel === "汽油") {
    return {
      field: "fuel",
      sourceValue: fuel,
      verifiedValue: "油电混合",
      reason: "goodcar_named_fuel_conflicts_with_exact_2012_camry_zunrui_2_5hg_reference",
      referenceSource: "Autohome exact spec 12931",
      referenceUrl: "https://www.autohome.com.cn/spec/12931/",
    };
  }

  return null;
}