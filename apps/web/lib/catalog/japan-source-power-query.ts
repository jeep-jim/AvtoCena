import type {CalculationIndex} from '../encyclopedia/calculation-index';

export type JapanSourcePowerPredicate={
 sql:string|null;
 applied:boolean;
 localModelCount:number;
 cohortMode:'exact-token'|'prefix'|'unrestricted';
 prefixLength:number|null;
 requiresLocalValidation:true;
};

const encodedLength=(value:string)=>new URLSearchParams({sql:value}).toString().length-4;
const normalizedModel="upper(replace(replace(replace(replace(replace(model_name,' ',''),'-',''),'.',''),'/',''),'_',''))";
// ajesText also decodes entities and applies NFKC. Only this reproducible ASCII
// subset is narrowed in SQL; every other spelling remains a source candidate.
const otherModelSpelling="model_name not regexp '^[A-Za-z0-9 ._/-]*$'";

function alternatives(values:readonly string[]):string {
 type Node={end:boolean;children:Map<string,Node>};
 const root:Node={end:false,children:new Map()};
 for(const value of values){let node=root;for(const character of value){let next=node.children.get(character);if(!next){next={end:false,children:new Map()};node.children.set(character,next);}node=next;}node.end=true;}
 const render=(node:Node):string=>{
  const children=[...node.children].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([character,next])=>character+render(next));
  if(!children.length)return '';
  const expression=children.length===1?children[0]:'('+children.join('|')+')';
  return node.end?'('+expression+')?':expression;
 };
 return render(root);
}

/** A global source candidate predicate, never an admitted-inventory count.
 * Local encyclopedia/manual horsepower facts can outrank PW. Preserve their entire model
 * cohorts rather than approximating the local modification/consensus matcher.
 * Make/year are deliberately not narrowed inside these exception cohorts.
 */
export function japanSourcePowerPredicate(low:number,high:number,index:CalculationIndex|null=null,maxEncodedLength=2400):JapanSourcePowerPredicate {
 if(!Number.isSafeInteger(low)||!Number.isSafeInteger(high)||low<1||high>2500||low>high)throw Error('ajes_invalid_query');
 const models=new Set<string>();
 const unrestricted=():JapanSourcePowerPredicate=>({sql:null,applied:false,localModelCount:models.size,cohortMode:'unrestricted',prefixLength:null,requiresLocalValidation:true});
 if(index){
  if(!index.models||typeof index.models!=='object'||Array.isArray(index.models))return unrestricted();
  for(const [key,facts] of Object.entries(index.models)){
   if(!Array.isArray(facts))return unrestricted();
   if(!facts.length)continue;
   if(facts.some(fact=>!fact||typeof fact!=='object'||!fact.values||typeof fact.values!=='object'||Array.isArray(fact.values)))return unrestricted();
   // The admission matcher only fills powerHp from values.powerHp. kW,
   // drivetrain and ASTRA's thirty-minute power do not become discovery hp.
   // Preserve all positive hp donors, including manual and conflicting ones;
   // local matching/safety, not this source superset, decides their application.
   if(!facts.some(fact=>Number.isFinite(Number(fact.values.powerHp))&&Number(fact.values.powerHp)>0))continue;
   const identity=key.replace(/^@astra-power30:/,'');
   const separator=identity.indexOf(':');
   if(separator<1||separator===identity.length-1||identity.indexOf(':',separator+1)!==-1)return unrestricted();
   const model=identity.slice(separator+1);
   // Non-ASCII model tokens are already preserved by otherModelSpelling.
   // A token must be the same alphanumeric form used by modelKey; an unknown
   // index format disables source narrowing instead of dropping its records.
   if(!/^[\p{L}\p{N}]+$/u.test(model))return unrestricted();
   if(/^[a-z0-9]+$/i.test(model))models.add(model.toUpperCase());
   // ASTRA deliberately unions C/C-Class with C300-style registry siblings.
   const family=/^@astra-power30:mercedesbenz:([ces])(?:class|[0-9]{3}[a-z]*)?$/.exec(key)?.[1];
   if(family){models.add(family.toUpperCase());models.add((family+'class').toUpperCase());}
  }
 }
 const valid="(length(trim(pw))<=30 and trim(pw) regexp '^[0-9]+$' and (pw+0)>0 and (pw+0)<=9007199254740991)";
 const source=`pw is null or not ${valid} or ((pw+0)>=${low} and (pw+0)<=${high})`;
 // A broad namespace is intentional: the unchanged owner predicate still
 // decides Honda/nonhybrid identity and the final 150 hp match after LIST.
 const owner=`${normalizedModel} regexp '^STEPW(A)?G(O)?N'`;
 const modelTokens=[...models].sort();
 const modes:Array<number|null>=[null,4,3,2,1];
 for(const prefixLength of modes){
  const tokens=prefixLength===null?modelTokens:[...new Set(modelTokens.map(value=>value.slice(0,prefixLength)))].sort();
  const pattern=tokens.length?alternatives(tokens):'';
  const cohorts=pattern?` or ${normalizedModel} regexp '^(${pattern})${prefixLength===null?'$':''}'`:'';
  const sql=`(${source} or ${otherModelSpelling} or ${owner}${cohorts})`;
  if(encodedLength(sql)<=maxEncodedLength)return {sql,applied:true,localModelCount:models.size,cohortMode:prefixLength===null?'exact-token':'prefix',prefixLength,requiresLocalValidation:true};
 }
 // Coarsening retains every exception. If even that cannot fit the existing
 // URI envelope, keep the old broad source selection; never truncate cohorts.
 return unrestricted();
}
