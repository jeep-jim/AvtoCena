import { readEncyclopediaKnowledgeVariants } from "./encyclopedia";
import { vehicleKnowledgeCompact } from "./vehicle-knowledge";

export type PublicEncyclopediaVariant = {
  id: string;
  slug: string;
  modelId: string;
  source: string;
  variantName?: string;
  generation?: string;
  generationStatus?: string;
  facelift?: string;
  faceliftStatus?: string;
  market?: string;
  yearFrom?: number;
  yearTo?: number;
  bodyType?: string;
  engineCc?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  powertrainKind?: string;
  powerHp?: number;
  powerKw?: number;
  icePowerKw?: number;
  motorPeakKw?: number;
  systemPowerKw?: number;
  power30MinKw?: number;
  utilizationPowerKw?: number;
  encyclopediaStatus?: string;
  evidenceOfficial?: boolean;
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function positiveEncyclopediaNumber(value: unknown, max = 10_000) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : undefined;
}

export function compactEncyclopediaNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".0", "");
}

export function encyclopediaYearRange(from?: number, to?: number) {
  if (from && to) return `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "период уточняется";
}

function totalThirtyMinute(row: { power30MinKw?: number; power30MinKwByMotor?: number[] }) {
  const direct = positiveEncyclopediaNumber(row.power30MinKw, 4_000);
  if (direct) return direct;
  const motors = (row.power30MinKwByMotor || [])
    .map((value) => positiveEncyclopediaNumber(value, 2_000))
    .filter((value): value is number => Boolean(value));
  return motors.length ? Math.round(motors.reduce((sum, value) => sum + value, 0) * 100) / 100 : undefined;
}

function slugify(value: unknown) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "modification";
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 7);
}

export function encyclopediaVariantSlug(row: { id: string; variantName?: string; generation?: string }) {
  const idTail = String(row.id || "").split("/").filter(Boolean).at(-1) || "variant";
  const readable = slugify(row.variantName || idTail || row.generation || "modification").slice(0, 64);
  return `${readable}-${shortHash(String(row.id || readable))}`;
}

function trusted(row: PublicEncyclopediaVariant) {
  if (row.source !== "encyclopedia_v2") return true;
  if (row.encyclopediaStatus === "verified") return true;
  return row.encyclopediaStatus === "seed" && row.evidenceOfficial === true;
}

function signature(row: PublicEncyclopediaVariant) {
  return [
    vehicleKnowledgeCompact(row.variantName),
    vehicleKnowledgeCompact(row.generation),
    vehicleKnowledgeCompact(row.facelift),
    row.yearFrom || 0,
    row.yearTo || 0,
    row.engineCc || 0,
    vehicleKnowledgeCompact(row.fuel),
    vehicleKnowledgeCompact(row.transmission),
    vehicleKnowledgeCompact(row.drive),
    Math.round(Number(row.powerHp || 0) * 10) / 10,
    Math.round(Number(row.power30MinKw || 0) * 100) / 100,
  ].join("|");
}

function toPublicVariant(variant: any): PublicEncyclopediaVariant {
  const generationMeta = variant?.generationMeta as { name?: string; status?: string } | null | undefined;
  const faceliftMeta = variant?.faceliftMeta as { name?: string; status?: string } | null | undefined;
  const powerHp = positiveEncyclopediaNumber(variant?.powerHp, 2_500);
  const row: Omit<PublicEncyclopediaVariant, "slug"> = {
    id: String(variant?.id || ""),
    modelId: String(variant?.modelId || ""),
    source: String(variant?.sourceType || "encyclopedia_v2"),
    variantName: clean(variant?.name) || undefined,
    generation: clean(variant?.generation || generationMeta?.name) || undefined,
    generationStatus: clean(generationMeta?.status) || undefined,
    facelift: clean(faceliftMeta?.name) || undefined,
    faceliftStatus: clean(faceliftMeta?.status) || undefined,
    market: clean(variant?.market) || undefined,
    yearFrom: positiveEncyclopediaNumber(variant?.yearFrom, 2100),
    yearTo: positiveEncyclopediaNumber(variant?.yearTo, 2100),
    bodyType: clean(variant?.bodyType) || undefined,
    engineCc: positiveEncyclopediaNumber(variant?.engineCc, 20_000),
    fuel: clean(variant?.fuel) || undefined,
    transmission: clean(variant?.transmission) || undefined,
    drive: clean(variant?.drive) || undefined,
    powertrainKind: clean(variant?.powertrainKind) || undefined,
    powerHp,
    powerKw: positiveEncyclopediaNumber(variant?.powerKw, 4_000)
      || (variant?.sourceType !== "encyclopedia_v2" && powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined),
    icePowerKw: positiveEncyclopediaNumber(variant?.icePowerKw, 4_000),
    motorPeakKw: positiveEncyclopediaNumber(variant?.motorPeakKw, 4_000),
    systemPowerKw: positiveEncyclopediaNumber(variant?.systemPowerKw, 4_000),
    power30MinKw: totalThirtyMinute(variant || {}),
    utilizationPowerKw: positiveEncyclopediaNumber(variant?.utilizationPowerKw, 4_000),
    encyclopediaStatus: clean(variant?.encyclopediaStatus) || undefined,
    evidenceOfficial: variant?.encyclopediaEvidenceOfficial === true,
  };
  return { ...row, slug: encyclopediaVariantSlug(row) };
}

export async function readPublicEncyclopediaVariants(modelId: string) {
  const variants = await readEncyclopediaKnowledgeVariants();
  const rows = variants
    .filter((variant) => variant.active !== false && variant.modelId === modelId)
    .map(toPublicVariant)
    .filter((row) => row.id && trusted(row));
  const unique = new Map<string, PublicEncyclopediaVariant>();
  for (const row of rows) if (!unique.has(signature(row))) unique.set(signature(row), row);
  return [...unique.values()].sort((left, right) =>
    Number(right.yearTo || right.yearFrom || 0) - Number(left.yearTo || left.yearFrom || 0)
      || vehicleKnowledgeCompact(left.generation).localeCompare(vehicleKnowledgeCompact(right.generation), "en")
      || Number(left.powerHp || 0) - Number(right.powerHp || 0));
}

export function encyclopediaSourceLabel(row: PublicEncyclopediaVariant) {
  if (row.source.includes("manufacturer")) return "Производитель";
  if (row.source.includes("official_registry")) return "Официальный реестр";
  if (row.source.includes("drom")) return "Каталог модификаций";
  if (row.source.includes("consensus")) return "Подтверждено источниками";
  if (row.source.includes("manual")) return "Проверено АвтоЦена";
  if (row.source.includes("encyclopedia_v2")) {
    if (row.encyclopediaStatus === "verified") return "Проверено АвтоЦена";
    if (row.encyclopediaStatus === "seed" && row.evidenceOfficial) return "Официальный источник";
  }
  return "База АвтоЦена";
}

export function encyclopediaVariantTitle(row: PublicEncyclopediaVariant, fallback: string) {
  if (row.variantName) return row.variantName;
  const parts = [
    row.engineCc ? `${compactEncyclopediaNumber(row.engineCc)} см³` : "",
    row.fuel,
    row.powerHp ? `${compactEncyclopediaNumber(row.powerHp)} л.с.` : "",
    row.transmission,
    row.drive,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : row.generation || fallback;
}

export function encyclopediaGenerationKey(row: PublicEncyclopediaVariant) {
  return [row.generation || "Поколение уточняется", row.facelift || "", row.yearFrom || 0, row.yearTo || 0].join("|");
}
