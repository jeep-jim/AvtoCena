import crypto from 'node:crypto';
import {yandexJsonRequest} from './lib/yandex-json-request.mjs';
import {waitForYandexOperation} from './lib/yandex-operation.mjs';
import fs from 'node:fs/promises';
import {registryRetentionPlan, uniqueRegistryBytes, WEB_REPOSITORY} from './lib/registry-retention.mjs';
const apply = process.argv.includes('--apply');
const registry = 'https://container-registry.api.cloud.yandex.net/container-registry/v1/';
const containers = 'https://serverless-containers.api.cloud.yandex.net/containers/v1/';
const folder = 'b1g9vq73onqb7dp5hgqg';
const registryId = 'crp73he0q1blh1mujo4s';
const key = JSON.parse(process.env.YC_SA_JSON_CREDENTIALS || '{}');
const now = Math.floor(Date.now()/1000);
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const iam = 'https://iam.api.cloud.yandex.net/iam/v1/tokens';
const unsigned = enc({alg:'PS256',typ:'JWT',kid:key.id})+'.'+enc({iss:key.service_account_id,aud:iam,iat:now,exp:now+3600});
const signature = crypto.sign('sha256',Buffer.from(unsigned),{key:key.private_key.slice(key.private_key.indexOf('-----BEGIN')),padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url');
const tokenResponse = await fetch(iam,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jwt:unsigned+'.'+signature}),signal:AbortSignal.timeout(30000)});
if (!tokenResponse.ok) throw new Error(`IAM failed: ${tokenResponse.status}`);
const {iamToken} = await tokenResponse.json();
async function request(url, method='GET') {
  return yandexJsonRequest(url,{method,token:iamToken});
}
async function list(base, path, params, field) {
  const rows=[]; const seen=new Set(); let pageToken='';
  do {
    const query=new URLSearchParams({...params,pageSize:'1000',...(pageToken?{pageToken}:{})});
    const page=await request(base+path+'?'+query);
    if (page[field] !== undefined && !Array.isArray(page[field])) throw new Error('Malformed inventory');
    rows.push(...(page[field] || []));
    pageToken=page.nextPageToken || '';
    if (pageToken && seen.has(pageToken)) throw new Error('Inventory pagination loop');
    seen.add(pageToken);
  } while(pageToken);
  return rows;
}
async function inventory() {
  const images=await list(registry,'images',{registryId},'images');
  const revisions=await list(containers,'revisions',{folderId:folder},'revisions');
  return {images,revisions};
}
const before=await inventory();
const plan=registryRetentionPlan(before.images,before.revisions);
const doomed=new Set(plan.candidates.map(x=>x.id));
const report={createdAt:new Date().toISOString(),apply,...plan,uniqueBlobBytesBefore:uniqueRegistryBytes(before.images),estimatedUniqueBlobBytesAfter:uniqueRegistryBytes(before.images.filter(x=>!doomed.has(x.id))),deleted:0};
await fs.writeFile('registry-cleanup-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({apply,repository:WEB_REPOSITORY,images:plan.images,retained:plan.retained,candidates:plan.candidates.length,uniqueBlobBytesBefore:report.uniqueBlobBytesBefore,estimatedUniqueBlobBytesAfter:report.estimatedUniqueBlobBytesAfter,protectedRevisions:plan.protectedRevisions}));
if (apply) {
  // The workflow shares deployment concurrency; re-check source-of-truth revisions before each batch as an extra guard against manual rollbacks.
  for (let start=0;start<plan.candidates.length;start+=20) {
    const current=await inventory();
    const allowed=new Set(registryRetentionPlan(current.images,current.revisions).candidates.map(x=>x.id));
    const batch=plan.candidates.slice(start,start+20);
    for(let offset=0;offset<batch.length;offset+=4) {
      const results=await Promise.allSettled(batch.slice(offset,offset+4).map(async image=>{
        if (!allowed.has(image.id)) throw new Error(`Retention changed before deletion: ${image.id}`);
        const operation=await request(registry+'images/'+encodeURIComponent(image.id),'DELETE');
        await waitForYandexOperation(operation,request);
        report.deleted++;
      }));
      await fs.writeFile('registry-cleanup-report.json',JSON.stringify(report,null,2)+'\n');
      const failed=results.find(result=>result.status==='rejected');
      if(failed)throw failed.reason;
    }
    console.log(`Deleted ${report.deleted}/${plan.candidates.length} obsolete web images`);
    await fs.writeFile('registry-cleanup-report.json',JSON.stringify(report,null,2)+'\n');
  }
  const after=await inventory();
  registryRetentionPlan(after.images,after.revisions);
  report.uniqueBlobBytesAfter=uniqueRegistryBytes(after.images);
  report.remainingWebImages=after.images.filter(x=>x.name===WEB_REPOSITORY).length;
  report.completedAt=new Date().toISOString();
  await fs.writeFile('registry-cleanup-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({deleted:report.deleted,remainingWebImages:report.remainingWebImages,uniqueBlobBytesAfter:report.uniqueBlobBytesAfter}));
}
