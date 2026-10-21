/** Preserve server-resolved country/source on country landing pages without query parameters. */
export function brandContextQuery(search:string,initial:Record<string,string>={}){
 const params=new URLSearchParams(search);
 for(const [key,value] of Object.entries(initial))if(value)params.set(key,value);
 return params.toString();
}
export function brandSelectionQuery(context:string,brands:string[]){
 const params=new URLSearchParams(context);
 const ordered=[...new Set(brands)].sort((a,b)=>a.localeCompare(b,'ru'));
 if(ordered.length)params.set('make',ordered.join(','));else params.delete('make');
 for(const key of ['brand','model','page','after'])params.delete(key);
 return params.toString();
}
