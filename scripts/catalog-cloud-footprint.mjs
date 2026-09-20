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
const measuredImages=new Map();
async function inventory(measure=false) {
  const images=await list(registry,'images',{registryId},'images');
  const revisions=await list(containers,'revisions',{folderId:folder},'revisions');
  if(measure){
    let next=0;
    await Promise.all(Array.from({length:4},async()=>{while(next<images.length){
      const index=next++,image=images[index];
      if(Array.isArray(image.layers))continue;
      try{
        const detail=measuredImages.get(image.id)||await request(registry+'images/'+encodeURIComponent(image.id));
        if(detail.id!==image.id||detail.digest!==image.digest)throw Error('image_measurement_identity_mismatch');
        measuredImages.set(image.id,detail);
        images[index]={...image,config:detail.config,layers:detail.layers};
      }catch(error){console.warn('Registry byte measurement unavailable for image '+image.id+': '+String(error.message));}
    }}));
  }
  return {images,revisions};
}
const measured=await inventory(true);
const disks=await list('https://compute.api.cloud.yandex.net/compute/v1/','disks',{folderId:folder},'disks');
const instances=await list('https://compute.api.cloud.yandex.net/compute/v1/','instances',{folderId:folder},'instances');
const report={checkedAt:new Date().toISOString(),folderId:folder,registryBytes:uniqueRegistryBytes(measured.images),registryImages:measured.images.length,allocatedDiskBytes:disks.reduce((n,d)=>n+Number(d.size||0),0),disks:disks.map(d=>({id:d.id,name:d.name,size:Number(d.size),status:d.status,typeId:d.typeId})),instances:instances.map(i=>({id:i.id,name:i.name,status:i.status,bootDiskId:i.bootDisk?.diskId,secondaryDiskIds:i.secondaryDisks?.map(d=>d.diskId)||[]})),scope:'All Container Registry images and Compute disks in the configured project folder; bucket measured separately',productionWritten:false};
await fs.writeFile('cloud-footprint.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
