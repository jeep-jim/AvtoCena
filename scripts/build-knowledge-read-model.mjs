// Compile once in CI/image build, never while a visitor opens a brand page.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDirectoryModels,summarizeModel} from '../apps/web/lib/catalog/model-directory.ts';
import {readEncyclopediaKnowledgeVariants} from '../apps/web/lib/catalog/encyclopedia.ts';
import {readBundledChunkedDataJson} from '../apps/web/lib/bundled-data.ts';
import {canonicalCatalogBrand,catalogBrandSlug} from '../apps/web/lib/catalog/brands.ts';
import {vehicleKnowledgeCompact} from '../apps/web/lib/catalog/vehicle-knowledge.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/catalog/knowledge-read-model');
const [models,variants,references]=await Promise.all([readDirectoryModels(),readEncyclopediaKnowledgeVariants(),readBundledChunkedDataJson('catalog/power-knowledge/vehicles.json',[])]);
const key=(make,model)=>`${canonicalCatalogBrand(make)}:${vehicleKnowledgeCompact(model)}`;
const byModel=new Map(),byRef=new Map(),byBrand=new Map(),summary={};
const add=(map,id,row)=>{const rows=map.get(id)||[];rows.push(row);map.set(id,rows);};
for(const row of variants)if(row.active!==false)add(byModel,row.modelId,row);
for(const row of references)if(row.active!==false)add(byRef,key(row.make,row.model),row);
for(const model of models){
 const vs=byModel.get(model.id)||[],refs=byRef.get(key(model.make,model.model))||[];
 summary[model.id]=summarizeModel(model,vs,refs);
 for(const row of [...vs,...refs]){
  const official=row.sourceType==='manufacturer'||row.sourceType==='official_registry'||row.confidence==='manufacturer'||row.confidence==='registry'||row.encyclopediaStatus==='verified'||row.encyclopediaEvidenceOfficial===true;
  const value={id:row.id,modelId:model.id,make:model.make,model:model.model,name:(row.trimContains||[]).join(' ')||(typeof row.generation==='string'?row.generation:undefined),yearFrom:row.yearFrom,yearTo:row.yearTo,market:row.market,engineCc:row.engineCc,fuel:row.fuel,powerHp:row.powerHp,powerKw:row.powerKw,powertrainKind:row.powertrainKind,icePowerKw:row.icePowerKw,power30MinKw:row.power30MinKw,sourceIds:(row.sourceIds||[]).slice(0,6),sourceUrl:row.sourceUrl,verifiedAt:row.verifiedAt,status:official?'reference':'observation'};
  add(byBrand,catalogBrandSlug(model.make),value);
 }
}
await fs.mkdir(root,{recursive:true});
await fs.writeFile(path.join(root,'summary.json'),JSON.stringify(summary));
let bytes=0,count=0;
for(const [brand,rows] of byBrand){const text=JSON.stringify([...new Map(rows.map(r=>[r.id,r])).values()]);bytes+=Buffer.byteLength(text);count+=rows.length;await fs.writeFile(path.join(root,brand+'.json'),text);}
console.log(JSON.stringify({knowledgeReadModel:{models:models.length,variants:count,brands:byBrand.size,bytes}}));
