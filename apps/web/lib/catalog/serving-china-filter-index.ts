import {selectPreparedChinaFilterPage} from './prepared-china-filter-index';
import type {CatalogSearchParams} from './types';

type Snapshot = {generationId:string;marketDigest:string;directorySha256:string;rows:number};
export type ServingChinaFilterBinding = Snapshot & {indexSha256:string};
// Built from all 168,662 accepted IDs, independently recounted on REG in run 45129166147.
export const servingChinaFilterBinding:ServingChinaFilterBinding={
  generationId:'gen_1795239842026_china44871616387',
  directorySha256:'27c28d7c0bd40e967c3bb5d1be1a9bea3dff3379dd04ba2f25045caa2d1b9abc',
  marketDigest:'54f41dcaa2d025bcbc265e5ed15583a12d1445461eada8865a51763ad55efc63',
  rows:168662,
  indexSha256:'ee0db497a4f1cbd5227a0fe7d871635923a789708a7a2927f4438efd0217ec6a',
};
type Input = Parameters<typeof selectPreparedChinaFilterPage>[3];

/** A cached index for a previously published directory has no authority over
 * later snapshots. All index parts are content-addressed by the pinned directory. */
export async function selectServingChinaFilterPage(
  snapshot:Snapshot,binding:ServingChinaFilterBinding,params:CatalogSearchParams,input:Input,
  read:(key:string,maximumBytes:number)=>Promise<{data:Buffer}>,
){
  if(snapshot.generationId!==binding.generationId || snapshot.marketDigest!==binding.marketDigest ||
     snapshot.directorySha256!==binding.directorySha256 || snapshot.rows!==binding.rows)return null;
  if(!/^[a-f0-9]{64}$/.test(binding.directorySha256))throw Error('serving_china_filter_directory');
  const logical='catalog/generations/'+snapshot.generationId+'/indexes/prepared-china-read-v1/filters-v1/';
  const prefix='catalog/derived-read-cache/china/'+binding.directorySha256+'/';
  return selectPreparedChinaFilterPage(snapshot,{version:1,sha256:binding.indexSha256},params,input,async(key,sha)=>{
    const suffix=key.slice(logical.length);
    if(!key.startsWith(logical)||!/^(?:parts\/\d+-|ready-)[a-f0-9]{64}\.json$/.test(suffix)||!suffix.endsWith(sha+'.json'))
      throw Error('serving_china_filter_key');
    const {data}=await read(prefix+suffix,4*1024*1024);
    return data;
  });
}
