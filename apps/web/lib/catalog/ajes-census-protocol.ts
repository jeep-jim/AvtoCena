import type {AjesCensusField} from './ajes-query';
import {AjesUnavailable} from './ajes-access-policy';

export type AjesCensusGroup={values:Partial<Record<AjesCensusField,string|number|null>>;total:number;validIds:number;validFinishes:number};
const fail=(reason:string):never=>{throw new AjesUnavailable('census_'+reason);};
const nonnegative=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;

/** Parse every group, including rejected groups; silently dropping a malformed
 * aggregate row would turn an upper bound into a fabricated exact total. */
export function parseAjesCensusGroups(rows:Record<string,unknown>[],fields:readonly AjesCensusField[]):AjesCensusGroup[]{
 const numeric=(value:unknown)=>{
  if(!/^\d+$/.test(String(value))||!nonnegative(Number(value)))return fail('invalid_aggregate');
  return Number(value);
 };
 return rows.map(row=>{
  const lower=Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toLowerCase(),value]));
  const total=numeric(lower.census_count??lower['count(*)']??lower['tag'+fields.length]);
  const validIds=numeric(lower.census_valid_ids??lower['tag'+(fields.length+1)]);
  const validFinishes=numeric(lower.census_valid_finishes??lower['tag'+(fields.length+2)]);
  if(total<1||validIds>total||validFinishes>total)return fail('invalid_aggregate');
  const values:Partial<Record<AjesCensusField,string|number|null>>={};
  for(const field of fields){
   const key=field.toLowerCase();
   if(!Object.hasOwn(lower,key))return fail('invalid_aggregate');
   const value=lower[key];
   if(value!==null&&typeof value!=='string'&&typeof value!=='number')return fail('invalid_aggregate');
   if(typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>4096)return fail('invalid_aggregate');
   values[field]=value as string|number|null;
  }
  return {values,total,validIds,validFinishes};
 });
}

