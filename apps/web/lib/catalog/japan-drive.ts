import {japanChassisCode,lookupJapanChassisDrive,japanChassisDriveRows} from '../encyclopedia/japan-chassis-drive';
import type {CalculationIndex} from '../encyclopedia/calculation-index';
const text=(v:unknown)=>String(v||'').normalize('NFKC').trim().toUpperCase();
const chassis=japanChassisCode;
const drive=(v:unknown)=>({FULLTIME4WD:'awd',AWD:'awd','4WD':'awd',FWD:'fwd',FF:'fwd',RWD:'rwd',FR:'rwd'} as Record<string,string>)[text(v)];
/** Only explicit drivetrain tokens; equipment names alone convey no drive. */
export function explicitJapanDrive(trim:unknown){
 const matches=[...text(trim).matchAll(/(?:^|[\s/(),-])(4WD|AWD|FWD|RWD|FF|FR)(?=$|[\s/(),-])/g)].map(m=>drive(m[1]));
 const unique=new Set(matches);if(unique.has('awd')&&/(?:^|[\s/(),-])2WD(?=$|[\s/(),-])/.test(text(trim)))return undefined;return unique.size===1?[...unique][0]:undefined;
}
type Group={make:string;model:string;year:number;chassis:string;drive?:string};
const cache=new WeakMap<CalculationIndex,Group[]>();
export function japanDriveGroups(index:CalculationIndex|null=null):Group[]{
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
export function enrichJapanDrive<T extends Record<string,any>>(offer:T,index:CalculationIndex|null=null):T{
 if(offer.market!=='japan'||offer.drive||offer.editorialSpecifications?.drive)return offer;
 const source=drive(offer.operational?.raw?.sourceDrive),explicit=explicitJapanDrive(offer.trim),code=chassis(offer.chassisCode||offer.operational?.chassisCode);
 const group=japanDriveGroups(index).find(g=>g.make===text(offer.make)&&g.model===text(offer.model)&&g.year===offer.year&&g.chassis===code);
 const gradeHasDrive=/(?:^|[\s/(),-])(4WD|AWD|FWD|RWD|FF|FR)(?=$|[\s/(),-])/.test(text(offer.trim));
 if(!source&&gradeHasDrive&&!explicit)return offer;
 const registry=lookupJapanChassisDrive(offer.make,code);
 const resolved=source||explicit||group?.drive||registry;
 if(!source&&resolved==='awd'&&/(?:^|[\s/(),-])2WD(?=$|[\s/(),-])/.test(text(offer.trim)))return offer;
 return resolved?{...offer,drive:resolved,operational:{...offer.operational,driveEvidence:{source:source?'source_priv_explicit_drive':explicit?'source_grade_explicit_drive':group?.drive?'encyclopedia_chassis_drive_consensus':'encyclopedia_official_chassis_drive',indexDigest:source||explicit?undefined:index?.digest,chassisCode:code||undefined}}}:offer;
}
/** Supplier WHERE, before count and LIMIT; missing drive is never guessed. */
export function japanDriveSql(selection:string,index:CalculationIndex|null=null){
 const selected=selection.split('|');if(!selected.length||selected.some(v=>!['fwd','rwd','awd'].includes(v)))throw Error('ajes_invalid_query');
 if(new Set(selected).size>1)return '('+[...new Set(selected)].map(v=>japanDriveSql(v,index)).join(' or ')+')';
 const quote=(s:string)=>{if(!/^[A-Z0-9 .+&()/_-]{1,100}$/.test(s))return null;return `'${s}'`;};
 const gradeFor=(value:string)=>{
  const tokens=value==='awd'?['4WD','AWD']:value==='fwd'?['FWD','FF']:['RWD','FR'];
  return tokens.map(token=>`(grade='${token}' or grade like '${token} %' or grade like '% ${token}' or grade like '% ${token} %' or grade like '%(${token})%' or grade like '%/${token}/%')`).join(' or ');
 };
 const positiveGrade=[...new Set(selected)].map(gradeFor).join(' or ');
 const otherGrade=['awd','fwd','rwd'].filter(v=>!selected.includes(v)).map(gradeFor).join(' or ')||'1=0';
 const allGrade=['awd','fwd','rwd'].map(gradeFor).join(' or ');
 const clauses:string[]=[];
 for(const g of japanDriveGroups(index)){
  if(!g.drive||!selected.includes(g.drive))continue;
  if(lookupJapanChassisDrive(g.make,g.chassis)===g.drive)continue;
  const make=quote(g.make),model=quote(g.model),code=quote(g.chassis);if(!make||!model||!code)continue;
  clauses.push(`(marka_name=${make} and model_name=${model} and year=${g.year} and (kuzov=${code} or kuzov like '%-${g.chassis}'))`);
 }
 // Group confirmed type codes by make to keep supplier predicates bounded.
 const grouped=new Map<string,Set<string>>();
 for(const r of japanChassisDriveRows()){
  if(r.drives.length!==1||!selected.includes(r.drives[0]))continue;
  const make=text(r.make).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/MERCEDES-BENZ/,'MERCEDES BENZ'),code=quote(r.chassisCode);if(!quote(make)||!code)continue;
  const codes=grouped.get(make)||new Set<string>();codes.add(r.chassisCode);grouped.set(make,codes);
 }
 for(const [make,values] of grouped){
  const codes=[...values];
  clauses.push(`(marka_name=${quote(make)} and (kuzov in (${codes.map(quote).join(',')}) or ${codes.map(c=>`kuzov like '%-${c}'`).join(' or ')}))`);
 }
 const codes:Record<string,string[]>={fwd:['FF','FWD'],rwd:['FR','RWD'],awd:['4WD','AWD','FULLTIME4WD']};
 const selectedCodes=[...new Set(selected.flatMap(v=>codes[v]))].map(v=>`'${v}'`).join(',');
 const knownCodes=Object.values(codes).flat().map(v=>`'${v}'`).join(',');
 const chassisSql=clauses.length?clauses.join(' or '):'1=0';
 const gradeSql=`((${positiveGrade}) and not (${otherGrade}))`;
 const fallbackSql=`((grade is null or not (${allGrade})) and (${chassisSql}))`;
 const twoWheelGuard=selected.includes('awd')&&!selected.includes('fwd')&&!selected.includes('rwd')?" and (grade is null or not (grade='2WD' or grade like '2WD %' or grade like '% 2WD' or grade like '% 2WD %' or grade like '%(2WD)%'))":'';
 return `(priv in (${selectedCodes}) or ((priv is null or priv not in (${knownCodes})) and (${gradeSql} or ${fallbackSql})${twoWheelGuard}))`;
}
