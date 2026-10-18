/** Resolve a displayed family only against names actually present in the source directory.
 * An explicitly selected source model remains exact; A5 never matches S5 or A50. */
export function resolveAjesModelNames(selected:string,models:Array<{model:string}>):string {
 const names=[...new Set(models.map(x=>x.model.trim()).filter(Boolean))];
 const key=(s:string)=>s.normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
 const resolved=selected.split('|').flatMap(value=>{
  const target=key(value),exact=names.find(n=>key(n)===target);
  if(exact)return [exact];
  const family=names.filter(n=>key(n).startsWith(target+' '));
  return family.length?family:[value];
 });
 const unique=[...new Set(resolved)];
 // Keep the existing bounded SQL selection contract.
 return unique.length<=20?unique.join('|'):selected;
}
