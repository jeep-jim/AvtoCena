// Copy this file and sibling MJS into tests/ of the isolated exact app checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {buildAiProductFeed,AI_PRODUCT_FEED_PATH} from '../apps/web/lib/ai-discovery';
import {prepareUaeExcludedAiFeed} from './prepare-uae-excluded-ai-feed.mjs';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('historic native CSV bytes and product eligibility survive independent UAE discovery selection',()=>{
 const germany:any={id:'eu-150',market:'europe',year:2022,make:'Make, Europe',model:'Car "A"',totalRub:1200000,cardImageUrl:'https://example.test/eu.jpg'};
 const ga:any={...germany,id:'ga-6',market:'georgia',make:'Georgia (uae) unaffected'};
 const ae:any={...germany,id:'uae-900',market:'uae'};
 const seller:any={...ae,id:'uae-seller',totalRub:null,publicVisibleRub:0,sellerPriceRub:2000000};
 const generationId='gen_fixture_legacy',rows=[germany,ae,ga,seller];
 const base=buildAiProductFeed({generationId,items:rows}),neighbors=buildAiProductFeed({generationId,items:[germany,ga]});
 assert.equal(base.productCount,3);
 const membershipBytes=Buffer.from(JSON.stringify({version:1,kind:'uae-ai-feed-generation-membership-v1',generationId,
  rows:rows.map(({id,market})=>[id,market])}));
 const data=prepareUaeExcludedAiFeed({legacyMetadata:{version:1,publicationPolicy:'2026-10-13',objectPath:AI_PRODUCT_FEED_PATH,
  generationId,format:'google-compatible-csv-gzip',productCount:base.productCount,size:base.data.length,checksum:hash(base.data)},
  gzipBytes:base.data,membershipBytes,expectedMembershipSha256:hash(membershipBytes)});
 assert.equal(data.receipt.inspectionOnly,true);
 assert.equal(data.receipt.removedUaeRows,1);
 assert.deepEqual(gunzipSync(data.data),gunzipSync(neighbors.data));
});
