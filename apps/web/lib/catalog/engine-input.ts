/** User input only: liters below 20, otherwise exact cubic centimeters. */
export function parseEngineCc(value: unknown): number | undefined {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*(л|l|см³|см3|cc|cm3)?$/);
  if (!match) return undefined;
  const number = Number(match[1].replace(",", "."));
  const liters = match[2] === "л" || match[2] === "l" || (!match[2] && number < 20);
  const cc = liters ? Math.round(number * 1000) : number;
  return cc >= 300 && cc <= 10000 && Number.isInteger(cc) ? cc : undefined;
}
