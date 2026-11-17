import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const pages=[...new Set([1,2,684,1330,3007,10123,10198,...Array.from({length:32},(_,i)=>1+Math.floor(i*10197/31))])].sort((a,b)=>a-b);
export function validateActualFullpriceSamples(manifest,sourceReportBytes){
 assert.equal(createHash('sha256').update(sourceReportBytes).digest('hex'),manifest.sourceReportByteSha256,'sample_report_bytes');const report=JSON.parse(sourceReportBytes);
 assert.equal(manifest.sourceRun,'44077945953');assert.equal(manifest.sourceSha,'695f96d9918e30badd479e2033a906d126cd8f3e');assert.equal(report.sourceSha,manifest.sourceSha);assert.deepEqual(manifest.treePins,report.treePins);assert.equal(manifest.snapshotSha256,report.snapshotSha256);assert.equal(manifest.snapshotSha256,'c34e0546b1214a3829b7b6317f87c2ff3be05ff8bc9cd7c0ec5db0e212b7ac43');assert.equal(manifest.snapshotRoot,'catalog/intake-staging/encar/43989797288/1');assert.equal(manifest.snapshotProducerSha,'e51f589f892babdcd6c1251e1ebb06c6d7c91e6d');assert.equal(manifest.publicationAcceptance,false);assert.equal(manifest.selectionResolutionPerformed,false);assert.equal(report.pages,37);assert.deepEqual(manifest.samplePages,pages);
 assert.ok(Array.isArray(manifest.entries)&&manifest.entries.length===16);const ids=new Set(),coords=new Set();
 const priorities=report.samples.filter(s=>s.issues.includes('DATE_LOSS_CHANGES_CUSTOMS')).slice(0,10);assert.equal(priorities.length,10);
 for(const [i,e] of manifest.entries.entries()){
  assert.deepEqual(Object.keys(e).sort(),['coordinate','identitySha256','rawSha256','tags']);for(const h of [e.identitySha256,e.rawSha256])assert.match(h,/^[a-f0-9]{64}$/);assert.ok(!ids.has(e.identitySha256));ids.add(e.identitySha256);const key=JSON.stringify(e.coordinate);assert.ok(!coords.has(key));coords.add(key);assert.ok(pages.includes(e.coordinate.page)&&Number.isInteger(e.coordinate.row)&&e.coordinate.row>=1&&e.coordinate.row<=20);
  const actual=report.samples.find(s=>s.coordinate.page===e.coordinate.page&&s.coordinate.row===e.coordinate.row);assert.ok(actual,'sample_not_in_report');assert.equal(e.rawSha256,actual.rawSha256);assert.equal(e.identitySha256,actual.identitySha256);
  const tags=i<10?['monetary_delta']:i<12?['unchanged_older_ice_control']:[['conflict_hold'],['age_band_only'],['hybrid_hold'],['electric_hold']][i-12];if(actual.issues.includes('DATE_LOSS_CHANGES_AGE_BAND'))tags.push('reported_age_band_change');assert.deepEqual(e.tags,tags);
  if(i<10)assert.deepEqual(e.coordinate,priorities[i].coordinate);
  else if(i<12){assert.deepEqual(e.coordinate,{page:1,row:i===10?1:4});assert.equal(actual.stratum,'combustion');assert.equal(actual.technical.engine.status,'ready');assert.ok(actual.technical.engine.ageMonths>60);assert.ok(!actual.issues.includes('DATE_LOSS_CHANGES_CUSTOMS')&&!actual.issues.includes('DATE_LOSS_CHANGES_AGE_BAND'));}
  else if(i===12){assert.deepEqual(e.coordinate,{page:2632,row:4});assert.ok(actual.issues.includes('SOURCE_ICE_POWER_PRESENT_NORMALIZED_ABSENT'));}
  else if(i===13){assert.ok(actual.issues.includes('DATE_LOSS_CHANGES_AGE_BAND'));assert.ok(!actual.issues.includes('DATE_LOSS_CHANGES_CUSTOMS'));}
  else assert.equal(actual.stratum,i===14?'other_hybrid':'electric');
 }
 return {verified:true,samples:16,monetary:10,unchangedOlderIce:2,variety:4};
}
