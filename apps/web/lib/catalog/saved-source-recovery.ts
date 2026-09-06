import type { VehicleOffer } from "./types";
import { canonicalSourceFuel } from "./powertrain-safety";
import { withoutDeliveredPrice } from "./modification-contract";

type Evidence = { status: "exact" | "missing" | "ambiguous" | "conflict"; value?: unknown; source: string; rawValues: string[] };
const text = (value: unknown) => String(value ?? "").trim();

function metric(value: unknown, min: number, max: number, source: string): Evidence {
  const raw = text(value);
  if (!raw) return { status: "missing", source, rawValues: [] };
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return { status: "ambiguous", source, rawValues: [raw.slice(0, 160)] };
  const n = Number(raw);
  return { status: Number.isFinite(n) && n >= min && n <= max ? "exact" : "ambiguous", value: n, source, rawValues: [raw] };
}

function fuelEvidence(value: unknown, source: string): Evidence {
  const raw = text(value), valueFuel = canonicalSourceFuel(raw);
  if (!raw) return { status: "missing", source, rawValues: [] };
  // A petrol/diesel alternative is not an exact fuel classification.
  const alternative = /petrol|gasoline|benzin/i.test(raw) && /diesel/i.test(raw);
  return { status: valueFuel && !alternative ? "exact" : "ambiguous", value: valueFuel, source, rawValues: [raw.slice(0, 160)] };
}

/** Replays retained source fields only. No network, model inference or writes. */
export function restoreSavedSourceEvidence(input: VehicleOffer): VehicleOffer {
  if (input.market === "japan") return input;
  const op: any = input.operational || {}, raw: any = op.raw || {};
  const source = `saved_source:${input.sourceId}:${input.sourceOfferId}`;
  let engine: unknown, hp: unknown, kw: unknown, fuel: unknown;
  let bound = false;
  const parsed = raw.parsed;
  if (["mobile_de_open", "autoscout_europe_open"].includes(input.sourceId)
    && input.market === "europe" && parsed
    && text(parsed.id) === text(input.sourceOfferId)
    && (raw.detailIdentityVerified === true || op.exactDetail === true)) {
    engine = parsed.engineCc; hp = parsed.powerHp; kw = parsed.powerKw;
    fuel = parsed.raw?.vehicle?.fuel || parsed.fuel; bound = true;
  } else if (input.sourceId === "kcar_korea_open" && input.market === "korea"
    && op.detailIdentityVerified === true && op.fieldIdentityVerified === true
    && Array.isArray(op.sourceExactFields)) {
    // Old K Car rows retained a field attestation instead of the RVO payload.
    // A later knowledge overwrite invalidates that attestation for that field.
    const applied: string[] = op.knowledgeCore?.fieldsApplied || [];
    const trusted = (field: string) => op.sourceExactFields.includes(field) && !applied.includes(field);
    engine = trusted("engineCc") ? input.engineCc : undefined;
    fuel = trusted("fuel") ? input.fuel : undefined;
    hp = trusted("powerHp") && input.powerDataSource === "kcar_exact_detail_rvo_hrspow" ? input.powerHp : undefined;
    bound = true;
  } else if (input.sourceId === "autohome_new_china_open" && input.market === "china"
    && raw.detailIdentityVerified === true && text(raw.configSpecId) === text(input.sourceOfferId)
    && text(raw.listing?.specId) === text(input.sourceOfferId)) {
    const fields = raw.configFields || {};
    fuel = fields.energy; hp = fields.engineMaxHp; kw = fields.engineMaxKw;
    // A marketing label such as 1.5L does not prove 1500 rather than 1498 cc.
    const cc = text(fields.engine).match(/\b(\d{3,5})\s*(?:cc|cm3|cm³)\b/i);
    engine = cc?.[1]; bound = true;
  }
  if (!bound) return input;
  const evidence: Record<string, Evidence> = {
    engineCc: metric(engine, 300, 10000, source), fuel: fuelEvidence(fuel, source),
    powerHp: metric(hp, 20, 2500, source), powerKw: metric(kw, 10, 2000, source),
  };
  if (evidence.powerHp.status === "exact" && evidence.powerKw.status === "exact"
    && Math.abs(Number(hp) * 0.73549875 - Number(kw)) > 1.5) {
    evidence.powerHp.status = "conflict"; evidence.powerKw.status = "conflict";
  }
  const exact = (field: string) => evidence[field].status === "exact" ? evidence[field].value : undefined;
  const recoveredFuel = exact("fuel") as string | undefined;
  const kind = recoveredFuel === "electric" ? "electric" : recoveredFuel === "hybrid" ? "unknown"
    : ["petrol", "diesel", "lpg", "cng"].includes(recoveredFuel || "") ? "combustion" : "unknown";
  evidence.powertrainKind = { status: kind === "unknown" ? "missing" : "exact", value: kind, source, rawValues: evidence.fuel.rawValues };
  if (kind === "electric" && exact("engineCc")) evidence.engineCc.status = "conflict";
  const next: VehicleOffer = { ...withoutDeliveredPrice(input), engineType: undefined,
    fuel: recoveredFuel, powertrainKind: kind, engineCc: exact("engineCc") as number | undefined,
    powerHp: exact("powerHp") as number | undefined, powerKw: exact("powerKw") as number | undefined,
    icePowerKw: undefined, power30MinKw: undefined, power30MinKwByMotor: undefined, utilizationPowerKw: undefined,
    powerDataConfidence: exact("powerHp") || exact("powerKw") ? "source_exact" : undefined,
    powerDataSource: exact("powerHp") || exact("powerKw") ? source : undefined,
    modificationSelection: undefined, recoveryQualification: undefined,
    operational: { ...op, semanticEvidence: { ...(op.semanticEvidence || {}), ...evidence },
      knowledgeCore: { ...(op.knowledgeCore || {}), fieldsApplied: [] },
      savedSourceRecovery: { version: 1, sourceOfferId: input.sourceOfferId, sourceBound: true, fields: Object.keys(evidence),
        previousFuel: input.fuel, previousEngineCc: input.engineCc, previousPowerHp: input.powerHp } },
  };
  if (!next.powerHp && next.powerKw) next.powerHp = Number((next.powerKw / 0.73549875).toFixed(2));
  if (!next.powerKw && next.powerHp) next.powerKw = Number((next.powerHp * 0.73549875).toFixed(4));
  return next;
}
