import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const sha=value=>createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const GEN=/^[A-Za-z0-9_-]{1,128}$/;
const MAX_GZIP=64*1024*1024,MAX_TEXT=192*1024*1024,MAX_MEMBERSHIP=128*1024*1024;
const HEADER='\uFEFFid,title,description,link,image_link,availability,price,brand,identifier_exists,product_type\n';
const SOURCE_KEY='catalog/public/feeds/openai-products.csv.gz';
const MARKETS=new Set(['china','korea','japan','uae','europe','georgia','green']);
const fail=why=>{throw Error('uae_ai_feed:'+why);};

function eligibleUaeFeedRow(row,generationId){
 // Existing native CSV expects an actual product image, not a placeholder.
 // Never accept arbitrary HTTPS, supplier secrets, private keys or proxy URLs.
 try{
  const link=new URL(row.link),image=new URL(row.image);
  const card=/^\/cars\/offer\/([^/]+)(?:\/[^/]+)?$/.exec(link.pathname);
  if(link.origin!=='https://avtocena.com'||link.username||link.password||link.hash||
     !card||decodeURIComponent(card[1])!==row.id)return false;
  if(link.search&&(link.searchParams.size!==2||link.searchParams.get('market')!=='uae'||
     link.searchParams.get('preparedCut')!==generationId))return false;
  if(image.username||image.password||image.search||image.hash)return false;
  if(image.origin==='https://www.dubicars.com')
   return image.pathname.startsWith('/images/')&&/\.(?:jpe?g|png|webp|avif)$/i.test(image.pathname);
  return image.origin==='https://avtocena.com'&&
   (/^\/api\/site-media\/[a-f0-9]{64}$/.test(image.pathname)||
    /^\/api\/catalog\/images\/[a-f0-9]{32}$/.test(image.pathname));
 }catch{return false;}
}
function* nativeRows(csv){
 if(!csv.startsWith(HEADER))fail('schema');
 if(csv===HEADER+'\n')return; // Exact native empty export.
 let at=HEADER.length;
 // The existing builder writes all ten cells quoted, escaping quotes by
 // doubling them. Bound the input; parse fields rather than search the
 // free-text "рынок: uae" phrase (titles and URLs can contain it).
 while(at<csv.length){
  const start=at;
  const values=new Map();
  for(let col=0;col<10;col++){
   if(csv[at++]!=='"')fail('row_csv');
   const body=at;
   while(true){
    const end=csv.indexOf('"',at);
    if(end<0)fail('unterminated_cell');
    if(csv[end+1]==='"'){at=end+2;continue;}
    if([0,3,4,5,6].includes(col))values.set(col,csv.slice(body,end).replaceAll('""','"'));
    at=end+1;break;
   }
   if(csv[at++]!==(col===9?'\n':','))fail('row_shape');
  }
  const id=values.get(0);
  if(!id||id.length>256||at-start>128*1024)fail('row_bound');
  yield {id,record:csv.slice(start,at),link:values.get(3),image:values.get(4),availability:values.get(5),price:values.get(6)};
 }
}

// No process/env lookup, network, file or PUT. Caller must obtain the
// approved legacy metadata/membership and verify/storage-scope separately.
export function prepareUaeExcludedAiFeed({legacyMetadata,gzipBytes,membershipBytes,expectedMembershipSha256,approvedReplacement}){
 const m=legacyMetadata;
 if(!m||m.version!==1||m.publicationPolicy!=='2026-10-13'||!GEN.test(m.generationId??'')||
    m.objectPath!==SOURCE_KEY||m.format!=='google-compatible-csv-gzip'||!HASH.test(m.checksum??'')||
    !Number.isSafeInteger(m.productCount)||m.productCount<0||!Buffer.isBuffer(gzipBytes)||
    gzipBytes.length<1||gzipBytes.length>MAX_GZIP||gzipBytes.length!==m.size||sha(gzipBytes)!==m.checksum)fail('base_feed');
 if(!Buffer.isBuffer(membershipBytes)||membershipBytes.length<1||membershipBytes.length>MAX_MEMBERSHIP||
    !HASH.test(expectedMembershipSha256??'')||sha(membershipBytes)!==expectedMembershipSha256)fail('membership_digest');
 const decode=buffer=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);
 const proof=JSON.parse(decode(membershipBytes));
 if(proof?.version!==1||proof.kind!=='uae-ai-feed-generation-membership-v1'||proof.generationId!==m.generationId||
    !Array.isArray(proof.rows)||proof.rows.length<m.productCount||proof.rows.length>1000000)fail('membership_scope');
 const marketById=new Map();
 for(const row of proof.rows){
  if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!row[0]||row[0].length>256||
     !MARKETS.has(row[1])||marketById.has(row[0]))fail('membership_row');
  marketById.set(row[0],row[1]);
 }
 const csv=decode(gunzipSync(gzipBytes,{maxOutputLength:MAX_TEXT}));
 const seen=new Set(),legacyUaeIds=new Set(),retained=[HEADER];let removed=0,replaced=0,newlyAdded=0;
 let replacement=null;
 if(approvedReplacement){
  const {receiptBytes,expectedReceiptSha256,uaeGzip,expectedOwnReadySha256}=approvedReplacement;
  if(!Buffer.isBuffer(receiptBytes)||receiptBytes.length>MAX_MEMBERSHIP||!HASH.test(expectedReceiptSha256??'')||
     sha(receiptBytes)!==expectedReceiptSha256||!Buffer.isBuffer(uaeGzip)||uaeGzip.length>MAX_GZIP||
     !HASH.test(expectedOwnReadySha256??''))fail('replacement_authority');
  const r=JSON.parse(decode(receiptBytes));
  if(r?.version!==1||r.kind!=='uae-ai-feed-approved-replacement-v1'||
     r.baseGenerationId!==m.generationId||r.baseSha256!==m.checksum||!GEN.test(r.uaeGenerationId??'')||
     r.uaeReadySha256!==expectedOwnReadySha256||!HASH.test(r.pricingReceiptSha256??'')||
     !HASH.test(r.dispositionReceiptSha256??'')||!HASH.test(r.replacementSha256??'')||sha(uaeGzip)!==r.replacementSha256||
     !Array.isArray(r.currentEligibleIds)||r.currentEligibleIds.length>250000||!Array.isArray(r.legacyUae)||
     r.legacyUae.length>250000)fail('replacement_scope');
  const eligible=new Set(r.currentEligibleIds);
  if(eligible.size!==r.currentEligibleIds.length||[...eligible].some(id=>typeof id!=='string'||!id||id.length>256||
      (marketById.has(id)&&marketById.get(id)!=='uae')))fail('replacement_membership');
  const dispositions=new Map();
  for(const entry of r.legacyUae){
   if(!entry||!['retain','replace','explicitly_withdrawn','no_longer_product_eligible'].includes(entry.disposition)||
      typeof entry.id!=='string'||!entry.id||!HASH.test(entry.evidenceSha256??'')||
      marketById.get(entry.id)!=='uae'||dispositions.has(entry.id))fail('replacement_disposition');
   dispositions.set(entry.id,entry.disposition);
  }
  const rows=new Map();
  for(const row of nativeRows(decode(gunzipSync(uaeGzip,{maxOutputLength:MAX_TEXT})))){
   if(!eligible.has(row.id)||rows.has(row.id)||row.availability!=='in_stock'||
      !/^[1-9][0-9]{0,11} RUB$/.test(row.price)||!eligibleUaeFeedRow(row,r.uaeGenerationId))fail('replacement_csv');
   rows.set(row.id,row.record);
  }
  if(rows.size!==eligible.size)fail('replacement_membership');
  replacement={rows,dispositions,readySha256:r.uaeReadySha256,receiptSha256:expectedReceiptSha256};
 }
 for(const {id,record} of nativeRows(csv)){
  if(seen.has(id)||!marketById.has(id))fail('row_identity');
  seen.add(id);
  if(marketById.get(id)!=='uae'){retained.push(record);continue;}
  legacyUaeIds.add(id);
  if(!replacement){removed++;continue;}
  const next=replacement.rows.get(id),transition=replacement.dispositions.get(id);
  if(transition==='retain'&&next===record)retained.push(record);
  else if(transition==='replace'&&next){retained.push(next);replaced++;}
  else if(['explicitly_withdrawn','no_longer_product_eligible'].includes(transition)&&!next)removed++;
  else fail('replacement_unresolved_legacy');
 }
 if(seen.size!==m.productCount)fail('base_row_count');
 if(replacement){
  if(replacement.dispositions.size!==legacyUaeIds.size)fail('replacement_unresolved_legacy');
  for(const [id,record] of replacement.rows)if(!legacyUaeIds.has(id)){retained.push(record);newlyAdded++;}
 }
 const uncompressed=Buffer.from(retained.length===1?HEADER+'\n':retained.join(''),'utf8');
 const identical=removed===0&&replaced===0&&newlyAdded===0;
 const data=identical?gzipBytes:gzipSync(uncompressed,{level:9});
 return {data,receipt:Object.freeze({
  version:1,kind:'uae-filtered-ai-feed-v1',baseGenerationId:m.generationId,baseSha256:m.checksum,
  baseMembershipSha256:expectedMembershipSha256,baseProductCount:m.productCount,
  legacyUaeRows:legacyUaeIds.size,removedUaeRows:removed,replacedUaeRows:replaced,newUaeRows:newlyAdded,
  productCount:seen.size-removed+newlyAdded,sha256:sha(data),size:data.length,
  uncompressedSha256:sha(uncompressed),identicalLegacyBinary:identical,
  inspectionOnly:!replacement&&legacyUaeIds.size>0,
  ...(replacement?{uaeReadySha256:replacement.readySha256,approvedReplacementReceiptSha256:replacement.receiptSha256}:{}),
 })};
}
