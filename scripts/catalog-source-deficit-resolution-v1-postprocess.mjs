import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const INPUT=process.env.CATALOG_SOURCE_DEFICIT_RESOLUTION_OUTPUT||'catalog-source-deficit-resolution-v1.json';
const PRIOR='data/catalog/source-deficit-recon-v1-summary.json';

function uniqRows(rows){const seen=new Set();const out=[];for(const row of rows){const k=JSON.stringify(row);if(seen.has(k))continue;seen.add(k);out.push(row);}return out;}

export function normalizeUnitContexts(summary){
  const unit=summary?.unitEvidence||{};
  const contexts=[...(unit.ccEvidence||[]),...(unit.engineLiterMatches||[]),...(unit.powerEvidence||[])].map(x=>String(x.context||''));
  const cc=[]; const hp=[];
  for(const text of contexts){
    for(const m of text.matchAll(/\b(\d{1,2}(?:,\d{3})+|\d{3,5})\s*(cc|cm3|cm³)\b/gi)) cc.push({value:Number(m[1].replace(/,/g,'')),unit:m[2],context:text.slice(0,500)});
    for(const m of text.matchAll(/\b(\d{2,4})\s*(?:마력|BHP|HP|PS)\b/gi)) hp.push({value:Number(m[1]),unit:m[2]||'마력',context:text.slice(0,500)});
  }
  return {ccEvidence:uniqRows(cc).slice(0,20),powerEvidence:uniqRows(hp).slice(0,20)};
}

function priorFor(prior,sourceId,offerId){const s=(prior.sources||[]).find(x=>x.sourceId===sourceId);if(!s)return null;if(sourceId==='dubicars_uae_exact')return s.embeddedOfferEvidence?.[offerId]||null;if(sourceId==='bobaedream_korea_candidate')return (s.galleryEvidence?.samples||[]).find(x=>x.sourceOfferId===offerId)||null;return null;}

export function annotateResult(result,prior){
  for(const side of ['first','second']){
    const s=result[side]?.summary;if(!s)continue;
    s.normalizedUnitEvidence=normalizeUnitContexts(s);
  }
  const p=priorFor(prior,result.sourceId,result.offerId);
  const first=result.first?.summary||{};
  const annotation={};
  if(result.sourceId==='bobaedream_korea_candidate'){
    annotation.gallery={status:p?.galleryClusterImageIdentities>=5?'strong_offer_bound_candidate':'unproven',stableSeries:p?.stableSeriesAcrossRepeats||null,priorCount:p?.galleryClusterImageIdentities||null};
    annotation.body='unresolved_after_discovered_spec_route_probe';
  }
  if(result.sourceId==='dubicars_uae_exact'){
    const expected=Number(p?.imageCount||0);const observed=Number(first.galleryProof?.[0]?.uniqueUnderlyingCount||0);
    annotation.gallery={status:expected>=5&&observed===expected?'exact_count_match_candidate':observed>expected&&expected>0?'contaminated_window':'unproven',expectedImageCount:expected||null,observedWindowUnderlyingCount:observed||null};
  }
  if(result.sourceId==='carswitch_uae_candidate'){
    annotation.engineLiterExplicit=Boolean(first.unitEvidence?.engineLiterMatches?.length);
    annotation.exactEngineCc=Boolean(first.normalizedUnitEvidence?.ccEvidence?.length);
    annotation.offerPowerHp=Boolean(first.normalizedUnitEvidence?.powerEvidence?.length||first.unitEvidence?.powerEvidence?.length);
  }
  if(result.sourceId==='cars24_uae_candidate'){
    annotation.offerPriceExactCandidate=Boolean(first.priceEvidence?.visibleHits?.length&&first.priceEvidence?.embeddedContexts?.length);
    annotation.engineLiterExplicit=Boolean(first.unitEvidence?.engineLiterMatches?.length);
    annotation.exactEngineCc=Boolean(first.normalizedUnitEvidence?.ccEvidence?.length);
    annotation.offerPowerHp=Boolean(first.normalizedUnitEvidence?.powerEvidence?.length||first.unitEvidence?.powerEvidence?.length);
  }
  result.annotation=annotation;return result;
}

export async function runPostprocess(){
  const [payload,prior]=await Promise.all([fs.readFile(INPUT,'utf8').then(JSON.parse),fs.readFile(PRIOR,'utf8').then(JSON.parse)]);
  payload.version=2;payload.postprocessed=true;payload.results=(payload.results||[]).map(r=>annotateResult(r,prior));
  payload.interpretation='Explicit litres are source evidence but are not silently converted to exact cc. CARS24 price requires visible offer price plus embedded offer context. DubiCars gallery is not closed when the bounded window contains more underlying UUIDs than source image_count.';
  await fs.writeFile(INPUT,JSON.stringify(payload,null,2));
  console.log(JSON.stringify({output:INPUT,version:payload.version,postprocessed:payload.postprocessed},null,2));return payload;
}

const entry=process.argv[1]?pathToFileURL(process.argv[1]).href:'';if(entry===import.meta.url)runPostprocess().catch(e=>{console.error(e);process.exitCode=1});
