import {canonicalizeSemanticSourceFields, namedElectrifiedPowertrainKind} from '../../apps/web/lib/catalog/powertrain-safety.ts';
import {catalogPowerSanity} from '../../apps/web/lib/catalog/power-sanity.ts';
import {normalizeVehicleOfferSpecs} from '../../apps/web/lib/catalog/spec-normalization.ts';

// Auto API Encar v3 field reference, checked 2026-11-16:
// https://auto-api.com/encar (Specifications). The legacy example later on that
// page has different displacement/price units and is not this snapshot schema.
const source = field => `auto_api_encar:v3:${field}`;
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const present = value => value !== undefined && value !== null && value !== '';
const kw = hp => hp === undefined ? undefined : Math.round(hp / 1.35962 * 1000000) / 1000000;
function metric(raw, minimum, maximum, integer = false) {
  if (!present(raw)) return {status: 'missing'};
  const value = /^\d+(?:\.\d+)?$/.test(text(raw)) ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= minimum && value <= maximum && (!integer || Number.isInteger(value))
    ? {status: 'exact', value} : {status: 'ambiguous', reason: 'invalid_source_number'};
}
const evidence = (field, result, unit) => ({source: source(field), ...result, ...(unit ? {unit} : {})});
function hasSemanticAlternatives(label, field) {
  const parts = label.split(/[/|;]|\bor\b|(?:^|\s)(?:или|либо)(?:\s|$)/i).map(part => part.trim()).filter(Boolean);
  const values = parts.map(part => canonicalizeSemanticSourceFields({[field]: part})[field]);
  const choices = new Set(values.filter(Boolean));
  const explicitChoice = /\bor\b|(?:^|\s)(?:или|либо)(?:\s|$)/i.test(label);
  if (explicitChoice && parts.length > 1 && values.some(value => !value)) return true;
  if (choices.size < 2) return false;
  // A slash can join a hybrid's two energy sources or a bi-fuel system.
  // Preserve the existing canonical treatment of those combinations; an
  // explicit "or" is still an alternative, and petrol/diesel remains unclear.
  if (field === 'fuel' && !explicitChoice && choices.size === 2 &&
      ((choices.has('electric') && ['petrol', 'diesel', 'lpg'].some(value => choices.has(value))) ||
       (choices.has('petrol') && choices.has('lpg')))) return false;
  return true;
}

function assertNoUndocumentedThirtyMinutePower(offer) {
  // The publisher normalizes again. Probe that actual path without replacing
  // the source-bound offer with any values inferred from its trim/raw text.
  // This v3 schema supplies no certified 30-minute measurement at all.
  const repeated = normalizeVehicleOfferSpecs(offer);
  const values = [repeated.power30MinKw,
    ...(Array.isArray(repeated.power30MinKwByMotor) ? repeated.power30MinKwByMotor : [])];
  if (values.some(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    // Throw, rather than skip this car: the restorer cannot complete the
    // intake report, and publication must keep the currently active catalog.
    throw Error('paid_encar_v3_undocumented_30_min_power');
  }
}

/** Pure mapping of one already identity-verified, paid v3 snapshot row.
 * No provider calls, model-spec guesses or changes to legacy Encar adapters.
 */
export function normalizePaidEncarOffer(data, {id, observedAt, adapter}) {
  if (!/^\d+$/.test(String(id)) || String(data?.inner_id) !== String(id)) throw Error('Encar identity mismatch');
  const year = metric(data.year, 1900, new Date(observedAt).getUTCFullYear() + 1, true);
  if (year.status !== 'exact') return null;
  // v3 year_month is manufacture month; year remains supplier model year.
  const manufactureMonth = text(data.year_month);
  const manufactureValid = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(manufactureMonth)
    && Number.isFinite(Date.parse(observedAt))
    && Date.parse(manufactureMonth + '-01T00:00:00Z') <= Date.parse(observedAt);
  const production = manufactureValid ? {status:'exact', value:manufactureMonth}
    : {status:present(data.year_month)?'ambiguous':'missing'};
  const cc = metric(data.displacement_cc, 300, 10000, true);
  const hp = metric(data.power, 20, 2500);
  const iceHp = metric(data.power_ice_hp, 20, 2500);
  const motorKw = metric(data.power_electro_kw, 0.1, 2500);
  const driveLabel = text(data.drive_type);
  const ambiguousDrive = /\b(?:2wd|4x2)\b|передний\s*(?:или|\/)\s*задний/i.test(driveLabel)
    || hasSemanticAlternatives(driveLabel, 'drive');
  const fuelLabel = text(data.engine_type).replace(/электричество/ig, 'electricity');
  const alternativeFuel = hasSemanticAlternatives(fuelLabel, 'fuel');
  const fields = canonicalizeSemanticSourceFields({fuel: alternativeFuel ? undefined : fuelLabel,
    transmission: text(data.transmission_type), bodyType: text(data.body_type),
    drive: ambiguousDrive ? undefined : driveLabel});
  const sourceFuelKind = alternativeFuel ? 'unknown' : namedElectrifiedPowertrainKind({fuel: fuelLabel})
    || (fields.fuel === 'electric' ? 'electric' : fields.fuel === 'hybrid' ? 'other_hybrid' : fields.fuel ? 'combustion' : 'unknown');
  const offer = adapter.normalizeOffer({Id: id, Manufacturer: data.mark, Model: data.model, FormYear: year.value,
    Price: data.price, Badge: data.configuration, BadgeDetail: data.complectation, Mileage: data.km_age,
    FuelType: fields.fuel, Transmission: fields.transmission, DriveType: fields.drive,
    Category: fields.bodyType, Displacement: cc.value, Power: hp.value, Color: data.color, UpdatedDate: observedAt});
  if (!offer) return null;

  offer.productionDate = manufactureValid ? manufactureMonth : undefined;
  offer.productionYear = manufactureValid ? Number(manufactureMonth.slice(0,4)) : undefined;
  // Preserve source fields, not a value guessed from the model/trim by the
  // legacy normalizer. Contradictory electrified identities remain blocked.
  // `hybrid` is a coarse source fuel label, not proof of a parallel layout.
  // Resolve a more specific, explicitly named layout without using the fuel
  // field itself as circular name evidence. An explicitly parallel source
  // description still conflicts with a series name.
  const namedKind = namedElectrifiedPowertrainKind({...offer, fuel: undefined, engineType: undefined});
  const compatibleSeriesName = sourceFuelKind === 'other_hybrid' && namedKind === 'series_hybrid'
    && !/parallel[ -]?hybrid|power[ -]?split|mixed[ -]?hybrid|параллельн[а-яё]*\s+гибрид/i.test(fuelLabel);
  const fuelKind = compatibleSeriesName ? namedKind : sourceFuelKind;
  const fuelConflict = fields.fuel && namedKind && namedKind !== fuelKind;
  const fuelAmbiguous = fuelKind === 'combustion' && motorKw.status === 'exact';
  const fuelResult = {status: alternativeFuel ? 'ambiguous' : fuelConflict ? 'conflict' : fuelAmbiguous ? 'ambiguous'
    : fields.fuel ? 'exact' : present(data.engine_type) ? 'ambiguous' : 'missing', value: fields.fuel,
    ...(alternativeFuel ? {reason: 'alternative_source_fuels', rawValue: text(data.engine_type).slice(0, 160)}
      : fuelConflict ? {reason: 'fuel_identity_conflict'} : fuelAmbiguous ? {reason: 'electric_power_with_combustion_label'} : {})};
  Object.assign(offer, fields, {fuel: fields.fuel, powertrainKind: fuelKind,
    engineCc: cc.value, powerHp: hp.value, powerKw: kw(hp.value),
    powerDataConfidence: hp.status === 'exact' ? 'source_exact' : undefined,
    powerDataSource: hp.status === 'exact' ? source('power') : undefined,
    // Total hybrid/system hp and electric peak kW are never 30-minute power.
    icePowerKw: fuelKind === 'electric' ? undefined : kw(iceHp.value) ?? (fuelKind === 'combustion' ? kw(hp.value) : undefined),
    motorPeakKw: motorKw.value, power30MinKw: undefined, power30MinKwByMotor: undefined,
    utilizationPowerKw: fuelKind === 'combustion' ? kw(iceHp.value ?? hp.value) : undefined});
  const sanity = catalogPowerSanity(offer);
  const combustionConflict = fuelKind === 'combustion' && hp.value !== undefined && iceHp.value !== undefined
    && Math.abs(hp.value - iceHp.value) > 1;
  const powerResult = sanity.suspicious || combustionConflict
    ? {status: 'conflict', reason: combustionConflict ? 'combustion_total_ice_mismatch' : sanity.reason}
    : hp;
  if (powerResult.status !== 'exact') {
    offer.powerHp = undefined; offer.powerKw = undefined;
    offer.powerDataConfidence = undefined; offer.powerDataSource = undefined;
    // The supplier measures ICE separately from total power. Retain that
    // measurement only when both its unit and powertrain identity are clear.
    const independentIce = powerResult.status === 'missing' && iceHp.status === 'exact'
      && fuelResult.status === 'exact' && fuelKind !== 'electric' && fuelKind !== 'unknown';
    if (!independentIce) {
      offer.icePowerKw = undefined;
      offer.utilizationPowerKw = undefined;
    }
  }
  // A freshly attested source value of 100 hp can pass the existing sanity
  // gate; any genuine source/physical rejection is preserved above.
  if (!sanity.suspicious && offer.operational?.powerSanity?.reason === 'unproven_exact_100_hp') delete offer.operational.powerSanity;
  offer.operational ||= {};
  Object.assign(offer.operational, {provider: 'auto_api_encar', exactDetail: true,
    detailIdentityVerified: true, fieldIdentityVerified: true,
    sourcePower: {totalHp: evidence('power', hp, 'hp'), iceHp: evidence('power_ice_hp', iceHp, 'hp'),
      electricPeakKw: evidence('power_electro_kw', motorKw, 'kW')},
    // Rounded litres are retained separately and never become exact cm³.
    sourceDisplacementLitres: metric(data.displacement, 0.3, 10).value,
    sourceDriveEvidence: {source: source('drive_type'), status: ambiguousDrive ? 'ambiguous' : fields.drive ? 'exact' : 'missing',
      ...(driveLabel ? {rawValue: driveLabel.slice(0, 80)} : {})},
    semanticEvidence: {
      productionDate: {...production, source: 'auto_api_encar:v3:year_month:production', observedAt},
      year: evidence('year', {status: 'exact', value: offer.year}),
      fuel: evidence('engine_type', fuelResult),
      powertrainKind: evidence(compatibleSeriesName ? 'engine_type+identity_name' : 'engine_type', {...fuelResult, value: fuelKind}),
      engineCc: evidence('displacement_cc', {...cc,
        ...(cc.status === 'missing' && present(data.displacement) ? {reason: 'litres_do_not_prove_exact_cc'} : {})}, 'cm3'),
      powerHp: evidence('power', powerResult, 'hp'),
      drive: evidence('drive_type', {status: fields.drive ? 'exact' : 'missing', value: fields.drive,
        ...(ambiguousDrive ? {reason: 'driven_axle_unspecified'} : {})}),
      certifiedPower: evidence('certified_30min_power', {status: 'missing'}, 'kW'),
    }});
  assertNoUndocumentedThirtyMinutePower(offer);
  return offer;
}
