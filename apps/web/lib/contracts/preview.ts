import {documentBlocks,principal,formatDate,dateKeys,type ContractSnapshot,type ContractBlock} from './model';
export type PreviewBlock=ContractBlock & {fields:string[];editor?:string};
const principalKeys=['fio','birthDate','passportSeries','passportNumber','passportIssued','passportDate','passportCode','address'];
/** Metadata only: PDF text and contract clauses stay untouched. */
export function previewBlocks(snapshot:ContractSnapshot,number:string):PreviewBlock[]{
 const {fields:f,template:t}=snapshot;
 const blocks=documentBlocks(snapshot,number).map(b=>({...b,fields:[] as string[],editor:undefined as string|undefined}));
 blocks[0].fields=['number'];blocks[1].fields=['date'];blocks[2].fields=principalKeys;blocks[2].editor='template.agent';
 let index=3;
 for(let i=0;i<t.sections.length;i++){
  blocks[index++].editor=`template.sections.${i}.title`;
  const paragraphs=t.sections[i].text.split(/\n\s*\n/);
  for(const paragraph of paragraphs){
   const b=blocks[index++];b.editor=`template.sections.${i}.text`;
   const tokens=[...paragraph.matchAll(/\{\{([^}]+)\}\}/g)].map(m=>m[1]);
   b.fields=[...new Set(tokens.map(k=>k.startsWith('country')?'market':k==='commission'?'manualCommission':k==='deposit'?'manualDeposit':k))];
  }
 }
 for(const b of blocks.slice(index)){
  if(b.text===t.requisites)b.editor='template.requisites';
  if(b.text.startsWith(principal(f)))b.fields=[...principalKeys,'phone','email'];
  else if(b.text.startsWith('К агентскому договору'))b.fields=['number','date'];
  else if(b.text.startsWith('Гр. '))b.fields=['fio'];
  else if(/^\d+\. Марка, модель:/.test(b.text))b.fields=['car','year'];
  else if(/^\d+\. Цвет кузова:/.test(b.text))b.fields=['color'];
  else if(/^\d+\. Тип двигателя:/.test(b.text))b.fields=['engine'];
  else if(/^\d+\. Рабочий объём/.test(b.text))b.fields=['engineCc','powerHp'];
  else if(/^\d+\. Коробка:/.test(b.text))b.fields=['transmission'];
  else if(/^\d+\. Пробег:/.test(b.text))b.fields=['mileage'];
  else if(/^\d+\. Оценка:/.test(b.text))b.fields=['grade'];
  else if(/^\d+\. Бюджет:/.test(b.text))b.fields=['budget'];
  else if(/^\d+\. Привод:/.test(b.text))b.fields=['drive'];
  else if(/^\d+\. VIN/.test(b.text))b.fields=['vin'];
  else if(b.text.startsWith('Итого:'))b.fields=['manualTotal'];
  else if(b.text.startsWith('Первоначальный платёж:'))b.fields=['manualCommission','manualDeposit'];
 }
 return blocks;
}
export function previewParts(block:PreviewBlock,fields:Record<string,string>){
 const ranges:Array<{start:number;end:number;field:string}>=[];
 for(const field of block.fields){
  const value=fields[field];if(!value)continue;
  const text=dateKeys.has(field)?formatDate(value):value;
  const start=block.text.indexOf(text);
  if(start<0||ranges.some(r=>start<r.end&&start+text.length>r.start))continue;
  ranges.push({start,end:start+text.length,field});
 }
 ranges.sort((a,b)=>a.start-b.start);
 const parts:Array<{text:string;field?:string}>=[];let offset=0;
 for(const range of ranges){if(range.start>offset)parts.push({text:block.text.slice(offset,range.start)});parts.push({text:block.text.slice(range.start,range.end),field:range.field});offset=range.end;}
 if(offset<block.text.length)parts.push({text:block.text.slice(offset)});
 return parts;
}
