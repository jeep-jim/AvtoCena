import {canonicalizeSemanticSourceFields, namedElectrifiedPowertrainKind} from '../../apps/web/lib/catalog/powertrain-safety.ts';
import {catalogPowerSanity} from '../../apps/web/lib/catalog/power-sanity.ts';

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

/** Pure mapping of one already identity-verified, paid v3 snapshot row.
 * No provider calls, model-spec guesses or changes to legacy Encar adapters.
 */
export function normalizePaidEncarOffer(data, {id, observedAt, adapter}) {
  if (!/^\d+$/.test(String(id)) || String(data?.inner_id) !== String(id)) throw Error('Encar identity mismatch');
  const year = metric(data.year, 1900, new Date(observedAt).getUTCFullYear() + 1, true);
  if (year.status !== 'exact') return null;
  const cc = metric(data.displacement_cc, 300, 10000, true);
  const hp = metric(data.power, 20, 2500);
  const iceHp = metric(data.power_ice_hp, 20, 2500);
  const motorKw = metric(data.power_electro_kw, 0.1, 2500);
  const driveLabel = text(data.drive_type);
  const ambiguousDrive = /\b(?:2wd|4x2)\b|передний\s*(?:или|\/)\s*задний/i.test(driveLabel);
  const fuelLabel = text(data.engine_type).replace(/электричество/ig, 'electricity');
  const fields = canonicalizeSemanticSourceFields({fuel: fuelLabel,
    transmission: text(data.transmission_type), bodyType: text(data.body_type),
    drive: ambiguousDrive ? undefined : driveLabel});
  const fuelKind = namedElectrifiedPowertrainKind({fuel: fuelLabel})
    || (fields.fuel === 'electric' ? 'electric' : fields.fuel === 'hybrid' ? 'other_hybrid' : fields.fuel ? 'combustion' : 'unknown');
  const offer = adapter.normalizeOffer({Id: id, Manufacturer: data.mark, Model: data.model, FormYear: year.value,
    Price: data.price, Badge: data.configuration, BadgeDetail: data.complectation, Mileage: data.km_age,
    FuelType: fields.fuel, Transmission: fields.transmission, DriveType: fields.drive,
    Category: fields.bodyType, Displacement: cc.value, Power: hp.value, Color: data.color, UpdatedDate: observedAt});
  if (!offer) return null;

  // Preserve source fields, not a value guessed from the model/trim by the
  // legacy normalizer. Contradictory electrified identities remain blocked.
  const namedKind = namedElectrifiedPowertrainKind(offer);
  const fuelConflict = fields.fuel && namedKind && namedKind !== fuelKind;
  const fuelAmbiguous = fuelKind === 'combustion' && motorKw.status === 'exact';
  const fuelResult = {status: fuelConflict ? 'conflict' : fuelAmbiguous ? 'ambiguous'
    : fields.fuel ? 'exact' : present(data.engine_type) ? 'ambiguous' : 'missing', value: fields.fuel,
    ...(fuelConflict ? {reason: 'fuel_identity_conflict'} : fuelAmbiguous ? {reason: 'electric_power_with_combustion_label'} : {})};
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
    offer.powerHp = undefined; offer.powerKw = undefined; offer.icePowerKw = undefined;
    offer.utilizationPowerKw = undefined; offer.powerDataConfidence = undefined; offer.powerDataSource = undefined;
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
      year: evidence('year', {status: 'exact', value: offer.year}),
      fuel: evidence('engine_type', fuelResult),
      powertrainKind: evidence('engine_type', {...fuelResult, value: fuelKind}),
      engineCc: evidence('displacement_cc', {...cc,
        ...(cc.status === 'missing' && present(data.displacement) ? {reason: 'litres_do_not_prove_exact_cc'} : {})}, 'cm3'),
      powerHp: evidence('power', powerResult, 'hp'),
      drive: evidence('drive_type', {status: fields.drive ? 'exact' : 'missing', value: fields.drive,
        ...(ambiguousDrive ? {reason: 'driven_axle_unspecified'} : {})}),
      certifiedPower: evidence('certified_30min_power', {status: 'missing'}, 'kW'),
    }});
  return offer;
}
