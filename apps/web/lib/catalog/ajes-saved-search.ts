import {ajesPowerFilterValues} from './ajes-power-estimate';
import {JAPAN_MIN_MODEL_YEAR} from './japan-year-policy';
import {ajesQuery,type AjesQuery} from './ajes-query';
import {knownHeavyVehicleFamily} from './heavy-vehicle-families';
import {enrichJapanDrive} from './japan-drive';
import type {CalculationIndex} from '../encyclopedia/calculation-index';

/** Recover bounded saved Japan results, always labelled partial; never claim a complete catalog. */
export function findSavedAjesSearch(input:AjesQuery,snapshots:Record<string,any>,now=Date.now(),driveIndex:CalculationIndex|null=null){
 const query=ajesQuery(input,driveIndex);
 if(query.kind!=='list'||query.table!=='stats'||query.page!==1)return null;
 const supported=new Set(['table','page','pageSize','chassis','frameNumber','lotNumber','make','model','modelFamilies','drive','sort','yearFrom','yearTo','powerFrom','powerTo']);
 if(Object.keys(input).some(k=>!supported.has(k)&&input[k as keyof AjesQuery]!==undefined)||input.sort&&input.sort!=='updatedAt')return null;
 const normalized=(v:unknown)=>String(v??'').trim().toUpperCase();
 const makes=input.make?.split(',').map(normalized),models=input.model?.split('|').map(normalized);
 const families=input.modelFamilies?.split('|').map(normalized),drives=input.drive?.split('|');
 const matches=Object.values(snapshots).filter(saved=>{
  const age=now-Date.parse(saved?.observedAt||''),lot=saved?.items?.[0];
  return age>=0&&age<7*86400000&&lot?.table==='stats'&&/^[A-Za-z0-9_-]{1,64}$/.test(lot.id||'')&&lot.make&&lot.model&&lot.year>=JAPAN_MIN_MODEL_YEAR&&lot.year<=new Date(now).getUTCFullYear()+1
   &&/^sold$/i.test(lot.status||'')&&lot.finalPriceJpy>0&&!knownHeavyVehicleFamily(lot.make,lot.model)
   &&((input.powerFrom===undefined&&input.powerTo===undefined)||(()=>{
    const values=ajesPowerFilterValues({sourceId:'ajes_japan_feed',operational:{raw:{sourcePower:lot.sourcePower}}});
    return values.length>0&&values.every(hp=>(input.powerFrom===undefined||hp>=input.powerFrom)&&(input.powerTo===undefined||hp<=input.powerTo));
   })())
   &&(!makes||makes.includes(normalized(lot.make)))
   &&(!models&&!families||Boolean(models?.includes(normalized(lot.model)))||Boolean(families?.some(model=>normalized(lot.model).startsWith(model+' '))))
   &&(!drives||drives.includes(enrichJapanDrive({drive:undefined as string|undefined,market:'japan',make:lot.make,model:lot.model,year:lot.year,trim:lot.trim,chassisCode:lot.chassisCode,operational:{raw:{sourceDrive:lot.sourceDrive}}},driveIndex).drive||''))
   &&(input.yearFrom===undefined||lot.year>=input.yearFrom)&&(input.yearTo===undefined||lot.year<=input.yearTo)
   &&(!input.chassis||normalized(lot.chassisCode)===normalized(input.chassis))
   &&(!input.frameNumber||normalized(lot.frameNumber)===normalized(input.frameNumber))
   &&(!input.lotNumber||String(lot.lot).trim()===input.lotNumber.trim());
 });
 const unique=[...new Map(matches.map(s=>[s.items[0].id,s])).values()];
 unique.sort((a,b)=>String(b.items[0].auctionDate).localeCompare(String(a.items[0].auctionDate))||String(a.items[0].id).localeCompare(String(b.items[0].id)));
 const selected=unique.slice(0,query.pageSize);
 if(!selected.length)return null; // No saved match is not proof of zero supplier matches.
 return {schemaVersion:2,items:selected.map(s=>s.items[0]),page:1,pageSize:query.pageSize,received:selected.length,rejected:0,
  observedAt:selected.map(s=>s.observedAt).sort()[0],partial:true,stale:true};
}


/** Known names only: a saved sample never supplies inventory/model counts. */
export function savedAjesFacets(snapshots:Record<string,any>,now=Date.now()){
 const models=new Map<string,{make:string;model:string}>();
 for(const saved of Object.values(snapshots)){
  const lot=saved?.items?.[0],age=now-Date.parse(saved?.observedAt||'');
  if(!(age>=0&&age<7*86400000)||lot?.table!=='stats'||!lot.make||!lot.model||! /^[A-Za-z0-9_-]{1,64}$/.test(lot.id||'')||!Number.isInteger(lot.year)||lot.year<JAPAN_MIN_MODEL_YEAR||lot.year>new Date(now).getUTCFullYear()+1||!/^sold$/i.test(lot.status||'')||!(lot.finalPriceJpy>0)||knownHeavyVehicleFamily(lot.make,lot.model))continue;
  models.set(JSON.stringify([lot.make,lot.model]),{make:lot.make,model:lot.model});
 }
 return {makes:[...new Set([...models.values()].map(m=>m.make))].sort(),models:[...models.values()]};
}

/** Exact stock selection from the same bounded, already received cache only.
 * No supplier calls or total-count claim; admission and delivered filters run downstream. */
export function findSavedAjesStockSearch(input:AjesQuery,snapshots:Record<string,any>,now=Date.now()){
 const query=ajesQuery(input);
 if(query.kind!=='list'||!['korea','china'].includes(query.table)||query.page!==1||!input.make)return null;
 const supported=new Set(['table','page','pageSize','make','model','sort','yearFrom','yearTo','sourcePriceTo','powerFrom','powerTo']);
 if(Object.keys(input).some(k=>!supported.has(k)&&input[k as keyof AjesQuery]!==undefined)||input.sort&&!['updatedAt','totalRub','totalRubDesc'].includes(input.sort))return null;
 const norm=(value:unknown)=>String(value??'').trim().toUpperCase();
 const makes=input.make.split(',').map(norm),models=input.model?.split('|').map(norm),year=new Date(now).getUTCFullYear();
 const matches=Object.values(snapshots).filter(saved=>{
  const lot=saved?.items?.[0],age=now-Date.parse(saved?.observedAt||'');
  return age>=0&&age<7*86400000&&lot?.table===query.table&&/^[A-Za-z0-9_-]{1,64}$/.test(lot.id||'')
   &&Number.isInteger(lot.year)&&lot.year>=year-6&&lot.year<=year&&Number.isFinite(lot.sourcePrice)&&lot.sourcePrice>0
   &&! /^(sold|removed|withdrawn|deleted)$/i.test(lot.status||'')&&!knownHeavyVehicleFamily(lot.make,lot.model)
   &&makes.includes(norm(lot.make))&&(!models||models.includes(norm(lot.model)))
   &&(input.yearFrom===undefined||lot.year>=input.yearFrom)&&(input.yearTo===undefined||lot.year<=input.yearTo)
   &&(input.sourcePriceTo===undefined||lot.sourcePrice<=input.sourcePriceTo)
   &&((input.powerFrom===undefined&&input.powerTo===undefined)||(/^\d+(?:\.\d+)?$/.test(String(lot.sourcePower||''))&&Number(lot.sourcePower)>0&&(input.powerFrom===undefined||Number(lot.sourcePower)>=input.powerFrom)&&(input.powerTo===undefined||Number(lot.sourcePower)<=input.powerTo)));
 });
 const unique=[...new Map(matches.map(saved=>[saved.items[0].id,saved])).values()];
 unique.sort((a,b)=>(input.sort==='totalRub'?a.items[0].sourcePrice-b.items[0].sourcePrice:input.sort==='totalRubDesc'?b.items[0].sourcePrice-a.items[0].sourcePrice:0)||String(b.items[0].id).localeCompare(String(a.items[0].id)));
 const selected=unique.slice(0,query.pageSize);if(!selected.length)return null;
 return {schemaVersion:2,items:selected.map(s=>s.items[0]),page:1,pageSize:query.pageSize,received:selected.length,rejected:0,
  observedAt:selected.map(s=>s.observedAt).sort()[0],partial:true,stale:true};
}
