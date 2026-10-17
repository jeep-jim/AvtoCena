import fs from 'node:fs/promises';
import path from 'node:path';
import { jptradeSavedOffer } from '../apps/web/lib/catalog/jptrade-saved-import.ts';
const input=process.env.JPTRADE_SAVED_DIR || 'saved-jptrade/jptrade';
const verification=process.env.JPTRADE_IMAGE_VERIFICATION || 'saved-jptrade-images/jptrade-image-verification.jsonl';
const output=process.env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
const checked=new Map((await fs.readFile(verification,'utf8')).trim().split('\n').map(line=>{const r=JSON.parse(line);return [r.sourceId,r];}));
const records=new Map();
for(const file of (await fs.readdir(input)).filter(name=>/^part-.*\.json$/.test(name)).sort()) {
  for(const row of JSON.parse(await fs.readFile(path.join(input,file),'utf8')))records.set(row.sourceId,row);
}
const candidates=[...records.values()].map(row=>jptradeSavedOffer(row,checked.get(row.sourceId))).filter(Boolean);
// A decoded photo shared between different lot IDs is not sufficient identity evidence.
const owners=new Map();
for(const row of candidates) for(const img of row.operational.raw.decodedGallery) {
  const ids=owners.get(img.decodedSha256)||new Set();ids.add(row.sourceOfferId);owners.set(img.decodedSha256,ids);
}
const offers=candidates.filter(row=>row.operational.raw.decodedGallery.every(img=>owners.get(img.decodedSha256).size===1));
await fs.mkdir(output,{recursive:true});
for(let i=0;i<offers.length;i+=250)await fs.writeFile(path.join(output,`catalog-rebuild-japan-${String(i/250+1).padStart(4,'0')}.json`),JSON.stringify({market:'japan',offers:offers.slice(i,i+250)}));
const report={sourceRunId:35167936226,records:records.size,withinRetentionAndImageBound:candidates.length,crossLotImageRejected:candidates.length-offers.length,prepared:offers.length,automaticPowerFilled:0,published:false};
await fs.writeFile('jptrade-conversion.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(!offers.length)throw Error('no_verified_jptrade_candidates');
