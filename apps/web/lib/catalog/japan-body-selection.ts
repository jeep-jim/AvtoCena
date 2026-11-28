import type {CalculationIndex} from '../encyclopedia/calculation-index';
import type {CatalogEditorialIndex} from './editorial';
import {filterSelections} from './filter-selections';
import {japanSourceBody,japanSourceBodyLabels} from './japan-source-body';
import {JAPAN_MIN_MODEL_YEAR} from './japan-year-policy';

export type JapanBodyModelCandidate={modelKey:string;make:string;model:string;year:number};
export type JapanBodyCandidatePlan={
 bodyTypes:string[];
 models:JapanBodyModelCandidate[];
 /** Raw AJ IDs. No source-wide ID discovery is performed. */
 ids:string[];
 sourceBody?:{field:'BODY_TYPE';labels:string[]};
 /** Include the existing pickup candidate predicate if this is true. */
 pickupCandidates:boolean;
 /** Evidence-branch coverage, not a proven source-query/card count. The SQL
  * compiler must also prove exact source-name resolution and retain all branches. */
 complete:boolean;
 unresolved:string[];
};
export type JapanBodyCandidateOptions={
 selection:string;
 index:CalculationIndex|null;
 editorial:CatalogEditorialIndex;
 /** Observed fields from the same permitted AJ reader; never guessed schema. */
 observedSourceFields?:readonly string[];
};

const bodyTypes=new Set(['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van']);
const sourceId=/^ajes-stats-([A-Za-z0-9_-]{1,64})$/;

/** Enumerate candidate identities from the entire immutable local evidence
 * snapshot. This is a superset for final admission, not a body assertion for
 * every car in a model/year: different trims can have different body styles.
 *
 * A model key is the exact annual lookup key used by calculation-index. The
 * caller resolves it against the complete observed source model directory;
 * blindly writing fact.make/fact.model into SQL would lose source spellings.
 * Missing source body schema deliberately leaves this as a known subset. Its
 * omitted candidates must not be reported as an exhausted complete catalogue. */
export function buildJapanBodyCandidatePlan(options:JapanBodyCandidateOptions):JapanBodyCandidatePlan {
 const selected=filterSelections(options.selection).sort();
 if(!selected.length||selected.some(value=>!bodyTypes.has(value)))throw Error('ajes_invalid_query');
 const unresolved=new Set<string>();
 const models=new Map<string,JapanBodyModelCandidate>();
 if(!options.index)unresolved.add('body_encyclopedia_unavailable');
 for(const [key,facts] of Object.entries(options.index?.models||{}))for(const fact of facts){
  const body=japanSourceBody(fact.values.bodyType);
  if(!body||!selected.includes(body))continue;
  // The shared encyclopedia legitimately contains older annual facts. They
  // cannot match this source's year domain and must not invalidate all current
  // body/power cohorts in the resolver. Keep the shared facts unchanged.
  if(Number.isInteger(fact.year)&&(fact.year<JAPAN_MIN_MODEL_YEAR||fact.year>2100))continue;
  // The immutable index normally guarantees these. A malformed record cannot
  // become evidence or silently make a restricted source query complete.
  if(!fact.sources.bodyType){unresolved.add('body_evidence_unproven');continue;}
  if(!Number.isInteger(fact.year)||!key){unresolved.add('body_evidence_identity_invalid');continue;}
  // Preserve the lookup key even in older indices without display names. The
  // source directory, not a guessed reverse spelling, supplies SQL names.
  const candidate={modelKey:key,make:fact.make||'',model:fact.model||'',year:fact.year};
  models.set(JSON.stringify([key,fact.year]),candidate);
 }
 const ids=new Set<string>();
 for(const [id,entry] of Object.entries(options.editorial.entries)){
  const match=sourceId.exec(id);
  if(!match||entry.id!==id||entry.market!=='japan'||entry.sourceId!=='ajes_japan_feed'||entry.sourceOfferId!==match[1]||entry.status!=='visible')continue;
  const body=japanSourceBody(entry.specifications?.bodyType);
  if(body&&selected.includes(body))ids.add(match[1]);
 }
 const sourceBody=options.observedSourceFields?.some(field=>field.toUpperCase()==='BODY_TYPE')
  ?{field:'BODY_TYPE' as const,labels:japanSourceBodyLabels(selected)}:undefined;
 if(!sourceBody)unresolved.add('body_source_schema_unobserved');
 return {bodyTypes:selected,models:[...models.values()].sort((a,b)=>a.modelKey.localeCompare(b.modelKey)||a.year-b.year),
  ids:[...ids].sort(),sourceBody,pickupCandidates:selected.includes('pickup'),complete:unresolved.size===0,unresolved:[...unresolved].sort()};
}
