import fs from 'node:fs/promises';
import {hasAstraPower30Evidence} from '../../apps/web/lib/encyclopedia/astra-power30-evidence.ts';

// A small public sample, never an estimate of full-market price coverage.
const release=process.env.EXPECTED_RELEASE_SHA;
if(!/^[a-f0-9]{40}$/.test(release||''))throw Error('expected_release_required');
const get=async path=>{
 const r=await fetch('https://avtocena.com'+path,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error('public_http_'+r.status);
 return r.json();
};
const health=await get('/api/health');
if(health.releaseSha!==release)throw Error('release_not_active');
const checks=[['BYD','Dolphin'],['BYD','Han'],['Audi','Q4 e-tron']];
const samples=[];
for(const [make,model] of checks){
 const query=new URLSearchParams({market:'china',make,model,pageSize:'5',sort:'updatedAt'});
 const result=await get('/api/catalog/search?'+query);
 samples.push({make,model,total:result.total,items:(result.items||[]).map(o=>({
  id:o.id,year:o.year,make:o.make,model:o.model,powerHp:o.powerHp??null,power30MinKw:o.power30MinKw??null,
  boundAstraEvidence:hasAstraPower30Evidence(o),indexDigest:o.astraPower30Evidence?.indexDigest??null,
  totalRub:o.totalRub??null,catalogPricingMode:o.catalogPricingMode,calculationStatus:o.calculationStatus,
  publicSpecificationVerified:o.publicSpecificationVerified===true,
 }))});
}
if((await get('/api/health')).releaseSha!==release)throw Error('release_changed');
const knownBefore=new Set(['0ab3b53b5338cb40bdf0230a','eedab0e27d2a726ba0a39c9f','d8b1a03af933519286866c4b']);
const comparison=samples[0].items.filter(o=>knownBefore.has(o.id));
const report={version:1,checkedAt:new Date().toISOString(),release,calculationVersion:health.calculationVersion,
 scope:'Public sample only; complete technical fields and full delivered prices are separate measures.',samples,
 dolphinBeforeAfter:{sameIds:comparison.length,beforeWith30:0,beforeWithDeliveredPrice:0,
  afterWithBound30:comparison.filter(o=>o.boundAstraEvidence&&o.power30MinKw===35).length,
  afterWithDeliveredPrice:comparison.filter(o=>Number(o.totalRub)>0&&o.catalogPricingMode!=='seller'&&o.publicSpecificationVerified).length},
 verified:comparison.length===3&&comparison.every(o=>o.boundAstraEvidence&&o.power30MinKw===35)};
await fs.mkdir('reports',{recursive:true});
await fs.writeFile('reports/worldwide-electrified-public.json',JSON.stringify(report,null,2)+'\n');
console.log('WORLDWIDE_PUBLIC_VERIFICATION',JSON.stringify(report));
if(!report.verified)throw Error('public_bound_power30_sample_failed');
