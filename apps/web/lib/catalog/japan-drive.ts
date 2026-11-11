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
/** Supplier MySQL WHERE, before count/LIMIT. Fixed bounded EREs avoid huge GET URLs. */
export function japanDriveSql(selection:string,index:CalculationIndex|null=null){
 const selected=[...new Set(selection.split('|'))];
 if(!selected.length||selected.some(v=>!['fwd','rwd','awd'].includes(v)))throw Error('ajes_invalid_query');
 const quote=(s:string)=>/^[A-Z0-9 .+&()/_-]{1,100}$/.test(s)?`'${s}'`:null;
 const tokens:Record<string,string[]>={awd:['4WD','AWD'],fwd:['FWD','FF'],rwd:['RWD','FR']};
 const pattern=(values:string[])=>`(^|[ /(),-])(${values.join('|')})([ /(),-]|$)`;
 const noTwoWheel=`(grade is null or grade not regexp '${pattern(['2WD'])}')`;
 const explicit=selected.map(value=>{
  const others=Object.keys(tokens).filter(v=>v!==value).flatMap(v=>tokens[v]);
  return `(grade regexp '${pattern(tokens[value])}' and grade not regexp '${pattern(others)}'${value==='awd'?` and ${noTwoWheel}`:''})`;
 });
 const byDrive=new Map(selected.map(value=>[value,[] as string[]]));
 const twoWheelDrives=selected.filter(value=>value!=='awd');
 const annualGroups=new Map<string,{make:string;model:string;code:string;drive:string;years:Set<number>}>();
 for(const g of japanDriveGroups(index)){
  if(!g.drive||!byDrive.has(g.drive)||lookupJapanChassisDrive(g.make,g.chassis)===g.drive)continue;
  const make=quote(g.make),model=quote(g.model),code=quote(g.chassis);if(!make||!model||!code)continue;
  const bucket=g.drive==='awd'?'awd':twoWheelDrives[0];
  const key=JSON.stringify([g.make,g.model,g.chassis,bucket]),group=annualGroups.get(key)||{make,model,code:g.chassis,drive:bucket,years:new Set<number>()};
  group.years.add(g.year);annualGroups.set(key,group);
 }
 for(const g of annualGroups.values()){
  const years=[...g.years].sort(),year=years.length===1?`year=${years[0]}`:`year in (${years.join(',')})`;
  byDrive.get(g.drive)!.push(`(marka_name=${g.make} and model_name=${g.model} and ${year} and (kuzov=${quote(g.code)} or kuzov like '%-${g.code}'))`);
 }
 for(const value of [...(selected.includes('awd')?['awd']:[]),...twoWheelDrives.slice(0,1)]){
  const drivesForBucket=value==='awd'?['awd']:twoWheelDrives;
  const grouped=new Map<string,Set<string>>();
  for(const r of japanChassisDriveRows()){
   if(r.drives.length!==1||!drivesForBucket.includes(r.drives[0]))continue;
   const make=text(r.make).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/MERCEDES-BENZ/,'MERCEDES BENZ');
   if(!quote(make)||!quote(r.chassisCode))continue;
   const codes=grouped.get(make)||new Set<string>();codes.add(r.chassisCode);grouped.set(make,codes);
  }
  for(const [make,values] of grouped){
   const simple=[...values].filter(c=>/^[A-Z0-9]+$/.test(c));
   const clauses=simple.length?[`kuzov regexp '(^|-)(${simple.join('|')})$'`]:[];
   // Preserve unusual validated codes without interpreting regex punctuation.
   for(const c of values)if(!simple.includes(c))clauses.push(`(kuzov=${quote(c)} or kuzov like '%-${c}')`);
   byDrive.get(value)!.push(`(marka_name=${quote(make)} and (${clauses.join(' or ')}))`);
  }
 }
 const chassisClauses=[...byDrive].filter(([,clauses])=>clauses.length).map(([value,clauses])=>`((${clauses.join(' or ')})${value==='awd'?` and ${noTwoWheel}`:''})`);
 const fallback=`((grade is null or grade not regexp '${pattern(Object.values(tokens).flat())}') and (${chassisClauses.join(' or ')||'1=0'}))`;
 const codes:Record<string,string[]>={fwd:['FF','FWD'],rwd:['FR','RWD'],awd:['4WD','AWD','FULLTIME4WD']};
 const selectedCodes=selected.flatMap(v=>codes[v]).map(v=>`'${v}'`).join(',');
 const knownCodes=Object.values(codes).flat().map(v=>`'${v}'`).join(',');
 return `(priv in (${selectedCodes}) or ((priv is null or priv not in (${knownCodes})) and (${explicit.join(' or ')} or ${fallback})))`;
}
