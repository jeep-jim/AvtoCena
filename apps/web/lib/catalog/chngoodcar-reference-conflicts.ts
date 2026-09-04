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

  // Good Car sampled the exact 2019 Geely Xingyue 300T Explorer as gasoline,
  // with the matching 1477 cc / 130 kW identity. Autohome exact spec 39287
  // identifies this trim as gasoline + 48V mild hybrid. Reject only; do not
  // rewrite the source powertrain.
  if (/^吉利(?:汽车)?\s*星越\s+2019款\s+300T\s+探星者(?:\s|$)/i.test(title)
    && near(input.engineCc, 1477, 100)
    && near(input.powerKw, 130, 2)
    && fuel === "汽油") {
    return {
      field: "fuel",
      sourceValue: fuel,
      verifiedValue: "汽油+48V轻混系统",
      reason: "goodcar_named_fuel_conflicts_with_exact_2019_geely_xingyue_300t_reference",
      referenceSource: "Autohome exact spec 39287",
      referenceUrl: "https://www.autohome.com.cn/spec/39287/",
    };
  }

  // Good Car sampled the exact 2017 Volkswagen Langxing 180TSI DSG Comfort as
  // a sedan while exposing the matching 1.2T / 81 kW identity. Autohome exact
  // spec 29388 identifies the trim body as a five-door hatchback. Reject the
  // conflicting source body; never rewrite it automatically.
  if (/^大众(?:汽车)?\s*朗行\s+2017款\s+180TSI\s+DSG舒适版(?:\s|$)/i.test(title)
    && near(input.engineCc, 1197, 100)
    && near(input.powerKw, 81, 2)
    && bodyType === "轿车") {
    return {
      field: "bodyType",
      sourceValue: bodyType,
      verifiedValue: "两厢车",
      reason: "goodcar_named_body_conflicts_with_exact_2017_vw_langxing_180tsi_dsg_comfort_reference",
      referenceSource: "Autohome exact spec 29388",
      referenceUrl: "https://car.autohome.com.cn/config/spec/29388.html",
    };
  }

  return null;
}