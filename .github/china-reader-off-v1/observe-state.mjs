import {createHash,createHmac} from 'node:crypto';
const h='s3.regru.cloud',b='avtocena-staging-8120751',p='migration-staging/full-20261011';
const key='catalog/independent-market-public-v1/china/control.json',oldSha='4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038';
const access=process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secret=process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
const hash=x=>createHash('sha256').update(x).digest('hex'),mac=(k,s)=>createHmac('sha256',k).update(s).digest();
async function get(k,query,cap){
 if(!access||!secret)throw Error('credentials');
 const pathname='/'+b+(k?'/'+p+'/'+k:'');
 const t=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=t.slice(0,8),scope=day+'/us-east-1/s3/aws4_request';
 const a={host:h,'x-amz-content-sha256':hash(''),'x-amz-date':t};const n=Object.keys(a).sort().join(';');
 const req=['GET',pathname,query,Object.keys(a).sort().map(k=>k+':'+a[k]+'\n').join(''),n,hash('')].join('\n');
 const signing=mac(mac(mac(mac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
 a.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+n+', Signature='+mac(signing,['AWS4-HMAC-SHA256',t,scope,hash(req)].join('\n')).toString('hex');
 const x=await fetch('https://'+h+pathname+(query?'?'+query:''),{headers:a,method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
 let bytes=0,arr=[];for await(const v of x.body??[]){bytes+=v.length;if(bytes>cap)throw Error('response_bound');arr.push(v)}
 return {status:x.status,body:Buffer.concat(arr),etag:x.headers.get('etag')};
}
try{
 const a=await get(key,'',65536),g=await get('catalog/manifest.json','',1048576),z=await get(key,'',65536);
 const absent=a.status===404&&z.status===404&&a.etag===z.etag;
 const stable=a.status===z.status&&a.etag===z.etag&&(absent||a.body.equals(z.body));
 let classification='unknown';
 if(stable&&absent)classification='absent';
 else if(stable&&a.status===200){
  const o=JSON.parse(a.body);
  classification=JSON.stringify(o.active??{}).includes('gen_1795166586455_china44710087159')?'exact_candidate_active':
   JSON.stringify(o.active??{}).includes('gen_1794878284419_a611dfcf')?'legacy_ref_active':'other_or_unidentified_active';
 }
 console.log(JSON.stringify({kind:'after_china_switch_scoped_state',storageWrites:0,ownHttp:a.status,stable,
  classification,ownSha:absent?hash('null'):a.status===200?hash(a.body):null,legacyPublicHttp:g.status,
  legacyMatches:g.status===200&&hash(g.body)===oldSha}));
}catch{console.log(JSON.stringify({kind:'after_china_switch_scoped_state',storageWrites:0,error:'signed_read_refused'}));}
try{
 const x=await fetch('https://avtocena.com/api/health',{headers:{'cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(10000)});
 let n=0,v=[];for await(const b of x.body??[]){n+=b.length;if(n>65536)throw Error('bounded');v.push(b);}
 const body=Buffer.concat(v);
 console.log(JSON.stringify({kind:'after_china_switch_public_tls',http:x.status,
 incumbent:body.includes('83ff17075e9188dcf227c8752dc064248d5f42e0'),
 candidate:body.includes('85296f6b8797aaa93227b69da7e9e9e928e8f9b5')}));
}catch{console.log(JSON.stringify({kind:'after_china_switch_public_tls',error:'public_read_refused'}));}
