import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {completePowerUnitDraft} from '../apps/web/lib/catalog/power-parameter-draft';
import {offerPrecedentParameterDraft} from '../apps/web/lib/catalog/power30-precedent';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {managementFactValues,managementParameters,managementSavedDraft,rememberManagementCalculation,rememberEncyclopediaModel,readManagementKnowledge,encyclopediaWithManagement,attachManagementKnowledge,managementDraft,invalidateManagementPrice} from '../apps/web/lib/catalog/management-knowledge';
import {encyclopediaReviewDisplay,variantReviewClass} from '../apps/web/components/encyclopedia/review-state';
const source:any={id:'card',make:'Changan',model:'A06',year:2026,fuel:'hybrid',engineCc:1497,powerHp:98,powerKw:72.0788775,powertrainKind:'series_hybrid',icePowerKw:72,power30MinKw:40,drive:'rwd',transmission:'automatic',bodyType:'sedan'};
const draft=(kw:number)=>({year:'2026',fuel:'hybrid',engineCc:'1497',powerHp:'98',powerKw:'72.0788775',hybridKind:'series_hybrid',icePowerKw:'72',power30MinKw:String(kw),deliveryCity:''});
const at=(n:number)=>`2026-11-01T10:${String(n).padStart(2,'0')}:00.000Z`;
async function memory(run:(map:Map<string,any>)=>Promise<void>){
 const map=new Map<string,any>();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string,fallback:any)=>({found:map.has(key),value:structuredClone(map.get(key)??fallback)}));
 const write=mock.method(LocalJsonStorage.prototype,'writeJson',async(key:string,value:any)=>{map.set(key,structuredClone(value));});
 try{await run(map);}finally{read.mock.restore();write.mock.restore();}
}
function model(kw:number,n:number,extra:any={}){return {id:'model',make:'Changan',model:'A06',revision:`ency-${n}`,updatedAt:at(n),editedBy:'owner',variants:[{...source,id:'variant',power30MinKw:kw,manualEditedAt:at(n),status:'verified',markets:[],observedCount:1,...extra}]} as any;}
test('hybrid corrections round-trip 40 → 45 → 60 → 70 → 45 with blue/green review and preserved archive inputs',async()=>memory(async map=>{
 const original=model(40,0);map.set('previous',original);
 await rememberManagementCalculation(source,{version:'card-1',savedAt:at(1),savedBy:'owner',draft:draft(45)});
 let index=await readManagementKnowledge(true);
 let view=encyclopediaWithManagement(original,index);
 assert.equal(view.variants[0].power30MinKw,45);
 const [learned]=await attachManagementKnowledge([{...source,id:'recipient'}],true);
 const input=managementDraft(learned,completePowerUnitDraft(draft(40)));assert.equal(input.power30MinKw,'45');assert.ok(Math.abs(Number(input.power30MinHp)*0.73549875-45)<0.001);
 assert.equal(variantReviewClass(encyclopediaReviewDisplay(original,view).variants[0]),'ac-ency-row-review');
 const canonical={...model(60,2,{managementBaseline:view.variants[0]}),previousKey:'previous'};
 await rememberEncyclopediaModel(canonical);index=await readManagementKnowledge(true);
 const archived=draft(45);assert.equal(managementSavedDraft(source,archived,at(1),index).power30MinKw,'60');assert.equal(archived.power30MinKw,'45');
 assert.equal(managementParameters({...source,id:'future-card'},index).power30MinKw,60);
 assert.equal(variantReviewClass(encyclopediaReviewDisplay(canonical,encyclopediaWithManagement(canonical,index)).variants[0]),'ac-ency-row-verified');
 await rememberManagementCalculation(source,{version:'card-2',savedAt:at(3),savedBy:'owner',draft:draft(70)},draft(60));index=await readManagementKnowledge(true);
 view=encyclopediaWithManagement(canonical,index);
 assert.equal(view.variants[0].power30MinKw,70);
 assert.equal(variantReviewClass(encyclopediaReviewDisplay(canonical,view).variants[0]),'ac-ency-row-review');
 assert.equal(managementParameters({...source,id:'future-card'},index).power30MinKw,70,'older encyclopedia revision must not veto its newer card correction');
 map.set('previous',canonical);
 const reverted={...model(45,4,{managementBaseline:view.variants[0]}),previousKey:'previous'};
 await rememberEncyclopediaModel(reverted);index=await readManagementKnowledge(true);
 assert.equal(managementSavedDraft(source,draft(70),at(3),index).power30MinKw,'45');
 assert.equal(managementSavedDraft(source,draft(80),at(5),index).power30MinKw,'80','later explicit card save wins');
 assert.equal(source.power30MinKw,40,'supplier facts are unchanged');
}));
test('revision corrections preserve incompatible hybrids, unknown old conflicts, explicit edits and per-motor evidence',async()=>memory(async map=>{
 const old=model(40,0);map.set('previous',old);
 await rememberEncyclopediaModel({...model(60,1),previousKey:'previous'});const index=await readManagementKnowledge(true);
 for(const patch of [{year:2025},{drive:'awd'},{powertrainKind:'other_hybrid'},{power30MinKw:75},{editorialSpecifications:{power30MinKw:'40'}},{manualEditedAt:at(2)}])assert.equal(managementParameters({...source,id:'recipient',...patch},index).power30MinKw,undefined);
 assert.equal(managementParameters({...source,id:'recipient',power30MinKwByMotor:[20,20]},index).power30MinKw,undefined);
 const weak=structuredClone(index);const fact=Object.values(weak.models['changan:a06'])[0];fact.previousValues!.forEach(v=>delete v.drive);fact.values.drive='awd';
 assert.equal(managementParameters({...source,id:'recipient'},weak).power30MinKw,undefined,'missing prior drive cannot explain a new conflicting drive');
}));
test('cleared hybrid power removes a stale total without inventing zero or reviving an older card value',async()=>memory(async map=>{
 await rememberManagementCalculation(source,{version:'card',savedAt:at(1),savedBy:'owner',draft:draft(45)});
 map.set('previous',model(45,1));const cleared=model(45,2);delete cleared.variants[0].power30MinKw;
 await rememberEncyclopediaModel({...cleared,previousKey:'previous'});
 const target={...source,power30MinKw:45,totalRub:3000000,savedCalculationPreview:{totalRub:3000000}};
 const [learned]=await attachManagementKnowledge([target],true);
 assert.equal(completePowerUnitDraft(managementDraft(learned,completePowerUnitDraft(draft(45)))).power30MinKw,'');
 assert.equal(offerPrecedentParameterDraft(learned).power30MinKw,'','clearing must not revive a stale hp conversion or estimated precedent');
 assert.equal(invalidateManagementPrice(learned).totalRub,null);assert.equal(invalidateManagementPrice(learned).savedCalculationPreview,undefined);
 assert.equal(managementSavedDraft(source,draft(45),at(1),await readManagementKnowledge(true)).power30MinKw,'');
}));
test('confirmation of a staff row retains its originating card and stops duplicate blue contributions',async()=>memory(async()=>{
 await rememberManagementCalculation(source,{version:'card',savedAt:at(1),savedBy:'owner',draft:draft(45)});
 const linked=model(60,2,{managementOfferId:'card',managementBaseline:{...source,power30MinKw:45}});
 await rememberEncyclopediaModel(linked);let index=await readManagementKnowledge(true);
 assert.equal(encyclopediaWithManagement(linked,index).variants.length,1);
 assert.equal(managementSavedDraft(source,draft(45),at(1),index).power30MinKw,'60');
 await rememberManagementCalculation(source,{version:'card-next',savedAt:at(3),savedBy:'owner',draft:draft(70)},draft(60));index=await readManagementKnowledge(true);
 assert.equal(encyclopediaWithManagement(linked,index).variants.length,1);
 assert.equal(encyclopediaWithManagement(linked,index).variants[0].power30MinKw,70);
}));
test('editing another row does not renew the age of an unchanged canonical fact',async()=>memory(async()=>{
 const first=model(45,1);await rememberEncyclopediaModel(first);
 await rememberManagementCalculation(source,{version:'card',savedAt:at(2),savedBy:'owner',draft:draft(60)},draft(45));
 await rememberEncyclopediaModel({...first,revision:'unrelated',updatedAt:at(3)});
 const index=await readManagementKnowledge(true);
 assert.equal(index.models['changan:a06']['encyclopedia:model:variant'].savedAt,at(1));
 assert.equal(managementSavedDraft(source,draft(60),at(2),index).power30MinKw,'60');
}));

test('revision baselines contain only scalar vehicle facts, never recursive prior metadata',()=>{
 const values=managementFactValues({...source,managementBaseline:{managementBaseline:source},researchEvidence:{private:true},managementOfferId:'card'});
 assert.equal(values.managementBaseline,undefined);assert.equal(values.researchEvidence,undefined);assert.equal(values.managementOfferId,undefined);assert.equal(values.power30MinKw,40);
});
