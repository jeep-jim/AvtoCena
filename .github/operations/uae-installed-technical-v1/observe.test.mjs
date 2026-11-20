import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {inspectIndex,release} from './observe.mjs';
const fixture=()=>{
 const models={private_vehicle:[{year:2024,values:{engineCc:12,powerHp:8,fuel:'private-value'},
   sources:{engineCc:{kind:'manufacturer',url:'https://private-url'},powerHp:{kind:'owner_reference',markets:['china']},fuel:{kind:'manual',markets:['uae']}}}]};
 return {version:1,models,digest:createHash('sha256').update(JSON.stringify(models)).digest('hex')};
};
test('structural only report, explicit tagged fields separate from general and no raw content',()=>{
 const x=fixture(),out=inspectIndex(x,release,x.digest);
 assert.equal(out.uaeTaggedFacts,1);assert.equal(out.uaeFields.fuel,1);assert.equal(out.uaeFields.powerHp,0);
 assert.equal(out.annualWithCrossMarketReferenceNotUae,1);assert.equal(out.actualListingBindingVerified,false);
 assert.doesNotMatch(JSON.stringify(out),/private_vehicle|private-url|private-value/);
});
test('reject mismatched release, bound metadata or actual content independently',()=>{
 const x=fixture();assert.throws(()=>inspectIndex(x,'wrong',x.digest),/release_mismatch/);
 assert.throws(()=>inspectIndex(x,release,'wrong'),/manifest_mismatch/);
 x.models.private_vehicle[0].year+=1;assert.throws(()=>inspectIndex(x,release,x.digest),/content_mismatch/);
});
