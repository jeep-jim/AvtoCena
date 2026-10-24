import {readCalculationIndex,type CalculationIndex} from '../encyclopedia/calculation-index';
const text=(v:unknown)=>String(v||'').normalize('NFKC').trim().toUpperCase();
const chassis=(v:unknown)=>text(v).replace(/^(?:E|GF|TA|ABA|CBA|DBA|DAA|DLA|3BA|4BA|5BA|5AA|6AA|6LA|7BA|ZAA)-/,'');
const drive=(v:unknown)=>({AWD:'awd','4WD':'awd',FWD:'fwd',FF:'fwd',RWD:'rwd',FR:'rwd'} as Record<string,string>)[text(v)];
/** Only explicit drivetrain tokens; equipment names alone convey no drive. */
export function explicitJapanDrive(trim:unknown){
 const matches=[...text(trim).matchAll(/(?:^|[\s/(),-])(4WD|AWD|FWD|RWD|FF|FR)(?=$|[\s/(),-])/g)].map(m=>drive(m[1]));
 const unique=new Set(matches);return unique.size===1?[...unique][0]:undefined;
}
type Group={make:string;model:string;year:number;chassis:string;drive?:string};
const cache=new WeakMap<CalculationIndex,Group[]>();
export function japanDriveGroups(index=readCalculationIndex()):Group[]{
 if(!index)return [];const cached=cache.get(index);if(cached)return cached;
 const grouped=new Map<string,{group:Group;values:Array<string|undefined>}>();
 for(const facts of Object.values(index.models))for(const fact of facts){
  const code=chassis(fact.constraints.chassisCode);
  if(!fact.make||!fact.model||!code||!Number.isInteger(fact.year))continue;
  const group={make:text(fact.make),model:text(fact.model),year:fact.year,chassis:code};
  const key=JSON.stringify(group),entry=grouped.get(key)||{group,values:[]};
  entry.values.push(fact.chassisDriveComplete===true?drive(fact.values.drive):undefined);grouped.set(key,entry);
 }
 const groups=[...grouped.values()].map(({group,values})=>({...group,drive:values.every(v=>v&&v===values[0])?values[0]:undefined}));
 cache.set(index,groups);return groups;
}
export function enrichJapanDrive<T extends Record<string,any>>(offer:T,index=readCalculationIndex()):T{
 if(offer.market!=='japan'||offer.drive||offer.editorialSpecifications?.drive)return offer;
 const explicit=explicitJapanDrive(offer.trim),code=chassis(offer.chassisCode||offer.operational?.chassisCode);
 const group=japanDriveGroups(index).find(g=>g.make===text(offer.make)&&g.model===text(offer.model)&&g.year===offer.year&&g.chassis===code);
 if(explicit&&group?.drive&&explicit!==group.drive)return offer;
 const resolved=explicit||group?.drive;
 return resolved?{...offer,drive:resolved,operational:{...offer.operational,driveEvidence:{source:explicit?'source_grade_explicit_drive':'encyclopedia_chassis_drive_consensus',indexDigest:explicit?undefined:index?.digest,chassisCode:code||undefined}}}:offer;
}
/** Supplier WHERE, before count and LIMIT; missing drive is never guessed. */
export function japanDriveSql(selection:string,index=readCalculationIndex()){
 const selected=selection.split('|');if(!selected.length||selected.some(v=>!['fwd','rwd','awd'].includes(v)))throw Error('ajes_invalid_query');
 const quote=(s:string)=>{if(!/^[A-Z0-9 .+&()/_-]{1,100}$/.test(s))return null;return `'${s}'`;};
 const clauses:string[]=[];
 for(const value of new Set(selected)){
  const tokens=value==='awd'?['4WD','AWD']:value==='fwd'?['FWD','FF']:['RWD','FR'];
  for(const token of tokens)clauses.push(`(grade='${token}' or grade like '${token} %' or grade like '% ${token}' or grade like '% ${token} %')`);
 }
 for(const g of japanDriveGroups(index)){
  if(!g.drive||!selected.includes(g.drive))continue;
  const make=quote(g.make),model=quote(g.model),code=quote(g.chassis);if(!make||!model||!code)continue;
  clauses.push(`(marka_name=${make} and model_name=${model} and year=${g.year} and kuzov=${code})`);
 }
 return '('+clauses.join(' or ')+')';
}
