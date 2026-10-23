// Inventory the existing permanent records; never discover or create models.
const present = value => value !== undefined && value !== null && value !== '' && value !== 0 && value !== 'unknown';
const increment = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };
const kinds = new Set(['combustion', 'electric', 'series_hybrid', 'other_hybrid']);
const kindOf = value => {
 const token=String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 return ({ice:'combustion',bev:'electric',hev:'other_hybrid',phev:'other_hybrid',erev:'series_hybrid',reev:'series_hybrid',otherhybrid:'other_hybrid',serieshybrid:'series_hybrid'})[token]||token;
};

const groups = () => Object.fromEntries(['combustion','hybrid','electric','unknown'].map(key=>[key,{variants:0,requiredValuesPresent:0,requiredValuesSupported:0,power30MinPresent:0,power30MinSupported:0,missing:{},unsupported:{},examples:[]}]));
const groupOf = kind => kind==='combustion'?'combustion':kind==='electric'?'electric':['series_hybrid','other_hybrid'].includes(kind)?'hybrid':'unknown';
export function modelCoverage(record, facts) {
  const compiled = new Map(facts.map(fact => [fact.variantId, fact]));
  const result = {id:record.id, make:record.make, model:record.model, revision:record.revision,
    variants:record.variants.length, withPhoto:Number(Boolean(record.photo)),
    requiredValuesPresent:0, requiredValuesSupported:0, missing:{}, unsupported:{},
    byPowertrain:groups(), descriptiveMissing:{}, statusCounts:{}, sourceFields:{}, batches:{}};
  for (const row of record.variants) {
    increment(result.statusCounts, row.status || 'unknown');
    const fact = compiled.get(row.id), values = fact?.values || {};
    const required = ['year','trim','fuel','powertrainKind'], kind=kindOf(row.powertrainKind);
    if (kinds.has(kind)) {
      if (kind !== 'electric') required.push('engineCc');
      required.push('powerHpOrKw');
      if (kind !== 'combustion') required.push('power30MinKw');
    }
    const group=result.byPowertrain[groupOf(kind)];group.variants++;
    group.power30MinPresent+=Number(present(row.power30MinKw));
    group.power30MinSupported+=Number(present(values.power30MinKw));
    const gaps=[];
    let complete = kinds.has(kind), supported = complete;
    for (const field of required) {
      const has = field === 'powerHpOrKw' ? present(row.powerHp) || present(row.powerKw)
        : field === 'year' ? Number.isInteger(row.year) && row.year >= 1900 && row.year <= new Date().getFullYear()+1
        : field === 'powertrainKind' ? kinds.has(kind) : present(row[field]);
      const evidence = field === 'year' || field === 'trim' ? Boolean(fact) && has
        : field === 'powerHpOrKw' ? present(values.powerHp) || present(values.powerKw) : present(values[field]);
      if (!has) { increment(result.missing, field); increment(group.missing,field); gaps.push(field); complete = false; supported = false; }
      else if (!evidence) { increment(result.unsupported, field); increment(group.unsupported,field); gaps.push(field); supported = false; }
    }
    group.requiredValuesPresent+=Number(complete);group.requiredValuesSupported+=Number(supported);
    if(!supported&&group.examples.length<3)group.examples.push({variantId:row.id,year:row.year,trim:row.trim,missingSupportedFields:gaps});
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
  const brands = new Map(), byPowertrain=groups();
  for (const model of models) {
    for(const [key,source] of Object.entries(model.byPowertrain||{})){
      const target=byPowertrain[key];
      for(const field of ['variants','requiredValuesPresent','requiredValuesSupported','power30MinPresent','power30MinSupported'])target[field]+=source[field];
      for(const field of ['missing','unsupported'])for(const [name,n] of Object.entries(source[field]))target[field][name]=(target[field][name]||0)+n;
    }
    const row = brands.get(model.make) || {make:model.make,models:0,variants:0,requiredValuesPresent:0,requiredValuesSupported:0,missing:{},unsupported:{}};
    row.models++; row.variants += model.variants;
    row.requiredValuesPresent += model.requiredValuesPresent; row.requiredValuesSupported += model.requiredValuesSupported;
    for (const field of ['missing','unsupported']) for (const [key,count] of Object.entries(model[field])) row[field][key]=(row[field][key]||0)+count;
    brands.set(model.make,row);
  }
  for(const group of Object.values(byPowertrain)){
    group.remaining=group.variants-group.requiredValuesSupported;
    group.completePercent=group.variants?Math.round(group.requiredValuesSupported/group.variants*10000)/100:null;
    group.remainingPercent=group.variants?Math.round(group.remaining/group.variants*10000)/100:null;
    delete group.examples;
  }
  return {version:3,...context,byPowertrain,
    scope:'Existing permanent encyclopedia only; required field coverage is not proof of exact offer matching or a completed price calculation.',
    total:{brands:brands.size,models:models.length,variants:models.reduce((n,m)=>n+m.variants,0),
      requiredValuesPresent:models.reduce((n,m)=>n+m.requiredValuesPresent,0),requiredValuesSupported:models.reduce((n,m)=>n+m.requiredValuesSupported,0)},
    brands:[...brands.values()].sort((a,b)=>a.make.localeCompare(b.make,'en')),
    models:[...models].sort((a,b)=>(a.make+' '+a.model).localeCompare(b.make+' '+b.model,'en'))};
}
