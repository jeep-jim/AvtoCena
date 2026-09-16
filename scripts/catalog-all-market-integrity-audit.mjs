import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { readDataJson, getJsonStorage } from '../apps/web/lib/data.ts';
import { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } from '../apps/web/lib/catalog/specification-evidence-audit.ts';
import { catalogPowerSanity } from '../apps/web/lib/catalog/power-sanity.ts';
import { combustionPowerMismatch } from '../apps/web/lib/catalog/combustion-power-consistency.ts';
import { isSellerPricedOffer } from '../apps/web/lib/catalog/seller-price-contract.ts';
import { REQUIRED_CATALOG_SOURCES, isAllowedCatalogSourceUrl } from '../apps/web/lib/catalog/required-catalog-sources.ts';

const storage = getJsonStorage();
if (storage.driver !== 'object') throw Error('production_audit_requires_object_storage');
for (const key of ['writeJson', 'putBinary', 'deleteJson', 'deleteBinary', 'deleteObjects', 'deletePrefix']) {
  storage[key] = async () => { throw Error('audit_is_read_only'); };
}
const manifest = await readDataJson('catalog/manifest.json', null);
if (!manifest?.generationId) throw Error('missing_manifest');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const startHash = hash(manifest);
const out = 'all-market-audit';
await fs.mkdir(out, {recursive: true});
const report = {checkedAt: new Date().toISOString(), generationId: manifest.generationId,
  scope: 'All stored records in the pinned published manifest; live source and image checks are explicitly sampled',
  markets: {}, errors: [], sourceChecks: [], imageChecks: [], productionWritten: false};
const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };
const samples = new Map();
for (const market of ['korea', 'china', 'uae', 'europe', 'georgia', 'japan']) {
  const stats = {rows:0, uniqueIds:0, uniqueSourceIds:0, sources:{}, issues:{}, evidence:{}, powerProvenance:{}, chunks:0};
  const seen = new Set(), sourceIds = new Set();
  report.markets[market] = stats;
  for (const chunk of manifest.markets?.[market]?.chunks || []) {
    const key = chunk.startsWith('catalog/') ? chunk : `catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
    const rows = await readDataJson(key, null);
    if (!Array.isArray(rows)) {report.errors.push({market,key,error:'missing_or_invalid_chunk'});continue;}
    const issues = [];
    stats.chunks++;
    for (const row of rows) {
      stats.rows++;
      const reasons=[];
      if (seen.has(row.id)) reasons.push('duplicate_id');
      seen.add(row.id);
      const sourceIdentity = `${row.sourceId}:${row.sourceOfferId}`;
      if (sourceIds.has(sourceIdentity)) reasons.push('duplicate_source_id');
      sourceIds.add(sourceIdentity);
      inc(stats.sources, row.sourceId || 'missing');
      inc(stats.powerProvenance, row.powerDataSource || 'missing');
      if (row.market !== market) reasons.push('wrong_market');
      if (!row.id || !row.sourceOfferId || !row.make || !row.model) reasons.push('missing_identity');
      if (!Number.isInteger(row.year) || row.year < (market==='japan'?2010:2020) || row.year>new Date().getUTCFullYear()+1) reasons.push('year_out_of_scope');
      const age = Date.now()-Date.parse(row.updatedAt);
      if (!Number.isFinite(age) || age< -86400000) reasons.push('invalid_updated_date');
      else if (age > (market==='japan'?31:14)*86400000) reasons.push('stale_record');
      if (row.status && row.status !== 'active') reasons.push('not_active');
      if (!(row.sourcePrice>0) || !/^[A-Z]{3}$/.test(row.sourceCurrency || '')) reasons.push('invalid_source_price');
      const urls=(row.images || []).map(x=>x?.url).filter(x=>typeof x==='string' && /^https:\/\//.test(x));
      if (new Set(urls).size<2) reasons.push('fewer_than_two_distinct_image_urls');
      if (urls.length!==new Set(urls).size) reasons.push('duplicate_image_urls');
      const sanity=catalogPowerSanity(row);
      if (sanity.suspicious) reasons.push(sanity.reason);
      if (combustionPowerMismatch(row)) reasons.push('combustion_derived_power_mismatch');
      for (const field of SPECIFICATION_AUDIT_FIELDS) {
        const result=classifySpecificationEvidence(row,field);
        inc(stats.evidence,`${field}:${result.state}:${result.provenance}`);
        if (['conflict','ambiguous'].includes(result.state)) reasons.push(`${field}:${result.reason}`);
      }
      const seller=isSellerPricedOffer(row);
      if (row.catalogPricingMode==='seller' && !seller) reasons.push('invalid_seller_price_contract');
      if (row.totalRub>0 && sanity.suspicious) reasons.push('delivered_price_uses_unverified_power');
      if (row.totalRub>0 && combustionPowerMismatch(row)) reasons.push('delivered_price_power_mismatch');
      const breakdown=row.calculationSnapshot?.breakdown;
      if (row.totalRub>0 && Array.isArray(breakdown) && breakdown.length) {
        const sum=breakdown.reduce((n,x)=>n+Number(x.amountRub||0),0);
        if (!Number.isFinite(sum) || Math.abs(sum-row.totalRub)>5) reasons.push('breakdown_total_mismatch');
      }
      const summary={id:row.id,sourceId:row.sourceId,sourceOfferId:row.sourceOfferId,market,make:row.make,model:row.model,trim:row.trim,year:row.year,engineCc:row.engineCc,powerHp:row.powerHp,powerKw:row.powerKw,fuel:row.fuel,powerDataSource:row.powerDataSource,sourcePrice:row.sourcePrice,sourceCurrency:row.sourceCurrency,totalRub:row.totalRub,sellerPriceRub:row.sellerPriceRub,updatedAt:row.updatedAt,sourceUrl:row.operational?.sourceUrl,imageUrls:urls.slice(0,3)};
      if(reasons.length){for(const reason of new Set(reasons))inc(stats.issues,reason);issues.push({...summary,reasons:[...new Set(reasons)]});}
      const pool=samples.get(row.sourceId)||[];
      if(pool.length<3 || (reasons.includes('delivered_price_uses_unverified_power') && !pool.some(x=>x.problem))) {
        pool.push({...summary,problem:reasons.includes('delivered_price_uses_unverified_power')});samples.set(row.sourceId,pool);
      }
    }
    if(issues.length)await fs.writeFile(`${out}/${market}-${stats.chunks}-issues.json`,JSON.stringify(issues));
  }
  stats.uniqueIds=seen.size;stats.uniqueSourceIds=sourceIds.size;
  stats.requiredSourceCounts=Object.fromEntries((REQUIRED_CATALOG_SOURCES[market]||[]).map(x=>[x.sourceId,stats.sources[x.sourceId]||0]));
  console.log('MARKET_AUDIT '+JSON.stringify({market,...stats}));
  await fs.writeFile(`${out}/summary.json`,JSON.stringify(report,null,2));
}
// Sampling is diagnostic; an inaccessible source is never classified as sold.
for(const pool of samples.values())for(const row of pool){
  const result={id:row.id,market:row.market,sourceId:row.sourceId,sourceOfferId:row.sourceOfferId,sourceUrl:row.sourceUrl};
  try{
    if(!isAllowedCatalogSourceUrl(row.market,row.sourceId,row.sourceUrl))throw Error('missing_or_unapproved_source_url');
    let url=row.sourceUrl;
    if(row.sourceId==='kcar_korea_open')url=`https://api.kcar.com/bc/car-info-detail-of-ng?i_sCarCd=${encodeURIComponent(row.sourceOfferId)}&i_sPassYn=N`;
    const response=await fetch(url,{headers:{accept:'application/json,text/html','user-agent':'AvtoCenaIntegrityAudit/1.0'},signal:AbortSignal.timeout(15000)});
    const body=await response.text();result.httpStatus=response.status;result.sha256=hash(body);result.bytes=body.length;
    if(row.sourceId==='kcar_korea_open' && response.ok){
      let d=JSON.parse(body).data;d=d?.data||d;
      result.sourceReportsSold=/판매완료/.test(d?.message||'');
      result.exactSourceId=d?.rvo?.carCd;result.storedPower=row.powerHp;result.sourceHrspow=d?.rvo?.hrspow;
      result.storedPrice=row.sourcePrice;result.sourcePrice=d?.rvo?.salprc?Number(d.rvo.salprc)*10000:undefined;
    }
  }catch(error){result.error=String(error.message);}
  report.sourceChecks.push(result);
  console.log('SOURCE_SAMPLE '+JSON.stringify(result));
  await fs.writeFile(`${out}/summary.json`,JSON.stringify(report,null,2));
}
report.manifestUnchanged=startHash===hash(await readDataJson('catalog/manifest.json',null));
await fs.writeFile(`${out}/summary.json`,JSON.stringify(report,null,2));
console.log('AUDIT_COMPLETE '+JSON.stringify({generationId:report.generationId,manifestUnchanged:report.manifestUnchanged,errors:report.errors,sourceChecks:report.sourceChecks.length}));
if(report.errors.length)process.exitCode=1;
