import {createHash} from 'node:crypto';

export const CHINA_PRIVATE_STAGE_PREFIX='catalog/private-market-stage-v1/china/';
export const CHINA_BUCKET_GUARD_LIMIT=64*1024;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const failure=(code:string):never=>{throw Error('china_private_stage_privacy:'+code);};

/** Accept only the ordinary S3 canonical-owner full-control-only ACL.
 * Unknown XML, absent/ambiguous grants, and any group/cross-owner grant fail closed.
 * Text is never logged and entity declarations are intentionally unsupported. */
export function chinaOwnerOnlyAcl(xml:string):string {
 const compact=xml.trim().replace(/^<\?xml version="1\.0"(?: encoding="(?:UTF-8|utf-8)")?\?>\s*/,'');
 const display='(?:<DisplayName>[^<&]*<\\/DisplayName>)?';
 const id='([a-zA-Z0-9_.:@-]{1,256})';
 const ownerFields='<ID>'+id+'<\\/ID>'+display;
 const acl=new RegExp('^<AccessControlPolicy(?: xmlns="http://s3\\.amazonaws\\.com/doc/2006-03-01/")?>\\s*<Owner>\\s*'+
  ownerFields+'\\s*</Owner>\\s*<AccessControlList>\\s*<Grant>\\s*'+
  '<Grantee xmlns:xsi="http://www\\.w3\\.org/2001/XMLSchema-instance" xsi:type="CanonicalUser">\\s*'+ownerFields+
  '\\s*</Grantee>\\s*<Permission>FULL_CONTROL</Permission>\\s*</Grant>\\s*</AccessControlList>\\s*</AccessControlPolicy>$');
 const m=acl.exec(compact.replace(/>\s+</g,'><'));
 if(!m||m[1]!==m[2])return failure('owner_only_acl_required');
 return m[1];
}
export function chinaNonGrantingBucketPolicy(status:number,body:string):string {
 if(status===404&&/^\s*(?:<\?xml version="1\.0"(?: encoding="(?:UTF-8|utf-8)")?\?>\s*)?<Error>\s*<Code>NoSuchBucketPolicy<\/Code>[\s\S]*<\/Error>\s*$/.test(body))
  return sha('verified-absent-bucket-policy');
 if(status!==200)return failure('bucket_policy_unverified');
 // Deliberately don't attempt to implement IAM evaluation for arbitrary Allows,
 // conditions, principals, wildcard actions and resources. Such buckets need a
 // provider-enforced private constraint instead of an optimistic local parser.
 // Reject duplicate JSON keys as well: JSON.parse alone silently keeps the last.
 let value:any;
 try{
  const keys=new Set<string>();
  // Policies with repeated names (even across otherwise permitted statements)
  // conservatively fail; common no-policy and a single deny remain supported.
  const tokens=body.match(/"(?:[^"\\]|\\.)*"\s*:/g)??[];
  for(const token of tokens){
   const key=JSON.parse(token.slice(0,token.lastIndexOf(':')).trim());
   if(keys.has(key))return failure('duplicate_policy_keys');
   keys.add(key);
  }
  value=JSON.parse(body);
 }catch{return failure('bucket_policy_unverified');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['Version','Id','Statement'].includes(k))||
    value.Version!=='2012-10-17')return failure('bucket_policy_unverified');
 const statements=Array.isArray(value.Statement)?value.Statement:[value.Statement];
 if(!statements.length||!statements.every((x:any)=>x&&typeof x==='object'&&!Array.isArray(x)&&x.Effect==='Deny'))
  return failure('bucket_policy_grant_not_supported');
 return sha(body);
}
