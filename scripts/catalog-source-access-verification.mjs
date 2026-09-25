import fs from 'node:fs/promises';
const imported=await import('../apps/web/lib/catalog/importer.ts');
const catalogImportSources=imported.catalogImportSources||imported.default?.catalogImportSources;
const ids=['encar_direct','dubizzle_uae_open','dubicars_uae_exact','carswitch_uae_open','myauto_georgia_list','autopapa_georgia_open'];
const report={checkedAt:new Date().toISOString(),productionWrites:false,scope:'one configured first-page attempt per source; no details, no extra retries',sources:[]};
for(const id of ids){
 const adapter=catalogImportSources.find(s=>s.sourceId===id);
 try{
  if(!adapter)throw Error('adapter_missing');
  const page=await adapter.fetchPage(null);
  report.sources.push({sourceId:id,items:page.items.length,nextCursor:page.nextCursor,health:page.health,diagnostics:page.diagnostics});
 }catch(error){report.sources.push({sourceId:id,error:String(error.message)});}
 await fs.writeFile('catalog-source-access.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.sources.at(-1)));
}
console.log(JSON.stringify(report));
