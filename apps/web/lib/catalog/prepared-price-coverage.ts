import {createHash} from 'node:crypto';

const sha=/^[a-f0-9]{64}$/;
const fail=(code:string):never=>{throw Error('catalog_price_shadow_coverage:'+code);};
const ordered=(domain:string)=>createHash('sha256').update(domain+'\n');
const append=(hash:ReturnType<typeof createHash>,value:unknown)=>hash.update(JSON.stringify(value)+'\n');
export function createPreparedCoverageIdsDigest(){
 const chain=ordered('prepared-ordered-admitted-ids-v1');
 return {add:(id:string)=>append(chain,id),finish:()=>chain.digest('hex')};
}
export function preparedCoverageIdsDigest(ids:Iterable<string>){
 const hash=createPreparedCoverageIdsDigest();
 for(const id of ids)hash.add(id);
 return hash.finish();
}
