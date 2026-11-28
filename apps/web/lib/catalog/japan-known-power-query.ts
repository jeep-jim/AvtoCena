import type {CalculationIndex} from '../encyclopedia/calculation-index';
import type {CatalogEditorialIndex} from './editorial';

export const JAPAN_KNOWN_POWER_QUERY_VERSION='japan-known-power-candidates-v1';
export type JapanPowerBounds={powerFrom?:number;powerTo?:number};
/** Internal only; URL parsing never accepts source-selection descriptors. */
export type JapanKnownPowerSelection={editorialIds:string[]};
const record=(value:unknown):value is Record<string,any>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const encodedLength=(value:string)=>new URLSearchParams({sql:value}).toString().length-4;
const within=(hp:number,bounds:JapanPowerBounds)=>Number.isFinite(hp)&&hp>0
 &&(bounds.powerFrom===undefined||hp>=bounds.powerFrom)&&(bounds.powerTo===undefined||hp<=bounds.powerTo);

/** Legacy persisted specifications can change power or owner-rule identity.
 * Preserve every applicable visible entry, using the lookup key and source ID
 * that matchingEditorial actually checks, rather than assuming today's form schema.
 */
export function japanKnownPowerSelection(editorial:CatalogEditorialIndex):JapanKnownPowerSelection|null {
 if(!record(editorial)||!record(editorial.entries))return null;
 const ids=new Set<string>();
 for(const [key,entry] of Object.entries(editorial.entries)){
  if(!record(entry))return null;
  if(entry.market!=='japan'||entry.sourceId!=='ajes_japan_feed'||entry.status!=='visible')continue;
  const match=/^ajes-stats-([A-Za-z0-9_-]{1,64})$/.exec(key);
  if(!match||entry.sourceOfferId!==match[1])continue;
  ids.add(match[1]);
 }
 return {editorialIds:[...ids].sort()};
}

function alternatives(values:readonly string[]):string {
 type Node={end:boolean;children:Map<string,Node>};
 const root:Node={end:false,children:new Map()};
 for(const value of values){let node=root;for(const character of value){let next=node.children.get(character);if(!next){next={end:false,children:new Map()};node.children.set(character,next);}node=next;}node.end=true;}
 const render=(node:Node):string=>{
  const children=[...node.children].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([character,next])=>{const rest=render(next);return character+(rest?'.*'+rest:'');});
  if(!children.length)return '';
  const expression=children.length===1?children[0]:children.every(value=>/^[A-Z0-9]$/.test(value))?'['+children.join('')+']':'('+children.join('|')+')';
  return node.end?'('+expression+')?':expression;
 };
 return render(root);
}

/** A superset for K only. Local admission/safety remains authoritative.
 * Numeric literals use the documented MySQL string/number comparison; this
 * https://dev.mysql.com/doc/refman/8.4/en/type-conversion.html
 * does not establish AJ compatibility, which remains a live acceptance gate.
 * Unknown rows still have the unchanged broad query in the later U phase.
 */
export function japanKnownPowerPredicate(bounds:JapanPowerBounds,index:CalculationIndex|null,selection:JapanKnownPowerSelection,maxEncodedLength:number):string|null {
 const models=new Set<string>();
 if(index){
  if(!record(index.models))return null;
  for(const [key,facts] of Object.entries(index.models)){
   if(!Array.isArray(facts)||facts.some(fact=>!record(fact)||!record(fact.values)))return null;
   // ASTRA certificates only apply power30MinKw, never discovery powerHp.
   if(key.startsWith('@astra-power30:')||!facts.some(fact=>within(Number(fact.values.powerHp),bounds)))continue;
   const identity=/^[\p{L}\p{N}]+:([\p{L}\p{N}]+)$/u.exec(key);
   if(!identity||identity[1].length>120)return null;
   // Non-ASCII/encoded model spellings are retained independently below.
   if(/^[a-z0-9]+$/i.test(identity[1]))models.add(identity[1].toUpperCase());
  }
 }
 const numeric=['pw>0',...(bounds.powerFrom===undefined?[]:[`pw>=${bounds.powerFrom}`]),...(bounds.powerTo===undefined?[]:[`pw<=${bounds.powerTo}`])];
 // ajesText decodes entities, normalizes width and trims Unicode whitespace.
 // Ordinary ASCII blank/zero/N/A cannot become known and need no K slot.
 const clauses=['('+numeric.join(' and ')+')',"pw like '%&%'","pw regexp '[^ -~]'","model_name regexp '[^A-Za-z0-9 ._/-]'"];
 // ajesLot normalizes ID with ajesText before editorial lookup. Raw entities,
 // width variants or surrounding whitespace can name the same saved override.
 if(selection.editorialIds.length)clauses.push(`id in (${selection.editorialIds.map(id=>`'${id}'`).join(',')})`,"id regexp '[^A-Za-z0-9_-]'");
 const owner=within(150,bounds)?'S.*T.*E.*P.*W.*G.*N':'';
 const sorted=[...models].sort();
 for(const prefixLength of [null,4,3,2,1] as const){
  const tokens=prefixLength===null?sorted:[...new Set(sorted.map(value=>value.slice(0,prefixLength)))].sort();
  const pattern=tokens.length?alternatives(tokens):'';
  const cohort=pattern?`^[ ._/-]*(${pattern})${prefixLength===null?'[ ._/-]*$':''}`:'';
  const names=[owner,cohort].filter(Boolean).join('|');
  const sql='('+[...clauses,...(names?[`upper(model_name) regexp '${names}'`]:[])].join(' or ')+')';
  if(encodedLength(sql)<=maxEncodedLength)return sql;
 }
 // Never truncate donor/owner/manual exceptions to fit the URI.
 return null;
}
