import fs from 'node:fs/promises';
import path from 'node:path';
import {Che168GlobalExactAdapter} from '../apps/web/lib/catalog/che168-global-exact-source.ts';
const directory=process.env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
const source=new Che168GlobalExactAdapter();
const report={productionWrites:false,sourceId:source.sourceId,processed:0,received:0,beforeExactCc:0,afterExactCc:0,beforeExactHp:0,afterExactHp:0,namedFields:0,errors:[]};
let blocked=false;
for(const file of (await fs.readdir(directory)).filter(file=>/^catalog-rebuild-china.*\.json$/.test(file)).sort()) {
 const filename=path.join(directory,file);const data=JSON.parse(await fs.readFile(filename,'utf8'));
 for(const offer of data.offers || []) {
  if(offer.sourceId!==source.sourceId || !offer.operational?.raw?.detail)continue;
  if(blocked)break;
  report.processed++;
  report.beforeExactCc+=Number(offer.operational?.semanticEvidence?.engineCc?.status==='exact');
  report.beforeExactHp+=Number(offer.operational?.semanticEvidence?.powerHp?.status==='exact');
  try {
   const copy=structuredClone(offer);copy.images=await source.refreshSavedSpecifications(copy);
   const status=copy.operational?.specificationCollection?.status;
   if(status==='received_api'||status==='received_api_parameters_only') {
    Object.assign(offer,copy);report.received++;
    report.namedFields+=copy.operational.specificationCollection.fieldCount || 0;
   }
   if(status==='specification_api_unavailable') {blocked=true;report.errors.push({reason:status});}
  } catch(error) {
   const message=String(error?.message || error);
   if(report.errors.length<20)report.errors.push({id:offer.id,reason:message.split(':https:')[0]});
   if(/http_(401|403|429)/.test(message))blocked=true;
  }
  report.afterExactCc+=Number(offer.operational?.semanticEvidence?.engineCc?.status==='exact');
  report.afterExactHp+=Number(offer.operational?.semanticEvidence?.powerHp?.status==='exact');
 }
 await fs.writeFile(filename,JSON.stringify(data));
 await fs.writeFile('che168-specification-refresh.json',JSON.stringify({...report,blocked},null,2));
 if(blocked)break;
}
console.log(JSON.stringify({...report,blocked}));
