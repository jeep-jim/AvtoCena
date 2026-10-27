import rows from './japan-chassis-drive/manifest';
export type ChassisDriveRow={make:string;chassisCode:string;drive?:string;drives:string[]};
const makeKey=(s:unknown)=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const japanChassisCode=(s:unknown)=>String(s||'').normalize('NFKC').trim().toUpperCase().replace(/^[A-Z0-9]{1,3}-/,'');
const key=(make:unknown,code:unknown)=>makeKey(make)+'\0'+japanChassisCode(code);
function compile(table:ChassisDriveRow[]){
 const grouped=new Map<string,Set<string>>();
 for(const row of table){const id=key(row.make,row.chassisCode),values=grouped.get(id)||new Set<string>();for(const value of row.drives)values.add(value);grouped.set(id,values);}
 return new Map([...grouped].map(([id,values])=>[id,values.size===1?[...values][0]:undefined]));
}
const reviewed=compile(rows);
/** Only reviewed, brand-qualified official type relationships. Shared codes stay unresolved. */
export function lookupJapanChassisDrive(make:unknown,code:unknown,table:ChassisDriveRow[]=rows){
 return (table===rows?reviewed:compile(table)).get(key(make,code));
}
export function japanChassisDriveRows():ChassisDriveRow[]{return rows;}
