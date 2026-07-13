import { readOffers, buildChunks, calculate, validate } from './catalog-lib.mjs';
const cmd=process.argv[2];
if(cmd==='catalog:import'){ const mod= await import('./catalog-import.mjs'); }
else if(cmd==='catalog:import:all'){ const enabled=['goo-net-exchange','encar','autohome','dubicars','mobile-de'].map(id=>({id,status:'operational_manual',mode:'manual-import'})); console.log(JSON.stringify({enabled, note:'Only operational_manual adapters run from approved JSON/CSV exports in this environment.'},null,2)); }
else if(cmd==='catalog:validate'){ const offers=readOffers(); const report=offers.map(o=>({id:o.id, errors:validate(o)})).filter(r=>r.errors.length); console.log(JSON.stringify({validated:offers.length,rejected:report.length,report},null,2)); process.exit(report.length?1:0); }
else if(cmd==='catalog:recalculate'){ const next=readOffers().map(o=>calculate(o)); buildChunks(next); console.log(JSON.stringify({recalculated:next.length},null,2)); }
else if(cmd==='catalog:expire'){ const now=Date.now(); const next=readOffers().map(o=> now-new Date(o.lastCheckedAt).getTime()>14*864e5 ? {...o, availability:'stale'}:o); buildChunks(next); console.log(JSON.stringify({expired:next.filter(o=>o.availability==='stale').length,total:next.length},null,2)); }
else if(cmd==='catalog:build-indexes'){ const offers=readOffers(); buildChunks(offers); console.log(JSON.stringify({indexed:offers.length},null,2)); }
else { console.log('Commands: catalog:import catalog:import:all catalog:validate catalog:recalculate catalog:expire catalog:build-indexes'); }
