import assert from 'node:assert/strict';
export function validateListPage(xml){
 assert.match(xml,/<ListBucketResult(?:\s|>)/,'invalid_list_response');
 assert.match(xml,/<\/ListBucketResult>\s*$/,'incomplete_list_xml');
 const flags=[...xml.matchAll(/<IsTruncated>(true|false)<\/IsTruncated>/g)];assert.equal(flags.length,1,'missing_pagination_flag');
 const truncated=flags[0][1]==='true',token=xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]||'';
 if(truncated)assert.ok(token,'missing_continuation_token');
 const blocks=xml.match(/<Contents>[\s\S]*?<\/Contents>/g)||[];
 assert.equal((xml.match(/<Contents>/g)||[]).length,blocks.length,'incomplete_contents');
 for(const block of blocks){assert.match(block,/<Key>[^<]+<\/Key>/,'missing_object_key');assert.match(block,/<Size>\d+<\/Size>/,'missing_object_size');assert.match(block,/<LastModified>[^<]+<\/LastModified>/,'missing_object_timestamp');}
 const count=xml.match(/<KeyCount>(\d+)<\/KeyCount>/)?.[1];if(count!==undefined)assert.equal(Number(count),blocks.length,'object_count_mismatch');
 return {truncated,token,count:blocks.length};
}
export async function listCompleteObjects(storage,prefix){
 const original=globalThis.fetch,seen=new Set();let pages=0,final=false,count=0;
 globalThis.fetch=async(input,options)=>{
  const u=new URL(String(input));
  if(u.origin!=='https://s3.regru.cloud'||u.searchParams.get('list-type')!=='2')return original(input,options);
  assert.equal(options?.method||'GET','GET');assert.equal(u.pathname,'/avtocena-staging-8120751');
  assert.equal(u.searchParams.get('prefix'),`migration-staging/full-20261011/${prefix.replace(/\/+$/,'')}`);
  assert.ok(++pages<=1000,'inventory_request_budget');
  const response=await original(input,options);
  if(response.ok){assert.equal(final,false,'unexpected_page_after_final');const page=validateListPage(await response.clone().text());
   if(page.truncated){assert.ok(!seen.has(page.token),'pagination_cycle');seen.add(page.token);}else final=true;
   count+=page.count;
  }
  return response;
 };
 try{const rows=await storage.listObjects(prefix);assert.ok(final&&pages>0,'inventory_not_complete');assert.equal(rows.length,count,'inventory_parse_count_mismatch');return rows;}
 finally{globalThis.fetch=original;}
}
