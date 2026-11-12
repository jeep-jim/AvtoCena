/** Immutable market chunks can reference generations older than the top-level manifest. */
export function referencedCatalogGenerations(...manifests) {
 const result=new Set(),seen=new WeakSet(),pending=[...manifests];
 while(pending.length){
  const value=pending.pop();
  if(typeof value==='string'){
   const match=value.match(/^catalog\/generations\/(gen_\d+_[-a-z0-9]+)\//i);
   if(match)result.add(match[1]);
  }else if(value&&typeof value==='object'&&!seen.has(value)){
   seen.add(value);
   if(/^gen_\d+_[-a-z0-9]+$/i.test(value.generationId||''))result.add(value.generationId);
   pending.push(...Object.values(value));
  }
 }
 return result;
}
