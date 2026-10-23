import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEncyclopediaCalculation,compileModelFacts,checksum,modelKey} from '../apps/web/lib/encyclopedia/calculation-index';
import {publicOffer,searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';
import {catalogSemanticEvidenceRejectionReason} from '../apps/web/lib/catalog/offer-quality';

const trim='Sportback 35 TDI S-Line *PANO*MATRIX*B&O*';
const bodyEvidence={status:'ambiguous',source:'mobile.de consumer SRP/VIP category',rawValues:['Limousine','Limousine, Gebrauchtfahrzeug']};
const source=()=>({id:'061974864a6a9708c3084fc8',sourceId:'mobile_de_open',market:'europe',make:'Audi',model:'A3',year:2020,trim,
 fuel:'diesel',powertrainKind:'combustion',engineCc:1968,powerHp:150,powerKw:110,icePowerKw:110,transmission:'automatic',images:[],
 operational:{semanticEvidence:{bodyType:structuredClone(bodyEvidence)}}});
function index(kind='manufacturer',bodyType='hatchback'){
 const variant={id:'2b87bcd25d86cb99e9005934',year:2020,trim,status:'review',bodyType,
  researchEvidence:{batchId:'research-2026-10-23-audi-a3-early-and-body',checkedIdentity:{make:'Audi',model:'A3',year:2020,trim},fields:['bodyType'],values:{bodyType},source:{type:kind,url:'https://audi-press.jp/press-releases/2021/b7rqqm000001a883.html'}}};
 const models={[modelKey('Audi','A3')]:compileModelFacts({id:'model',make:'Audi',model:'A3',revision:'r1',variants:[variant]})};
 return {version:1 as const,digest:checksum(models),manifestDigest:'test',createdAt:'2026-10-24',models};
}
test('an exact factory body resolves only the unassigned mobile.de Limousine bucket and retains its provenance',()=>{
 const input=source(),before=structuredClone(input),i=index(),matched:any=applyEncyclopediaCalculation(input,i);
 assert.equal(matched.bodyType,'hatchback');
 assert.deepEqual(matched.operational.semanticEvidence.bodyType.resolvedSourceEvidence,bodyEvidence);
 assert.equal(matched.operational.semanticEvidence.bodyType.status,'exact');
 assert.equal(catalogSemanticEvidenceRejectionReason(matched),'');
 assert.equal(publicOffer(matched).bodyType,'hatchback');
 assert.equal(searchProjectionFromOffer(matched).bodyType,'hatchback');
 assert.equal(applyEncyclopediaCalculation(matched,i),matched);
 const retired:any=applyEncyclopediaCalculation(matched,{...i,digest:'empty',models:{}});
 assert.equal(retired.bodyType,undefined);
 assert.deepEqual(retired.operational.semanticEvidence.bodyType,bodyEvidence,'retiring a factory fact restores the original source limitation');
 assert.deepEqual(input,before);
});
test('source contradictions, other ambiguous categories, missing proof and manual edits remain protected',()=>{
 for(const evidence of [
  {...bodyEvidence,status:'conflict'}, {...bodyEvidence,rawValues:[]}, {...bodyEvidence,rawValues:['Limousine','Cabrio']},
  {...bodyEvidence,rawValues:['unknown']}, {...bodyEvidence,rawValues:['Limousine, unknown']}, {...bodyEvidence,source:'unrelated'},
 ]){const input={...source(),operational:{semanticEvidence:{bodyType:evidence}}};assert.equal((applyEncyclopediaCalculation(input,index()) as any).bodyType,undefined);}
 for(const patch of [{sourceId:'another_source'},{year:2021},{trim:'Sportback 30 TDI'},{powerDataSource:'customer_input'}])
  assert.equal((applyEncyclopediaCalculation({...source(),...patch},index()) as any).bodyType,undefined);
 assert.equal((applyEncyclopediaCalculation({...source(),bodyType:'sedan'},index()) as any).bodyType,'sedan');
 assert.equal((applyEncyclopediaCalculation(source(),index('unreviewed')) as any).bodyType,undefined);
 const i=index();i.models[modelKey('Audi','A3')][0].sources.bodyType={kind:'owner_reference',markets:['europe']};
 assert.equal((applyEncyclopediaCalculation(source(),i) as any).bodyType,undefined);
 for(const patch of [{url:'http://audi.example/body'},{batchId:undefined}]){
  const unbound=index();Object.assign(unbound.models[modelKey('Audi','A3')][0].sources.bodyType!,patch);
  assert.equal((applyEncyclopediaCalculation(source(),unbound) as any).bodyType,undefined);
 }
 const conflicting=index(),second=structuredClone(conflicting.models[modelKey('Audi','A3')][0]);
 second.variantId='another';second.values.bodyType='sedan';second.constraints.bodyType='sedan';conflicting.models[modelKey('Audi','A3')].push(second);
 assert.equal((applyEncyclopediaCalculation(source(),conflicting) as any).bodyType,undefined,'conflicting factory candidates cannot resolve a bucket');
 assert.equal((applyEncyclopediaCalculation(source(),index()) as any).power30MinKw,undefined);
});
