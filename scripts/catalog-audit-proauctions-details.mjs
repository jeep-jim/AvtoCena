import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseProAuctionsDetailEvidence } from '../apps/web/lib/catalog/proauctions-detail-evidence.ts';
const input=process.argv[2] || 'tests/fixtures/proauctions';
const output=process.argv[3] || 'proauctions-detail-audit.json';
const rows=[];
for(const name of (await fs.readdir(input)).filter(n=>/^\d+\.html$/.test(n)).sort()){
 const html=await fs.readFile(path.join(input,name),'utf8');
 const sourceUrl=html.match(/rel="canonical" href="([^"]+)"/)?.[1];
 if(!sourceUrl)throw Error('canonical_missing:'+name);
 const parsed=parseProAuctionsDetailEvidence(html,sourceUrl);
 rows.push({...parsed,inputSha256:crypto.createHash('sha256').update(html).digest('hex')});
}
if(!rows.length)throw Error('no_proauctions_details');
const report={source:'proauctions',productionWrites:false,sourceRequests:0,
 checkedAt:new Date().toISOString(),sampleCount:rows.length,
 validPriceCount:rows.filter(r=>r.price.amountJpy>0).length,
 parsedFuelCount:rows.filter(r=>r.specifications.fuel).length,
 sourceFieldConflicts:rows.filter(r=>r.issues.length).length,
 exactCalculationReady:rows.filter(r=>r.calculationBlockers.length===0).length,rows};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,rows:undefined}));
