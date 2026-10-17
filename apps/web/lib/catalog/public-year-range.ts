/** Public calculator scope agreed with the owner. */
export const PUBLIC_MIN_VEHICLE_YEAR = 2010;
export function publicProductionYears(now = new Date()) {
 const maximum = now.getFullYear() + 1;
 return Array.from({length: maximum - PUBLIC_MIN_VEHICLE_YEAR + 1}, (_, i) => maximum - i);
}
