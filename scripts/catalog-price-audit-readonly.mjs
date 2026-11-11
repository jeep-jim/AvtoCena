import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { readDataJson, getJsonStorage } from '../apps/web/lib/data.ts';
import { REQUIRED_CATALOG_SOURCES, isAllowedCatalogSourceUrl } from '../apps/web/lib/catalog/required-catalog-sources.ts';

// Diagnostic only: no adapter collection, cursors, publication or storage writes.
const storage = getJsonStorage();
if (storage.driver !== 'object') throw Error('production_readonly_audit_requires_object_storage');
for (const name of ['writeJson', 'putBinary', 'deleteJson', 'deleteBinary', 'deleteObjects', 'deletePrefix']) {
  storage[name] = async () => { throw Error('price_audit_is_read_only'); };
}
const manifest = await readDataJson('catalog/manifest.json', null);
if (!manifest) throw Error('missing_catalog_manifest');
const manifestHash = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const preferred = new Set(['6c1196761fab6417e6dbcfb2', '0a2f2ab601ddac3c17bfb580', 'b923ba40a0055a4bb5665398', 'c31d7d7bc5dd69e0a40952a4']);
const report = {checkedAt:new Date().toISOString(), generationId:manifest.generationId, mode:'read_only', sources:[]};
await fs.mkdir('price-audit-evidence', {recursive:true});
for (const market of ['korea', 'china', 'uae', 'europe', 'georgia']) {
  const counts = {}, pools = {};
  for (const chunk of manifest.markets?.[market]?.chunks || []) {
    const path = chunk.startsWith('catalog/') ? chunk : `catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
    const rows = await readDataJson(path, []);
    for (const row of rows) {
      if (row.market !== market) throw Error('unexpected_market');
      counts[row.sourceId] = (counts[row.sourceId] || 0) + 1;
      const pool = pools[row.sourceId] ||= [];
      if (pool.some(x => x.id === row.id)) continue;
      if (preferred.has(row.id)) pool.unshift(row);
      else if (pool.length < 3) pool.push(row);
      pool.splice(3);
    }
  }
  for (const source of REQUIRED_CATALOG_SOURCES[market]) {
    const entry = {market, sourceId:source.sourceId, publishedCount:counts[source.sourceId] || 0, samples:[]};
    for (const row of pools[source.sourceId] || []) {
      const snap = row.calculationSnapshot || {};
      const sample = {id:row.id, sourceOfferId:row.sourceOfferId, make:row.make,model:row.model,year:row.year,
        sourceUrl:row.operational?.sourceUrl, sourcePrice:row.sourcePrice, sourceCurrency:row.sourceCurrency,
        updatedAt:row.updatedAt, totalRub:row.totalRub,sellerPriceRub:row.sellerPriceRub,
        calculationStatus:row.calculationStatus, currencyRate:snap.currencyRate,
        sourcePriceRub:snap.sourcePriceRub,breakdown:snap.breakdown,customsInput:snap.customsInput,
        priceIncludesAllCustoms:snap.priceIncludesAllCustoms};
      if (isAllowedCatalogSourceUrl(market,source.sourceId,sample.sourceUrl)) {
        try {
          let url = sample.sourceUrl;
          if (source.sourceId === 'kcar_korea_open') {
            const id = new URL(url).searchParams.get('i_sCarCd');
            if (id) url = `https://api.kcar.com/bc/car-info-detail-of-ng?i_sCarCd=${encodeURIComponent(id)}&i_sPassYn=N`;
          }
          const response = await fetch(url,{headers:{accept:'application/json,text/html', 'user-agent':'AvtoCenaPriceAudit/1.0'},signal:AbortSignal.timeout(25000)});
          const body = await response.text();
          const file = `${market}-${source.sourceId}-${row.id}.txt`;
          await fs.writeFile(`price-audit-evidence/${file}`,body);
          sample.liveSource = {requestedUrl:url,finalUrl:response.url,status:response.status,bytes:body.length,evidenceFile:file,sha256:crypto.createHash('sha256').update(body).digest('hex')};
        } catch (error) { sample.liveSource = {error:String(error.message)}; }
      } else sample.liveSource = {error:'missing_or_unapproved_exact_source_url'};
      entry.samples.push(sample);
      console.log('PRICE_AUDIT_SAMPLE ' + JSON.stringify({market,sourceId:source.sourceId,...sample}));
    }
    report.sources.push(entry);
    console.log('PRICE_AUDIT_SOURCE ' + JSON.stringify({market,sourceId:source.sourceId,publishedCount:entry.publishedCount,samples:entry.samples.length}));
  }
}
const after = await readDataJson('catalog/manifest.json',null);
report.manifestUnchanged = manifestHash === crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex');
report.japanReadOrWritten = false;
await fs.writeFile('price-audit-evidence/report.json',JSON.stringify(report,null,2));
if (!report.manifestUnchanged) throw Error('catalog_generation_changed_during_audit');
