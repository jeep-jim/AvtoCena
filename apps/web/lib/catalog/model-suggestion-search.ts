import {canonicalCatalogBrand} from './brands';
/** Suggestion ranking only. Never changes stored identities or applied filters. */
export type ModelSearchData = {version:1;models:[string,string,string[],number][];brands:[string,string[]][]};
export type ModelSuggestion = {id?:string;make:string;model:string;aliases:string[];related?:boolean};
const letters:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'i',ь:'',э:'e',ю:'yu',я:'ya'};
export function suggestionKey(value:string){return value.normalize('NFKC').toLowerCase().replace(/[а-яё]/g,c=>letters[c]).replace(/y/g,'i').replace(/c(?=[aourl])/g,'k').replace(/([lrs])\1+/g,'$1').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
const brandKey=(make:string)=>suggestionKey(canonicalCatalogBrand(make));
function* compileSearch(data:ModelSearchData){
 const brandAliases=new Map<string,string>();
 for(const [make] of data.models)brandAliases.set(suggestionKey(make),brandKey(make));
 for(const [make,aliases] of data.brands)for(const alias of [make,...aliases])brandAliases.set(suggestionKey(alias),brandKey(make));
 const fragmentRows=new Map<string,number[]>(),makeRows=new Map<string,number[]>();
 const rows:{make:string;model:string;aliases:string[];canonical:number;brand:string;names:string[]}[]=[];
 for(let i=0;i<data.models.length;i++){
  const [make,model,aliases,canonical]=data.models[i];
  const row={make,model,aliases,canonical,brand:brandKey(make),names:[...new Set([model,...aliases].map(suggestionKey).filter(Boolean))]};rows.push(row);
  const keys=new Set<string>();for(const name of row.names)for(let n=0;n<name.length-1;n++)keys.add(name.slice(n,n+2));
  for(const key of keys){const list=fragmentRows.get(key)||[];list.push(i);fragmentRows.set(key,list);}
  const list=makeRows.get(row.brand)||[];list.push(i);makeRows.set(row.brand,list);
  if(i%200===199)yield;
 }
 const brandEntries=[...brandAliases].sort((a,b)=>b[0].length-a[0].length);
 return (query:string,make='',limit=Number.POSITIVE_INFINITY):ModelSuggestion[]=>{
  const raw=suggestionKey(query.slice(0,180));
  const brands=new Set(make.split(',').map(brandKey).filter(Boolean).map(k=>brandAliases.get(k)||k));
  let q=raw;
  // A complete leading make is optional; the selected make always wins.
  for(const [alias,brand] of brandEntries)if(raw.startsWith(alias+' ')){if(!brands.size)brands.add(brand);q=raw.slice(alias.length+1);break;}
  if(brandAliases.has(raw)&&!brands.size){brands.add(brandAliases.get(raw)!);q='';}
  if(q.length<2&&q&&!brands.size)return [];
  const tokens=q.split(' ').filter(Boolean),significant=tokens.filter(t=>t.length>=4);
  const results:{row:typeof rows[number];score:number;related:boolean}[]=[];
  const candidates=brands.size?[...brands].flatMap(brand=>makeRows.get(brand)||[]):q?(tokens[0].length>=2?fragmentRows.get(tokens[0].slice(0,2))||[]:rows.flatMap((row,index)=>row.names.some(name=>name.includes(tokens[0]))?[index]:[])):rows.map((_,index)=>index);
  for(const index of candidates){const row=rows[index];
   if(brands.size&&!brands.has(row.brand))continue;
   let score=q?0:100,related=false;
   for(const name of row.names){
    let rank=0;
    if(name===q||(q&&name.replace(/\s/g,'')===q.replace(/\s/g,'')))rank=1000;
    else if(q&&name.startsWith(q))rank=900;
    else if(q&&name.includes(q))rank=800;
    else if(tokens.length>1&&tokens.every(t=>name.split(' ').some(n=>n.startsWith(t))))rank=700;
    // Missing middle words / trim suffix: Corolla Z may suggest Corolla Cross.
    // Require a substantial shared word; never broaden short numeric identities.
    else if(tokens.length>1&&significant.length&&significant.every(t=>name.split(' ').includes(t)))rank=300;
    if(rank>score){score=rank;related=rank===300;}
   }
   if(score)results.push({row,score:score+(row.canonical?20:0),related});
  }
  results.sort((a,b)=>b.score-a.score||a.row.model.length-b.row.model.length||a.row.model.localeCompare(b.row.model,'ru'));
  return results.slice(0,Math.max(1,limit)).map(({row,related})=>({make:row.make,model:row.model,aliases:row.aliases,...(related?{related:true}:{})}));
 };
}

export function createModelSuggestionSearch(data:ModelSearchData){const compiler=compileSearch(data);let step=compiler.next();while(!step.done)step=compiler.next();return step.value;}
export async function prepareModelSuggestionSearch(data:ModelSearchData){const compiler=compileSearch(data);let step=compiler.next();while(!step.done){await new Promise<void>(resolve=>setTimeout(resolve,0));step=compiler.next();}return step.value;}

/** Exact live inventory names must remain selectable even when absent from knowledge. */
export function mergeModelSuggestions(inventory:ModelSuggestion[], directory:ModelSuggestion[], query:string):ModelSuggestion[]{
 const merged=new Map<string,ModelSuggestion>();
 for(const row of [...directory,...inventory]){
  const key=`${suggestionKey(row.make)}:${suggestionKey(row.model)}`;
  const previous=merged.get(key);
  merged.set(key,{...row,aliases:[...new Set([...(previous?.aliases||[]),...row.aliases])]});
 }
 const q=suggestionKey(query);
 const rank=(row:ModelSuggestion)=>[row.model,...row.aliases].some(name=>suggestionKey(name)===q)?0:row.related?2:1;
 return [...merged.values()].sort((a,b)=>rank(a)-rank(b)||a.model.length-b.model.length||a.model.localeCompare(b.model,'ru'));
}

/** Commit only the names entered by the user; never substitute the first fuzzy result. */
export function typedModelSelection(query:string, items:{model:string;aliases?:string[]}[], multiple:boolean){
 const names=(multiple?query.split(","):[query]).map(value=>value.replace(/\s+/g," ").trim()).filter(Boolean);
 return [...new Set(names.map(name=>items.find(item=>[item.model,...(item.aliases||[])].some(alias=>suggestionKey(alias)===suggestionKey(name)))?.model||name))].join(multiple?"|":"");
}
