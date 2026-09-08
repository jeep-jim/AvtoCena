import { retainNamedSpecificationGroups } from "./source-specifications";

// Read JSON data emitted by the public detail page; never execute page scripts.
export function che168BrowserChallenge(markup: string) {
  return /window\.solveChallenge\s*\(/.test(markup) && /EO-Bot-Js-Token/.test(markup);
}

type Metric = { value?: number; rawValues: string[]; status: 'exact' | 'missing' | 'conflict' | 'ambiguous' };
function metric(values: unknown[], minimum: number, maximum: number): Metric {
  const rawValues = [...new Set(values.map(String).map(value => value.trim()).filter(value => value && value !== '-'))];
  if (!rawValues.length) return { rawValues, status: 'missing' };
  if (rawValues.some(value => !/^\d+(?:\.\d+)?$/.test(value))) return { rawValues, status: 'ambiguous' };
  const parsed = [...new Set(rawValues.map(Number))];
  if (parsed.some(value => value < minimum || value > maximum)) return { rawValues, status: 'ambiguous' };
  return parsed.length === 1 ? { value: parsed[0], rawValues, status: 'exact' } : { rawValues, status: 'conflict' };
}
export function che168BoundPageParameters(markup: string, infoid: string, specid: number) {
  if (!/^\d+$/.test(infoid) || !Number.isInteger(specid) || specid <= 0) return null;
  const chunks: string[] = [];
  for (const match of markup.matchAll(/self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)/g)) {
    try { chunks.push(JSON.parse(match[1])[1]); } catch { /* Not JSON data. */ }
  }
  const records: any[] = [];
  function visit(value: any, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 30) return;
    if (String(value.carId) === infoid && Array.isArray(value.ssrSpecParam)) records.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  for (const line of chunks.join('').split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    try { visit(JSON.parse(line.slice(colon + 1))); } catch { /* Other RSC record types. */ }
  }
  if (records.length !== 1 || Number(records[0].initialSpecId) !== specid) return null;
  const record = records[0];
  const engineRows = record.ssrSpecParam.filter((group: any) => /^Engine$/i.test(String(group.name)))
    .flatMap((group: any) => Array.isArray(group.paramitems) ? group.paramitems : []);
  const basicRows = record.ssrSpecParam.filter((group: any) => /^Basic Specifications$/i.test(String(group.name)))
    .flatMap((group: any) => Array.isArray(group.paramitems) ? group.paramitems : []);
  const values = (rows: any[], name: RegExp) => rows.filter(row => name.test(String(row.name))).map(row => row.value);
  return {
    sourceOfferId: infoid, specId: specid,
    groups: retainNamedSpecificationGroups(record.ssrSpecParam),
    modelNames: values(basicRows, /^Model Name$/i).map(String),
    fuelValues: [...new Set(values([...basicRows, ...engineRows], /^Energy Type$/i).map(String))],
    engineCc: metric(values(engineRows, /^Displacement \((?:mL|cc|cm3|cm³)\)$/i), 300, 10000),
    powerHp: metric(values(engineRows, /^Maximum horsepower \((?:Ps|hp)\)$/i), 20, 2500),
  };
}
