import {getJsonStorage} from '../apps/web/lib/data.ts';
import {catalogGenerationId,readCurrentPublicCatalogProjection} from '../apps/web/lib/catalog/storage.ts';
import {readEncyclopediaIdentityResolver} from '../apps/web/lib/catalog/encyclopedia-identity-data.ts';
import {readEncyclopediaKnowledgeVariants} from '../apps/web/lib/catalog/encyclopedia.ts';
import {createSnapshotBuilder,publishSnapshot} from '../apps/web/lib/encyclopedia/snapshot.ts';
import {modelId,MANIFEST} from '../apps/web/lib/encyclopedia/records.ts';
import {ajesDetailValues,ajesSourceDetails} from '../apps/web/lib/catalog/ajes-source-details.ts';
import {catalogVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission.ts';
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
if(await storage.readJson(MANIFEST,null)){console.log(JSON.stringify({alreadyCreated:true,unchanged:true}));process.exit(0);}
const at=new Date().toISOString(),generationId=await catalogGenerationId();
const [projection,resolver]=await Promise.all([readCurrentPublicCatalogProjection(),readEncyclopediaIdentityResolver()]);
if(!projection.rows.length||projection.generationId!==generationId)throw Error('current_catalog_snapshot_unavailable');
const builder=createSnapshotBuilder(at);
const add=(row,origin='observed')=>{const identity=resolver?.resolve({make:row.make,model:row.model});builder.add({...row,make:identity?.brandId?identity.canonicalMake:row.make,model:identity?.modelId?identity.canonicalModel:row.model},origin);};
for(const row of projection.rows)add({...row,sourceUrl:`https://avtocena.com/cars/offer/${row.id}`});
// Only existing bounded cache: no bulk supplier requests, no credentials copied.
let savedSearchRows=0;const seen=new Set();
for(let start=0;start<128;start+=8){
 const slots=await Promise.all(Array.from({length:8},(_,i)=>storage.readJson(`catalog/partner-cache/ajes/queries/${start+i}.json`,null)));
 for(const slot of slots)for(const lot of slot?.value?.items||[]){
  if(!['stats','korea'].includes(lot.table)||!lot.make||!lot.model||!lot.id)continue;
  const key=`${lot.table}:${lot.id}`;if(seen.has(key))continue;seen.add(key);
  const extra=lot.table==='korea'?ajesDetailValues(lot.sourceDetails||ajesSourceDetails(lot.info)):{};
  const fuel=({P:'petrol',D:'diesel',E:'electric',H:'hybrid',HE:'hybrid',L:'lpg',C:'cng'})[String(lot.sourceFuel).toUpperCase()]||extra.fuel;
  const hp=lot.table==='korea'&&/^\d+(\.\d+)?$/.test(lot.sourcePower)?Number(lot.sourcePower):extra.horsepower;
  const row={make:lot.make,model:lot.model,year:lot.year,trim:lot.trim,chassisCode:lot.chassisCode,engineCc:lot.engineCc||extra.engineCc,powerHp:hp,bodyType:extra.bodyType,fuel,powertrainKind:lot.sourceFuel==='HE'?'series_hybrid':fuel==='electric'?'electric':undefined,drive:({FF:'fwd',FR:'rwd',FWD:'fwd',RWD:'rwd',AWD:'awd','4WD':'awd'})[String(lot.sourceDrive).toUpperCase()],transmission:({AT:'automatic',MT:'manual',CVT:'cvt',DCT:'dct'})[String(lot.sourceTransmission).toUpperCase()],photo:lot.images?.[0]?.url,market:lot.table==='stats'?'japan':'korea',sourceUrl:`https://avtocena.com/cars/offer/ajes-${lot.table}-${lot.id}`};
  if(catalogVehicleExcluded(row))continue;add(row);savedSearchRows++;
 }
}
// Preserve documented reference variants only for models present in this snapshot.
const references=await readEncyclopediaKnowledgeVariants();
for(const v of references){
 if(v.active===false||!['manufacturer','official_registry','manual'].includes(v.sourceType)&&!(v.encyclopediaStatus==='verified'||v.encyclopediaEvidenceOfficial===true))continue;
 const identity=resolver?.resolve({make:v.make,model:v.model});const make=identity?.brandId?identity.canonicalMake:v.make,model=identity?.modelId?identity.canonicalModel:v.model;
 if(!builder.models.has(modelId(make,model)))continue;
 const from=v.yearFrom,to=v.yearTo||from;
 if(from&&to&&to>=from&&to-from<=100)for(let year=from;year<=Math.min(to,new Date().getFullYear()+1);year++)add({...v,make,model,year,trim:v.variantName||v.trimContains?.join(' / ')},'reference');
}
if(await catalogGenerationId()!==generationId)throw Error('catalog_changed_during_snapshot_retry_required');
const result=await publishSnapshot(storage,builder,generationId,savedSearchRows,at);
console.log(JSON.stringify({created:true,models:result.models.length,variants:result.models.reduce((n,m)=>n+m.variants,0),coverage:result.coverage,savedSearchRows,capturedAt:at}));
