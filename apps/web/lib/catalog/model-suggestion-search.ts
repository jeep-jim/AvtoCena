/** Suggestion ranking only. Never changes stored identities or applied filters. */
export type ModelSearchData = {version:1;models:[string,string,string[],number][];brands:[string,string[]][]};
export type ModelSuggestion = {make:string;model:string;aliases:string[];related?:boolean};
const letters:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'i',ь:'',э:'e',ю:'yu',я:'ya'};
export function suggestionKey(value:string){return value.normalize('NFKC').toLowerCase().replace(/[а-яё]/g,c=>letters[c]).replace(/y/g,'i').replace(/c(?=[aourl])/g,'k').replace(/([lrs])\1+/g,'$1').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function* compileSearch(data:ModelSearchData){
 const brandAliases=new Map<string,string>();
 for(const [make,aliases] of data.brands)for(const alias of [make,...aliases])brandAliases.set(suggestionKey(alias),suggestionKey(make));
 const prefixRows=new Map<string,number[]>(),makeRows=new Map<string,number[]>();
 const rows:{make:string;model:string;aliases:string[];canonical:number;brand:string;names:string[]}[]=[];
 for(let i=0;i<data.models.length;i++){
  const [make,model,aliases,canonical]=data.models[i];
  const row={make,model,aliases,canonical,brand:suggestionKey(make),names:[...new Set([model,...aliases].map(suggestionKey).filter(Boolean))]};rows.push(row);
  const keys=new Set<string>();for(const name of row.names)for(const token of name.split(' '))for(let n=2;n<=Math.min(24,token.length);n++)keys.add(token.slice(0,n));
  for(const key of keys){const list=prefixRows.get(key)||[];list.push(i);prefixRows.set(key,list);}
  const list=makeRows.get(row.brand)||[];list.push(i);makeRows.set(row.brand,list);
  if(i%200===199)yield;
 }
 const brandEntries=[...brandAliases].sort((a,b)=>b[0].length-a[0].length);
 return (query:string,make='',limit=50):ModelSuggestion[]=>{
  const raw=suggestionKey(query.slice(0,180));
  const brands=new Set(make.split(',').map(suggestionKey).filter(Boolean).map(k=>brandAliases.get(k)||k));
  let q=raw;
  // A complete leading make is optional; the selected make always wins.
  for(const [alias,brand] of brandEntries)if(raw.startsWith(alias+' ')){if(!brands.size)brands.add(brand);q=raw.slice(alias.length+1);break;}
  if(brandAliases.has(raw)&&!brands.size){brands.add(brandAliases.get(raw)!);q='';}
  if(!q&&!brands.size)return [];
  if(q.length<2&&q)return [];
  const tokens=q.split(' ').filter(Boolean),significant=tokens.filter(t=>t.length>=4);
  const results:{row:typeof rows[number];score:number;related:boolean}[]=[];
  const candidates=q?(prefixRows.get(tokens[0].slice(0,24))||[]):[...brands].flatMap(brand=>makeRows.get(brand)||[]);
  for(const index of candidates){const row=rows[index];
   if(brands.size&&!brands.has(row.brand))continue;
   let score=q?0:100,related=false;
   for(const name of row.names){
    let rank=0;
    if(name===q)rank=1000;
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
  return results.slice(0,Math.max(1,Math.min(50,limit))).map(({row,related})=>({make:row.make,model:row.model,aliases:row.aliases,...(related?{related:true}:{})}));
 };
}

export function createModelSuggestionSearch(data:ModelSearchData){const compiler=compileSearch(data);let step=compiler.next();while(!step.done)step=compiler.next();return step.value;}
export async function prepareModelSuggestionSearch(data:ModelSearchData){const compiler=compileSearch(data);let step=compiler.next();while(!step.done){await new Promise<void>(resolve=>setTimeout(resolve,0));step=compiler.next();}return step.value;}
