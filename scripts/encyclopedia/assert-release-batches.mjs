import fs from 'node:fs/promises';
import {readCalculationIndex} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
const paths=marker.requiredResearchBatches||[];
if(!Array.isArray(paths)||paths.length>64)throw Error('invalid_required_batches');
if(paths.length){
 const index=readCalculationIndex();if(!index)throw Error('release_index_missing');
 const facts=new Map(Object.values(index.models).flat().map(f=>[`${f.modelId}:${f.variantId}`,f]));
 let fields=0;const variants=new Set();
 for(const path of paths){
  if(!/^docs\/encyclopedia\/batches\/[a-z0-9-]+\.json$/.test(path))throw Error('invalid_batch_path');
  const b=JSON.parse(await fs.readFile(path,'utf8'));
  for(const e of b.entries){const fact=facts.get(`${e.modelId}:${e.variantId}`);if(!fact||fact.year!==e.year)throw Error('required_variant_missing:'+e.variantId);
   for(const field of e.confirmedFields){
    const source=fact.sources[field];const expectedKind=e.source.type==='owner_confirmed'?'manual':e.source.type;
    if(JSON.stringify(fact.values[field])!==JSON.stringify(e.patch[field])||source?.batchId!==b.id||source.kind!==expectedKind||source.url!==e.source.url)throw Error('required_field_or_provenance_missing:'+e.variantId+':'+field);
    fields++;
   }
   variants.add(`${e.modelId}:${e.variantId}`);
  }
 }
 console.log(JSON.stringify({stage:'required_research_batches_verified',indexDigest:index.digest,batches:paths.length,variants:variants.size,fields}));
}
