export function numericDraft(text:string){
 const raw=text.replace(/[\s\u00a0\u202f]/g,'').replace(/\./g,',');
 return /^-?\d*(?:,\d*)?$/.test(raw)?raw:null;
}
export function formatNumericDraft(raw:string,group:boolean){
 if(!group)return raw;
 const [integer,fraction]=raw.split(',');
 return integer.replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(fraction!==undefined?','+fraction:'');
}
export function numericValue(raw:string){const n=Number(raw.replace(',','.'));return Number.isFinite(n)?n:0;}
