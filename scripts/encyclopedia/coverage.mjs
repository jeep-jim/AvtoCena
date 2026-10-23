// Inventory the existing permanent records; never discover or create models.
const present = value => value !== undefined && value !== null && value !== '' && value !== 0 && value !== 'unknown';
const increment = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };
const kinds = new Set(['combustion', 'electric', 'series_hybrid', 'other_hybrid']);

export function modelCoverage(record, facts) {
  const compiled = new Map(facts.map(fact => [fact.variantId, fact]));
  const result = {id:record.id, make:record.make, model:record.model, revision:record.revision,
    variants:record.variants.length, withPhoto:Number(Boolean(record.photo)),
    requiredValuesPresent:0, requiredValuesSupported:0, missing:{}, unsupported:{},
    descriptiveMissing:{}, statusCounts:{}, sourceFields:{}, batches:{}};
  for (const row of record.variants) {
    increment(result.statusCounts, row.status || 'unknown');
    const fact = compiled.get(row.id), values = fact?.values || {};
    const required = ['year','trim','fuel','powertrainKind'];
    if (kinds.has(row.powertrainKind)) {
      if (row.powertrainKind !== 'electric') required.push('engineCc');
      required.push('powerHpOrKw');
      if (row.powertrainKind !== 'combustion') required.push('power30MinKw');
    }
    let complete = kinds.has(row.powertrainKind), supported = complete;
    for (const field of required) {
      const has = field === 'powerHpOrKw' ? present(row.powerHp) || present(row.powerKw)
        : field === 'year' ? Number.isInteger(row.year) && row.year >= 1900 && row.year <= new Date().getFullYear()+1
        : field === 'powertrainKind' ? kinds.has(row[field]) : present(row[field]);
      const evidence = field === 'year' || field === 'trim' ? Boolean(fact) && has
        : field === 'powerHpOrKw' ? present(values.powerHp) || present(values.powerKw) : present(values[field]);
      if (!has) { increment(result.missing, field); complete = false; supported = false; }
      else if (!evidence) { increment(result.unsupported, field); supported = false; }
    }
    result.requiredValuesPresent += Number(complete);
    result.requiredValuesSupported += Number(supported);
    for (const field of ['bodyType','transmission','drive','grossVehicleWeightKg']) if (!present(row[field])) increment(result.descriptiveMissing, field);
    for (const source of Object.values(fact?.sources || {})) {
      increment(result.sourceFields, source.kind);
      if (source.batchId) increment(result.batches, source.batchId);
    }
  }
  return result;
}

export function summarizeCoverage(models, context) {
  const brands = new Map();
  for (const model of models) {
    const row = brands.get(model.make) || {make:model.make,models:0,variants:0,requiredValuesPresent:0,requiredValuesSupported:0,missing:{},unsupported:{}};
    row.models++; row.variants += model.variants;
    row.requiredValuesPresent += model.requiredValuesPresent; row.requiredValuesSupported += model.requiredValuesSupported;
    for (const field of ['missing','unsupported']) for (const [key,count] of Object.entries(model[field])) row[field][key]=(row[field][key]||0)+count;
    brands.set(model.make,row);
  }
  return {version:1,...context,
    scope:'Existing permanent encyclopedia only; required field coverage is not proof of exact offer matching or a completed price calculation.',
    total:{brands:brands.size,models:models.length,variants:models.reduce((n,m)=>n+m.variants,0),
      requiredValuesPresent:models.reduce((n,m)=>n+m.requiredValuesPresent,0),requiredValuesSupported:models.reduce((n,m)=>n+m.requiredValuesSupported,0)},
    brands:[...brands.values()].sort((a,b)=>a.make.localeCompare(b.make,'en')),
    models:[...models].sort((a,b)=>(a.make+' '+a.model).localeCompare(b.make+' '+b.model,'en'))};
}
