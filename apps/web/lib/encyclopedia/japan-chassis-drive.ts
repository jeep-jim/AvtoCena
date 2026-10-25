import rows from './japan-chassis-drive/manifest';
export type ChassisDriveRow={make:string;chassisCode:string;drive?:string;drives:string[]};
const makeKey=(s:unknown)=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const japanChassisCode=(s:unknown)=>String(s||'').normalize('NFKC').trim().toUpperCase().replace(/^[A-Z0-9]{1,3}-/,'');
/** Only reviewed, brand-qualified official type relationships. Shared codes stay unresolved. */
export function lookupJapanChassisDrive(make:unknown,code:unknown,table:ChassisDriveRow[]=rows){
 const matches=table.filter(r=>makeKey(r.make)===makeKey(make)&&r.chassisCode===japanChassisCode(code));
 if(!matches.length)return undefined;
 const values=new Set(matches.flatMap(r=>r.drives));
 return values.size===1?[...values][0]:undefined;
}
export function japanChassisDriveRows():ChassisDriveRow[]{return rows;}
