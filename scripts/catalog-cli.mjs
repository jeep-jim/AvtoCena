import fs from 'node:fs';
const cmd=process.argv[2];
const offers=()=>JSON.parse(fs.readFileSync('data/catalog/offers/offers.json','utf8'));
if(cmd==='catalog:import') await import('./catalog-import.mjs');
else if(cmd==='catalog:import:all') console.log('Manual adapters registered; run catalog:import for approved exports.');
else if(cmd==='catalog:validate'){ const bad=offers().filter(o=>!o.id||!o.sourceUrl||!o.coverImage); console.log(`validated=${offers().length} bad=${bad.length}`); process.exit(bad.length?1:0); }
else if(cmd==='catalog:recalculate') console.log('Recalculation uses production business settings via apps/web/lib/catalog/calculation.ts');
else if(cmd==='catalog:expire') console.log('Expiration pipeline available in apps/web/lib/catalog/pipeline.ts');
else if(cmd==='catalog:build-indexes'){ const list=offers(); fs.writeFileSync('data/catalog/offers/offers-index.json', JSON.stringify({version:1,collection:'offers',maxRecordsPerChunk:500,total:list.length,updatedAt:new Date().toISOString(),chunks:[{file:'offers.json',count:list.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]},null,2)); console.log('indexes built'); }
else { console.log('Commands: catalog:import catalog:import:all catalog:validate catalog:recalculate catalog:expire catalog:build-indexes'); }
