/** Named horsepower fields only. Peak horsepower never supplies certified motor power. */
export function dubicarsHorsepower(data: Record<string, unknown>) {
 const readings:Array<{hp:number;raw:string;field:string;unit:string}>=[];
 let invalid=false;
 for(const [prefix,input] of [['',data],['extra',data.extra],['extra_prep',data.extra_prep]] as const){
  let object=input;
  if(typeof object==='string'&&object.length<=128*1024){try{object=JSON.parse(object);}catch{continue;}}
  if(!object||typeof object!=='object'||Array.isArray(object))continue;
  for(const [key,value] of Object.entries(object)){
   if(!/^(?:horsepower|horse_power|power_hp)$/i.test(key)||value===null||value===undefined||value==='')continue;
   const raw=typeof value==='string'||typeof value==='number'?String(value).trim():'';
   const match=raw.match(/^(\d+(?:\.\d+)?)\s*(hp|ps|bhp)?$/i),hp=match?Number(match[1]):NaN;
   if(!(hp>0&&hp<=2500)){invalid=true;continue;}
   readings.push({hp,raw,unit:match?.[2]?.toLowerCase()||'hp',field:[prefix,key].filter(Boolean).join('.')});
  }
 }
 if(invalid||!readings.length||new Set(readings.map(v=>v.hp)).size!==1)return undefined;
 return {...readings[0],source:`auto_api_dubicars:${readings.map(v=>v.field).join('+')}`};
}
