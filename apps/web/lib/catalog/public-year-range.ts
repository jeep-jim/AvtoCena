import {JAPAN_MIN_MODEL_YEAR} from './japan-year-policy';
/** Public calculator scope agreed with the owner. */
export const PUBLIC_MIN_VEHICLE_YEAR = JAPAN_MIN_MODEL_YEAR;
export function publicProductionYears(now = new Date()) {
 const maximum = now.getFullYear() + 1;
 return Array.from({length: maximum - PUBLIC_MIN_VEHICLE_YEAR + 1}, (_, i) => maximum - i);
}
