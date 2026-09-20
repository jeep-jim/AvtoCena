import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {offerSpecificationGroups} from '../apps/web/lib/catalog/offer-specification-groups.ts';
import {parseProAuctionsDetailEvidence} from '../apps/web/lib/catalog/proauctions-detail-evidence.ts';
import {restoreProAuctionsState,proAuctionsStateKey} from './lib/proauctions-durable-state.mjs';
const storage=getJsonStorage(),report={checkedAt:new Date().toISOString(),korea:{},japan:{},errors:[]};
const corpus=new Map();
const korea=await readMarketOffers('korea');
report.korea.rows=korea.length;report.korea.sources={};
for(const offer of korea){
 const source=report.korea.sources[offer.sourceId] ||= {rows:0,withPower:0,withRegistryDate:0,calculated:0};
 source.rows++;source.withPower+=Number(offer.powerHp>0);source.withRegistryDate+=Number(offer.operational?.semanticEvidence?.productionDate?.source==='kcar_registry_production_date');source.calculated+=Number(offer.totalRub>0);
 for(const group of offerSpecificationGroups(offer))for(const item of [{name:'group',value:group.name},...group.items]){
  if(/VIN|차대번호|전화|차량번호|등록번호|номер кузова|телефон/i.test(item.name))continue;
  for(const text of [item.name,item.value])if(/[\uac00-\ud7af]/u.test(text)){
   const record=corpus.get(text)||{text,count:0,fields:[]};record.count++;if(!record.fields.includes(item.name)&&record.fields.length<3)record.fields.push(item.name);corpus.set(text,record);
  }
 }
}
await fs.writeFile('korean-untranslated-corpus.json',JSON.stringify([...corpus.values()].sort((a,b)=>b.count-a.count),null,2));
report.korea.untranslatedUnique=corpus.size;
const japan=await readMarketOffers('japan'),root='gap-audit-japan';
const meta=await storage.readJson(proAuctionsStateKey,null);
if(!meta)throw Error('japan_archive_missing');
await restoreProAuctionsState(root,meta);
const gaps=[];report.japan={rows:japan.length,withPublishedSheet:0,archived:0,sourceHasSheet:0,sourceWithoutSheet:0,missingPublishedSheet:0,archiveMissing:0,parseErrors:0,archiveSavedAt:meta.savedAt};
for(const offer of japan){
 const id=offer.sourceOfferId,hasSheet=(offer.images||[]).some(x=>x.role==='auction_sheet');report.japan.withPublishedSheet+=Number(hasSheet);
 try{
  const raw=JSON.parse(await fs.readFile(`${root}/raw/${id}.json`,'utf8'));
  const bytes=gunzipSync(await fs.readFile(`${root}/html/${id}.html.gz`));
  if(createHash('sha256').update(bytes).digest('hex')!==raw.evidenceSha256)throw Error('html_checksum_mismatch');
  const e=parseProAuctionsDetailEvidence(bytes.toString('utf8'),raw.sourceUrl);report.japan.archived++;
  if(e.auctionSheetUrls.length){report.japan.sourceHasSheet++;if(!hasSheet){report.japan.missingPublishedSheet++;gaps.push({id:offer.id,sourceOfferId:id,sourceUrl:raw.sourceUrl,reason:'sheet_present_in_source',sheets:e.auctionSheetUrls,imageErrors:raw.imageErrors||[]});}}
  else{report.japan.sourceWithoutSheet++;if(!hasSheet)gaps.push({id:offer.id,sourceOfferId:id,sourceUrl:raw.sourceUrl,reason:'no_sheet_in_archived_source'});}
  if(offer.id==='77bec00086e0880050421ebb')report.japan.userExample={id:offer.id,sourceUrl:raw.sourceUrl,hasPublishedSheet:hasSheet,sourceSheets:e.auctionSheetUrls,sourceFields:e.sourceFields,imageErrors:raw.imageErrors||[],sheetSectionExcerpt:bytes.toString('utf8').match(/.{0,100}Аукционный лист[\s\S]{0,1800}/)?.[0]};
 }catch(error){if(error.code==='ENOENT'){report.japan.archiveMissing++;gaps.push({id:offer.id,sourceOfferId:id,reason:'archive_missing'});}else{report.japan.parseErrors++;report.errors.push({id,error:String(error)});}}
}
await fs.writeFile('japan-sheet-gaps.json',JSON.stringify(gaps,null,2));
await fs.writeFile('catalog-launch-gap-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
