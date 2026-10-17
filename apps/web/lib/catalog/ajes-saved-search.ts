import {JAPAN_MIN_MODEL_YEAR} from './japan-year-policy';
import {ajesQuery,type AjesQuery} from './ajes-query';
import {knownHeavyVehicleFamily} from './heavy-vehicle-families';

/** Recover exact identities and model selections only, never turn a sample into the complete catalog. */
export function findSavedAjesSearch(input:AjesQuery,snapshots:Record<string,any>,now=Date.now()){
 const query=ajesQuery(input);
 if(query.kind!=='list'||query.table!=='stats'||query.page!==1||!(input.chassis||input.frameNumber||input.lotNumber||input.make||input.model))return null;
 const supported=new Set(['table','page','pageSize','chassis','frameNumber','lotNumber','make','model','sort','yearFrom','yearTo']);
 if(Object.keys(input).some(k=>!supported.has(k)&&input[k as keyof AjesQuery]!==undefined)||input.sort&&input.sort!=='updatedAt')return null;
 const normalized=(v:unknown)=>String(v??'').trim().toUpperCase();
 const makes=input.make?.split(',').map(normalized),models=input.model?.split('|').map(normalized);
 const matches=Object.values(snapshots).filter(saved=>{
  const age=now-Date.parse(saved?.observedAt||''),lot=saved?.items?.[0];
  return age>=0&&age<7*86400000&&lot?.table==='stats'&&/^[A-Za-z0-9_-]{1,64}$/.test(lot.id||'')&&lot.make&&lot.model&&lot.year>=JAPAN_MIN_MODEL_YEAR&&lot.year<=new Date(now).getUTCFullYear()+1
   &&/^sold$/i.test(lot.status||'')&&lot.finalPriceJpy>0&&!knownHeavyVehicleFamily(lot.make,lot.model)
   &&(!makes||makes.includes(normalized(lot.make)))&&(!models||models.includes(normalized(lot.model)))
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
