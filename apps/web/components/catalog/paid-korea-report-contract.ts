/** Public display data only. Never use this projection for vehicle pricing. */
export type PaidKoreaReportKind = 'history' | 'inspection';
type RecordValue = Record<string, unknown>;
type Reader = (value: unknown) => unknown;
type Shape = Record<string, Reader>;
type Fields<S extends Shape> = {[K in keyof S]: ReturnType<S[K]>};

const object = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const decimal = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const boolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

/** Labels are plain bounded text. Contact details, URLs and VINs stay private. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  if (!result || result.length > 180 || /[\u0000-\u001f\u007f<>]/.test(result) || /(?:https?:\/\/|www\.|\S+@\S+|\b[A-HJ-NPR-Z0-9]{17}\b|\+?\d[\d ()-]{8,}\d)/i.test(result)) return null;
  return result;
}

function identifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(result) && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(result) ? result : null;
}

function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : null;
}

function month(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : null;
}

function list<T>(value: unknown, read: (entry: unknown) => T | null, limit = 100): T[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result = value.map(read);
  return result.some(entry => entry === null) ? null : result as T[];
}

function fields<S extends Shape>(value: unknown, shape: S): Fields<S> | null {
  const row = object(value);
  if (!row) return null;
  const result = Object.fromEntries(Object.entries(shape).map(([key, read]) => [key, read(row[key])])) as Fields<S>;
  return Object.values(result).some(entry => entry !== null) ? result : null;
}

const accidentFields = {
  date, damage_to: text, paid_by: text, insurance_benefit_won: integer,
  parts_won: integer, labor_won: integer, painting_won: integer,
};
export type PaidKoreaAccident = Fields<typeof accidentFields>;

const plateFields = {date, use: text, vehicle_kind: text};
const uninsuredFields = {from: month, to: month};
const historyFields = {
  report_date: date, first_registration_date: date,
  owner_changes: integer, plate_changes: integer,
  rental_history: boolean, commercial_history: boolean, government_history: boolean,
  own_damage_count: integer, own_damage_cost_won: integer,
  other_damage_count: integer, other_damage_cost_won: integer,
  total_loss_count: integer, total_loss_date: date,
  flood_total_loss_count: integer, flood_partial_loss_count: integer, flood_date: date,
  theft_count: integer, theft_date: date,
  owner_change_dates: (value: unknown) => list(value, date),
  plate_history: (value: unknown) => list(value, entry => fields(entry, plateFields)),
  uninsured_periods: (value: unknown) => list(value, entry => fields(entry, uninsuredFields)),
  use: text,
  accidents: (value: unknown) => list(value, entry => fields(entry, accidentFields)),
};
export type PaidKoreaHistory = Fields<typeof historyFields>;

/** The supplier's translated label/value maps; no arbitrary recursive objects. */
function textMap(value: unknown): Record<string, string> | null {
  const row = object(value);
  if (!row || Object.keys(row).length > 80) return null;
  const result: Record<string, string> = Object.create(null);
  for (const [key, entry] of Object.entries(row)) {
    const label = text(key), detail = text(entry);
    if (!label || !detail || ['__proto__', 'constructor', 'prototype'].includes(label) || Object.hasOwn(result, label)) return null;
    result[label] = detail;
  }
  return result;
}

function groupedTextMap(value: unknown): Record<string, Record<string, string>> | null {
  const row = object(value);
  if (!row || Object.keys(row).length > 16) return null;
  const result: Record<string, Record<string, string>> = Object.create(null);
  let entries = 0;
  for (const [key, entry] of Object.entries(row)) {
    const label = text(key), group = textMap(entry);
    if (!label || !group || ['__proto__', 'constructor', 'prototype'].includes(label) || Object.hasOwn(result, label)) return null;
    entries += Object.keys(group).length;
    if (entries > 160) return null;
    result[label] = group;
  }
  return result;
}

function panelCodes(value: unknown): Record<string, string[]> | null {
  const row = object(value);
  if (!row || Object.keys(row).length > 80) return null;
  const result: Record<string, string[]> = Object.create(null);
  for (const [key, entry] of Object.entries(row)) {
    if (!/^P\d{3}$/.test(key)) return null;
    const codes = list(entry, text, 8);
    if (!codes) return null;
    result[key] = codes;
  }
  return result;
}

function diagnosisCodes(value: unknown): Record<string, string> | null {
  const result = textMap(value);
  return result && Object.keys(result).every(key => /^P\d{3}$/.test(key)) ? result : null;
}

const inspectionFields = {
  record_number: identifier, issue_date: date, valid_from: date, valid_until: date,
  first_registration_date: date, model_year: integer, mileage: integer,
  engine_code: text, warranty_type: text,
  accident: boolean, simple_repair: boolean, flood: boolean,
  special_history: (value: unknown) => list(value, text, 20),
  recall: boolean, recall_completed: boolean, tuning: boolean,
  tuning_types: (value: unknown) => list(value, text, 20),
  usage_changes: (value: unknown) => list(value, text, 20),
  odometer_state: text, mileage_assessment: text, vin_state: text,
  co_percent: decimal, hc_ppm: decimal, smoke_percent: decimal,
  panels: groupedTextMap, panel_codes: panelCodes, systems: groupedTextMap,
};
export type PaidKoreaInspection = Fields<typeof inspectionFields>;

const diagnosisFields = {
  date, center: text, result: text, panels: textMap, panel_codes: diagnosisCodes,
};
export type PaidKoreaDiagnosis = Fields<typeof diagnosisFields>;

type ReportIdentity = {
  version: 3; provider: 'auto_api_encar'; offerId: string; lot: string;
  observedAt: string;
};
export type PaidKoreaReport = ReportIdentity & (
  {kind: 'history'; history: PaidKoreaHistory | null}
  | {kind: 'inspection'; inspection: PaidKoreaInspection | null; diagnosis: PaidKoreaDiagnosis | null}
);
export type PaidKoreaReportContext = {offerId: string; lot: string; kind: PaidKoreaReportKind; observedAt: string};

function validContext(value: PaidKoreaReportContext): boolean {
  return typeof value?.offerId === 'string' && /^[a-f0-9]{24}$/.test(value.offerId)
    && typeof value.lot === 'string' && /^\d{6,10}$/.test(value.lot)
    && ['history', 'inspection'].includes(value.kind)
    && typeof value.observedAt === 'string' && value.observedAt.length <= 35
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.observedAt)
    && date(value.observedAt.slice(0, 10)) !== null && Number.isFinite(Date.parse(value.observedAt));
}

/** Input is the saved provider data object, already bound to its vehicle server-side. */
export function normalizePaidKoreaReport(row: unknown, context: PaidKoreaReportContext): PaidKoreaReport {
  if (!validContext(context)) throw new Error('invalid_paid_korea_report_context');
  const input = object(row);
  const identity: ReportIdentity = {version: 3, provider: 'auto_api_encar', offerId: context.offerId, lot: context.lot, observedAt: context.observedAt};
  return context.kind === 'history'
    ? {...identity, kind: 'history', history: fields(input?.history, historyFields)}
    : {...identity, kind: 'inspection', inspection: fields(input?.inspection, inspectionFields), diagnosis: fields(input?.diagnosis, diagnosisFields)};
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => sameValue(entry, right[index]));
  const a = object(left), b = object(right);
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

/** A response must be the exact public projection, with no unrecognized fields. */
export function validPaidKoreaReport(value: unknown, offerId: string, lot: string, kind: PaidKoreaReportKind): value is PaidKoreaReport {
  const row = object(value);
  if (!row || row.version !== 3 || row.provider !== 'auto_api_encar' || row.offerId !== offerId || row.lot !== lot || row.kind !== kind) return false;
  try {
    return sameValue(value, normalizePaidKoreaReport(row, {offerId, lot, kind, observedAt: row.observedAt as string}));
  } catch { return false; }
}
