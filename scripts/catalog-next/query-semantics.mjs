import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {colorKey} from '../../apps/web/lib/catalog/catalog-color-index.ts';
import {catalogBodyType} from '../../apps/web/lib/catalog/pickup-body.ts';
import {auctionGradeLabel} from '../../apps/web/lib/catalog/japan-export-restriction.ts';
import {matchesCatalogModel} from '../../apps/web/lib/catalog/model-filter.ts';
import {restoreSourceModelName} from '../../apps/web/lib/catalog/source-model-name.ts';
import {vehicleKnowledgeCompact} from '../../apps/web/lib/catalog/vehicle-knowledge.ts';
import {DELIVERY_CITIES, DELIVERY_TARIFF_VERSION, normalizeDeliveryCity, quoteCityDelivery} from '../../apps/web/lib/catalog/city-delivery.ts';
import {normalizedCatalogSort} from '../../apps/web/lib/catalog/catalog-sort.ts';

const need = (value, reason) => assert(value, 'china_semantics_' + reason);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLocaleLowerCase('ru-RU');
const split = (value, separator = '|') => [...new Set(String(value ?? '').split(separator).map(clean).filter(Boolean))];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
export const chinaModelTerm = (make, model) => JSON.stringify([lower(make), lower(model)]);
export const CHINA_UNQUOTED_CITY = '__unquoted__';

/** The accepted runtime's pure projection filter keys. No data reader is called. */
export function buildRowKeys(input) {
  const row = restoreSourceModelName(input);
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const kw = positive(row.utilizationPowerKw);
  const electric = ['electric', 'series_hybrid', 'other_hybrid'].includes(lower(row.powertrainKind)) || /electric|hybrid|phev|hev|bev|электро|гибрид/.test(lower(row.fuel));
  return {make: lower(row.make), color: colorKey(row.color), fuel: String(row.fuel ?? '').toLowerCase(),
    bodyType: lower(catalogBodyType(row)), transmission: String(row.transmission ?? '').trim().toLocaleLowerCase('ru-RU'),
    drive: String(row.drive ?? '').trim().toLocaleLowerCase('ru-RU'), auctionGrade: auctionGradeLabel(row.auctionGrade) || '',
    filterPowerHp: kw ? kw * 1.35962 : electric ? null : positive(row.powerHp),
    modelTerms: [chinaModelTerm(row.make, row.model)]};
}

// Same ranking and exact-match preference as resolveVehicleModelQuery and
// storage.projectionModelKeys, evaluated on a captured normalized directory.
function modelCandidates(models, query, makes) {
  const requested = vehicleKnowledgeCompact(query);
  if (!requested) return [];
  const matches = (makes.length ? makes : [undefined]).flatMap(make => {
    const makeRequested = vehicleKnowledgeCompact(make);
    return models.map(model => {
      if (makeRequested && ![model.make, ...model.makeAliases].map(vehicleKnowledgeCompact).includes(makeRequested)) return null;
      let score = 0;
      for (const value of [model.model, ...model.aliases]) {
        const compact = vehicleKnowledgeCompact(value); if (!compact) continue;
        if (compact === requested) score = Math.max(score, 100);
        else if (compact.startsWith(requested)) score = Math.max(score, 80 - Math.min(20, compact.length - requested.length));
        else if (compact.includes(requested)) score = Math.max(score, 60 - Math.min(20, compact.indexOf(requested)));
      }
      return score ? {model, score: score + Math.max(0, 11 - Number(model.popularityDecile || 10))} : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.model.make.localeCompare(b.model.make, 'ru') || a.model.model.localeCompare(b.model.model, 'ru')).slice(0, 100).map(row => row.model);
  });
  const exact = matches.filter(model => [model.model, ...model.aliases].some(name => vehicleKnowledgeCompact(name) === requested));
  const selected = exact.length ? exact : matches;
  return selected.length ? selected.flatMap(model => [model.model, ...model.aliases].map(name => ({make: lower(model.make), model: name}))) : makes.map(make => ({make: lower(make), model: query}));
}

function api(receipt) {
  const modelCache = new Map();
  return Object.freeze({receipt, receiptSha256: hash(receipt), cityKeys: receipt.cities.map(row => row.key), cities: receipt.cities, buildRowKeys,
    compileRequest(params = {}) {
      need(!params.market || ['china', 'any'].includes(params.market), 'market');
      const out = {};
      const makes = split(params.make, ',');
      if (makes.length) out.makeKeys = makes.map(lower);
      if (params.model) {
        const cacheKey = JSON.stringify([makes, params.model]);
        let terms = modelCache.get(cacheKey);
        if (!terms) {
          const queries = split(params.model), candidates = queries.flatMap(query => modelCandidates(receipt.models, query, makes));
          terms = receipt.modelPairs.filter(pair => (!makes.length || makes.some(make => lower(make) === lower(pair.make))) &&
            (matchesCatalogModel(pair.model, params.model, pair.make) || candidates.some(candidate => candidate.make === lower(pair.make) && matchesCatalogModel(pair.model, candidate.model, pair.make))))
            .map(pair => chinaModelTerm(pair.make, pair.model));
          if (modelCache.size >= 256) modelCache.delete(modelCache.keys().next().value);
          modelCache.set(cacheKey, terms);
        }
        out.modelTerms = terms;
      }
      if (params.color) out.colorKeys = split(params.color).map(colorKey);
      if (params.fuel) out.fuelKeys = split(params.fuel).flatMap(value => value === 'electrified' ? ['electric', 'hybrid'] : [value.toLowerCase()]);
      for (const field of ['bodyType', 'transmission', 'drive']) if (params[field]) out[field + 'Keys'] = split(params[field]).map(value => value.toLocaleLowerCase('ru-RU'));
      if (params.auctionGrade) out.auctionGradeKeys = split(params.auctionGrade).map(auctionGradeLabel).filter(Boolean);
      for (const field of ['hasPrice', 'budgetFrom', 'budgetTo', 'yearFrom', 'yearTo', 'mileageFrom', 'mileageTo', 'engineFrom', 'engineTo', 'powerFrom', 'powerTo', 'auctionDateFrom', 'auctionDateTo', 'page', 'pageSize'])
        if (params[field] !== undefined && params[field] !== '') out[field] = params[field];
      if (params.city) {
        const normalized = normalizeDeliveryCity(params.city).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
        out.cityKey = receipt.cities.find(row => row.city.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === normalized)?.key ?? CHINA_UNQUOTED_CITY;
      }
      out.sort = normalizedCatalogSort(params.sort) || 'updatedAt';
      return out;
    },
  });
}

/** models must come from the exact runtime's normalized bundled directory;
 * modelPairs are distinct identities of the frozen projected generation. */
export function createChinaQuerySemantics({models, modelPairs, pricingAsOf}) {
  need(Array.isArray(models) && Array.isArray(modelPairs) && Number.isFinite(Date.parse(pricingAsOf)), 'input');
  const receipt = {version: 1, kind: 'china-query-semantics-v1', pricingAsOf, deliveryTariffVersion: DELIVERY_TARIFF_VERSION,
    models: models.map(model => {
      need(model && clean(model.make) && clean(model.model) && Array.isArray(model.aliases ?? []) && Array.isArray(model.makeAliases ?? []), 'model');
      return {make: clean(model.make), model: clean(model.model), aliases: [...(model.aliases || [])], makeAliases: [...(model.makeAliases || [])], popularityDecile: model.popularityDecile ?? null};
    }),
    modelPairs: [...new Map(modelPairs.map(pair => { const restored = restoreSourceModelName(pair); return [chinaModelTerm(restored.make, restored.model), {make: clean(restored.make), model: clean(restored.model)}]; })).values()],
    cities: [{key: CHINA_UNQUOTED_CITY, city: ''}, ...DELIVERY_CITIES.map(city => ({key: city, city}))],
  };
  need(receipt.modelPairs.every(row => row.make && row.model) && receipt.cities.slice(1).every(row => quoteCityDelivery(row.city, 'china').status === 'estimated'), 'directory');
  return api(deepFreeze(receipt));
}

export function openChinaQuerySemantics(receipt, expectedSha256) {
  need(/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') && hash(receipt) === expectedSha256 && receipt?.version === 1 && receipt.kind === 'china-query-semantics-v1', 'receipt');
  need(Array.isArray(receipt.models) && Array.isArray(receipt.modelPairs) && Array.isArray(receipt.cities) && receipt.cities.some(row => row.key === CHINA_UNQUOTED_CITY), 'receipt_shape');
  return api(deepFreeze(structuredClone(receipt)));
}

/** Capture the exact bundled model directory by absolute path before a worker
 * enters its private pricing context. No ambient runtime cache is populated. */
export async function createSemanticSnapshotFromRuntime(runtimeRoot) {
  need(path.isAbsolute(runtimeRoot) && await fs.realpath(runtimeRoot) === runtimeRoot, 'runtime_root');
  const root = path.join(runtimeRoot, 'data/catalog/vehicle-knowledge'), files = [];
  const read = async (file, optional = false) => {
    need(/^[a-zA-Z0-9_.-]+\.json$/.test(file), 'model_filename');
    const filename = path.join(root, file); let raw;
    try {
      const stat = await fs.lstat(filename); need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024 * 1024, 'model_file');
      raw = await fs.readFile(filename);
    } catch (error) {
      if (optional && error?.code === 'ENOENT') { files.push({file, missing: true}); return null; }
      throw error;
    }
    files.push({file, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex')});
    try { return JSON.parse(raw.toString('utf8')); } catch { need(false, 'model_json'); }
  };
  const index = await read('models-index.json', true); let legacy;
  if (index) {
    need(index.version === 1 && Number.isSafeInteger(index.total) && index.total >= 0 && Array.isArray(index.chunks), 'model_index');
    legacy = [];
    for (const chunk of index.chunks) {
      need(chunk && typeof chunk.file === 'string' && Number.isSafeInteger(chunk.count) && chunk.count >= 0, 'model_chunk');
      const rows = await read(chunk.file); need(Array.isArray(rows) && rows.length === chunk.count, 'model_chunk_count'); legacy.push(...rows);
    }
    need(legacy.length === index.total, 'model_total');
  } else legacy = await read('models.json');
  const bridge = await read('v2-bridge-models.json', true) || [];
  need(Array.isArray(legacy) && Array.isArray(bridge), 'model_rows');
  const existing = new Set(legacy.map(row => row.id));
  const validName = (value, min = 2) => { const name = clean(value); return name.length >= min && name.length <= 48 && /[\p{L}\p{N}]/u.test(name) && !/^\[?object object\]?$/i.test(name); };
  const aliases = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[|;,]/)).map(clean).filter(Boolean))];
  const models = [...legacy, ...bridge.filter(row => row?.id && !existing.has(row.id))]
    .filter(row => row && row.id && validName(row.make) && validName(row.model, 1)).map(row => ({...row, make: clean(row.make), model: clean(row.model),
      aliases: aliases(row.aliases), makeAliases: aliases(row.makeAliases), bodyTypes: aliases(row.bodyTypes), countries: aliases(row.countries), regions: aliases(row.regions)}));
  for (const file of files) {
    let raw; try { raw = await fs.readFile(path.join(root, file.file)); } catch (error) { if (file.missing && error?.code === 'ENOENT') continue; throw error; }
    need(!file.missing && raw.length === file.bytes && createHash('sha256').update(raw).digest('hex') === file.sha256, 'runtime_models_changed');
  }
  return {models, files, sha256: hash({models, files})};
}
