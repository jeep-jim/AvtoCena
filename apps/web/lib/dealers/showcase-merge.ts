const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
export function mergeShowcaseChanges(base:any,local:any,remote:any){
 const conflicts:string[]=[];
 function merge(b:any,l:any,r:any,path:string):any{
  if(same(l,b))return r;if(same(r,b)||same(l,r))return l;
  if(object(b)&&object(l)&&object(r)){
   const out:any={};for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    if(key==='version'||key==='updatedAt'){out[key]=r[key];continue;}
    const v=merge(b[key],l[key],r[key],path?`${path}.${key}`:key);if(v!==undefined)out[key]=v;
   }return out;
  }
  if([b,l,r].every(v=>Array.isArray(v)&&v.every(x=>object(x)&&typeof x.id==='string'))){
   const ids=[...new Set([...l.map((x:any)=>x.id),...r.map((x:any)=>x.id)])];
   return ids.map(id=>merge(b.find((x:any)=>x.id===id),l.find((x:any)=>x.id===id),r.find((x:any)=>x.id===id),`${path}.${id}`)).filter(v=>v!==undefined);
  }
  conflicts.push(path);return l;
 }
 return {value:merge(base,local,remote,''),conflicts};
}
