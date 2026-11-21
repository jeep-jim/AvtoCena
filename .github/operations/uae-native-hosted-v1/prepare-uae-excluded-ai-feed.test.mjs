import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {prepareUaeExcludedAiFeed} from './prepare-uae-excluded-ai-feed.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const H='\uFEFFid,title,description,link,image_link,availability,price,brand,identifier_exists,product_type\n';
const row=(id,description)=>[id,'One, "two"',description,'https://example.test/car','https://example.test/car.jpg','in_stock','420 RUB','A','no','Vehicles > Cars'].map(v=>'"'+v.replaceAll('"','""')+'"').join(',')+'\n';
function fixture(rows,records,g='gen_fixture'){
 const gzipBytes=gzipSync(H+records.join(''));
 const legacyMetadata={version:1,publicationPolicy:'2026-10-13',generationId:g,objectPath:'catalog/public/feeds/openai-products.csv.gz',
  format:'google-compatible-csv-gzip',size:gzipBytes.length,checksum:hash(gzipBytes),productCount:records.length};
 const membershipBytes=Buffer.from(JSON.stringify({version:1,kind:'uae-ai-feed-generation-membership-v1',generationId:g,rows}));
 return {legacyMetadata,gzipBytes,membershipBytes,expectedMembershipSha256:hash(membershipBytes)};
}
test('only exact UAE ID removed; every neighbor byte/order and escaping retained',()=>{
 const cn=row('china-17','title, рынок: uae\nnext line'),ge=row('geo-"10','Γεωργία «Грузия»'),uae=row('uae-2','similar market: korea');
 const arg=fixture([['china-17','china'],['uae-2','uae'],['geo-"10','georgia'],['unpublished-3','uae']],[cn,uae,ge]);
 const output=prepareUaeExcludedAiFeed(arg);
 assert.deepEqual(gunzipSync(output.data),Buffer.from(H+cn+ge));
 assert.equal(output.receipt.removedUaeRows,1);assert.equal(output.receipt.productCount,2);
 assert.equal(output.receipt.baseSha256,arg.legacyMetadata.checksum);
 assert.equal(output.receipt.sha256,hash(output.data));
 assert.deepEqual(output,prepareUaeExcludedAiFeed(arg));
});
test('proven zero UAE gives exact original compressed bytes, not a regenerated neighbor asset',()=>{
 const arg=fixture([['k-1','korea'],['not-in-legacy-feed','uae']],[row('k-1','quoted')]);
 const output=prepareUaeExcludedAiFeed(arg);
 assert.equal(output.receipt.identicalLegacyBinary,true);
 assert.equal(output.data,arg.gzipBytes);
});
test('bad bounds, receipt, market identity and generation refuse publishable output',()=>{
 const arg=fixture([['geo','georgia']],[row('geo','description')]);
 const tries=[
  [{...arg,expectedMembershipSha256:'0'.repeat(64)},/membership_digest/],
  [{...arg,legacyMetadata:{...arg.legacyMetadata,generationId:'other'}},/membership_scope/],
  [{...arg,legacyMetadata:{...arg.legacyMetadata,productCount:0}},/base_row_count/],
  [fixture([['unknown','uae']],[row('geo','broken')]),/row_identity/],
  [fixture([['geo','uae'],['geo','georgia']],[row('geo','ambiguous')]),/membership_row/],
  [fixture([['geo','georgia'],['x','uae']],[row('geo','dup'),row('geo','dup')]),/row_identity/],
  [fixture([['geo','georgia']],['"geo",not-quoted\n']),/row_csv|row_shape/],
  [{...arg,gzipBytes:Buffer.concat([arg.gzipBytes,Buffer.from('tamper')])},/base_feed/],
 ];
 for(const [input,error] of tries)assert.throws(()=>prepareUaeExcludedAiFeed(input),error);
});

test('approval-bound same-schema current rows retain legitimate UAE, replace/retire only by disposition',()=>{
 const native=(id,description)=>row(id,description).replace('https://example.test/car"','https://avtocena.com/cars/offer/'+id+'"').replace('https://example.test/car.jpg','https://www.dubicars.com/images/car.jpg');
 const keep=native('keep','verified current'),swap=native('swap','old price');
 const gone=native('gone','old'),geo=row('geo','market wording mixed with UAE');
 const arg=fixture([['keep','uae'],['swap','uae'],['gone','uae'],['geo','georgia']],[keep,swap,geo,gone]);
 const replace=native('swap','exact new price'),newRow=native('new','current eligible');
 const ready='a'.repeat(64),evidence='b'.repeat(64);
 const uaeGzip=gzipSync(H+newRow+keep+replace);
 const raw={version:1,kind:'uae-ai-feed-approved-replacement-v1',
  baseGenerationId:arg.legacyMetadata.generationId,baseSha256:arg.legacyMetadata.checksum,
  uaeGenerationId:'gen_uae_accepted',uaeReadySha256:ready,pricingReceiptSha256:evidence,
  dispositionReceiptSha256:evidence,replacementSha256:hash(uaeGzip),currentEligibleIds:['new','keep','swap'],
  legacyUae:[{id:'keep',disposition:'retain',evidenceSha256:evidence},
   {id:'swap',disposition:'replace',evidenceSha256:evidence},
   {id:'gone',disposition:'explicitly_withdrawn',evidenceSha256:evidence}]};
 const attach=(receipt,gzip=uaeGzip)=>{
  const receiptBytes=Buffer.from(JSON.stringify(receipt));
  return {...arg,approvedReplacement:{receiptBytes,expectedReceiptSha256:hash(receiptBytes),uaeGzip:gzip,expectedOwnReadySha256:ready}};
 };
 const out=prepareUaeExcludedAiFeed(attach(raw));
 assert.deepEqual(gunzipSync(out.data),Buffer.from(H+keep+replace+geo+newRow));
 assert.deepEqual([out.receipt.inspectionOnly,out.receipt.removedUaeRows,out.receipt.replacedUaeRows,out.receipt.newUaeRows],[false,1,1,1]);
 assert.equal(prepareUaeExcludedAiFeed(arg).receipt.inspectionOnly,true);
 assert.throws(()=>prepareUaeExcludedAiFeed(attach({...raw,legacyUae:raw.legacyUae.slice(0,2)})),/replacement_unresolved_legacy/);
 assert.throws(()=>prepareUaeExcludedAiFeed(attach({...raw,legacyUae:[...raw.legacyUae.slice(0,1),{...raw.legacyUae[1],disposition:'retain'},raw.legacyUae[2]]})),/replacement_unresolved_legacy/);
 assert.throws(()=>prepareUaeExcludedAiFeed(attach({...raw,uaeReadySha256:evidence})),/replacement_scope/);
 for(const unsafe of [
  newRow.replace('www.dubicars.com','other.example'),
  newRow.replace('https://www.dubicars.com/images/car.jpg','https://avtocena.com/api/catalog/photo/token?url=unsafe'),
  newRow.replace('/cars/offer/new','/cars/offer/different'),
  newRow.replace('/cars/offer/new','/cars/offer/new?market=uae&preparedCut=gen_stale'),
 ]){
  const bytes=gzipSync(H+unsafe+keep+replace);
  assert.throws(()=>prepareUaeExcludedAiFeed(attach({...raw,replacementSha256:hash(bytes)},bytes)),/replacement_csv/);
 }
});


test('zero records reuses exact native double-newline header and reports correct digest',()=>{
 const arg=fixture([],[]);
 arg.gzipBytes=gzipSync(H+'\n');
 arg.legacyMetadata={...arg.legacyMetadata,size:arg.gzipBytes.length,checksum:hash(arg.gzipBytes)};
 const out=prepareUaeExcludedAiFeed(arg);
 assert.equal(out.data,arg.gzipBytes);
 assert.equal(out.receipt.uncompressedSha256,hash(Buffer.from(H+'\n')));
});
