import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {businessAuthority,predecessorDisposition,exactPriorRow,EDITORIAL_KEY,FX_KEY,CBR_21_NOV,EXPECTED,loadSourceEvidence} from './qualify.mjs';
const now=Date.parse('2026-11-21T04:27:00Z'), hex='a'.repeat(64), sha=b=>createHash('sha256').update(b).digest('hex');
const editorial={key:EDITORIAL_KEY,wireSha256:hex,etagSha256:hex,revision:'R',index:{revision:'R',entries:{}}};
const fx={key:FX_KEY,wireSha256:hex,etagSha256:hex,validThrough:'2026-11-22T00:00:00Z',rates:Object.fromEntries(['AED','USD','EUR'].map(c=>
 [c,{nominal:1,rateDate:CBR_21_NOV.rateDate,cbrRate:CBR_21_NOV[c],rateSource:'cbr'}]))};
const grant={wireSha256:hex,reviewedByAuthorizedBuyer:true,value:{version:1,market:'uae',source:'dubicars_feed',
sourceId:'dubicars_uae_exact',origin:'auto_api_dubicars_v2',destination:'https://avtocena.com',paidContractListingRepublication:true,
paidContractPhotoRepublication:true,verifiedGrantDocumentSha256:hex,validFrom:'2026-11-20T00:00:00Z',validThrough:'2026-11-22T00:00:00Z'}};
test('private exact price/editorial prequalification is not public link or photo permission',()=>{
 const p=businessAuthority({editorial,fx,now});assert.equal(p.canQualifyPrivately,true);assert.equal(p.publication,false);
 assert.equal(p.photos,false);assert.equal(p.canPublish,false);assert.ok(p.blockers.includes('paid_listing_republication_grant_not_verified'));
 assert.equal(businessAuthority({editorial,fx,reviewGrant:grant,now}).photos,true);
 const noGallery={...grant,value:{...grant.value,paidContractPhotoRepublication:false}};
 const q=businessAuthority({editorial,fx,reviewGrant:noGallery,now});assert.equal(q.publication,true);assert.equal(q.photos,false);
});
test('CBR date/currency vector and CRM document must be exact rather than assumed defaults',()=>{
 const wrongFx={...fx,rates:{...fx.rates,AED:{...fx.rates.AED,rateDate:'2026-11-20'}}};
 assert.equal(businessAuthority({editorial,fx:wrongFx,reviewGrant:grant,now}).canQualifyPrivately,false);
 assert.equal(businessAuthority({editorial:null,fx,reviewGrant:grant,now}).canQualifyPrivately,false);
});
test('inactive absent rows retain original observation only within existing policy, never sold',()=>{
 const id='b'.repeat(24), evidence={id,market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:'1037',lastSeenAt:'2026-11-17T00:00:00Z'};
 const decision={id,sourceOfferId:'1037',disposition:'absence_not_sale_requires_comparison'};
 const withinRetention=(row,now)=>now-Date.parse(row.operational.lastSeenAt)<=14*86400000;
 assert.deepEqual(predecessorDisposition({evidence,decision,now,ports:{withinRetention}}),
  {state:'retain_exact_predecessor_not_fresh',observedAt:evidence.lastSeenAt,needsWireRead:true});
 assert.equal(predecessorDisposition({evidence,decision,now:now+14*86400000,ports:{withinRetention}}).state,'expired_policy_not_sold');
 assert.equal(predecessorDisposition({evidence,decision:{...decision,disposition:'provider_explicit_removed_not_sold'},now,ports:{withinRetention}}).state,'removed_not_sold');
});
test('selective predecessor restore refuses substituted body or substituted ordinal',async()=>{
 const row={id:'b'.repeat(24),sourceOfferId:'1037',sourcePrice:20000};
 const wire=Buffer.from(JSON.stringify([row])),key='catalog/generations/gen_1794878284419_a611dfcf/offers/uae/chunk-0001.json';
 const ref={key,rows:1,bytes:wire.length,sha256:sha(wire)};
 const evidence={id:row.id,sourceOfferId:row.sourceOfferId,immutableKey:key,ordinal:0,rowSha256:sha(JSON.stringify(row))};
 assert.deepEqual(await exactPriorRow({ref,evidence,read:async()=>wire}),row);
 await assert.rejects(exactPriorRow({ref,evidence:{...evidence,ordinal:1},read:async()=>wire}),/row_changed/);
 await assert.rejects(exactPriorRow({ref,evidence,read:async()=>Buffer.from(wire.toString().replace('20000','30000'))}),/wire_changed/);
});
test('no held/source-prepared bytes can masquerade as real READY',async()=>{
 await assert.rejects(loadSourceEvidence(async()=>Buffer.from(JSON.stringify({kind:'uae-private-runtime-ready-v1'})),EXPECTED),/exact_source_seal/);
});
