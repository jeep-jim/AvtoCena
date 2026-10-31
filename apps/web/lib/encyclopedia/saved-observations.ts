import {ajesDetailValues,ajesSourceDetails} from '../catalog/ajes-source-details';
import {namedElectrifiedPowertrainKind} from '../catalog/powertrain-safety';
import {retainedAjesQueryEntries} from '../catalog/ajes-query-cache';

/** Read already viewed lots, including retained query collisions. Never call a supplier. */
export function savedAjesLots(saved:any):any[]{
 const responses=saved?.hash?retainedAjesQueryEntries(saved).map(entry=>entry.value):[saved];
 return responses.flatMap(value=>Array.isArray(value?.items)?value.items:[])
  .filter(lot=>['stats','korea'].includes(lot?.table)&&lot.id&&lot.make&&lot.model);
}

/** Keep missing fields missing. An explicit Hybrid trim is identity evidence,
 * not evidence of horsepower, hybrid architecture or certified 30-minute power. */
export function savedAjesObservation(lot:any){
 const extra:Partial<ReturnType<typeof ajesDetailValues>>=lot.table==='korea'?ajesDetailValues(lot.sourceDetails||ajesSourceDetails(lot.info)):{};
 const sourceFuel=String(lot.sourceFuel||'').trim().toUpperCase();
 const fuel=({P:'petrol',D:'diesel',E:'electric',H:'hybrid',HE:'hybrid',L:'lpg',C:'cng'} as Record<string,string>)[sourceFuel]||extra.fuel;
 const named=namedElectrifiedPowertrainKind({make:lot.make,model:lot.model,trim:lot.trim,year:lot.year});
 const sourcePower=String(lot.sourcePower||'').trim();
 const powerHp=lot.table==='korea'?(/^\d+(?:\.\d+)?$/.test(sourcePower)?Number(sourcePower):!sourcePower?extra.horsepower:undefined):undefined;
 return {
  make:lot.make,model:lot.model,year:lot.year,trim:lot.trim,chassisCode:lot.chassisCode,
  engineCc:lot.engineCc||extra.engineCc,powerHp,bodyType:extra.bodyType,
  fuel:fuel|| (named==='electric'?'electric':named?'hybrid':undefined),
  powertrainKind:sourceFuel==='HE'?'series_hybrid':fuel==='electric'?'electric':undefined,
  drive:({FF:'fwd',FR:'rwd',FWD:'fwd',RWD:'rwd',AWD:'awd','4WD':'awd',FULLTIME4WD:'awd'} as Record<string,string>)[String(lot.sourceDrive||'').toUpperCase()]||extra.drive,
  transmission:({AT:'automatic',MT:'manual',CVT:'cvt',DCT:'dct'} as Record<string,string>)[String(lot.sourceTransmission||'').toUpperCase()]||extra.transmission,
  photo:lot.images?.[0]?.url,market:lot.table==='stats'?'japan':'korea',
  sourceUrl:`https://avtocena.com/cars/offer/ajes-${lot.table}-${lot.id}`,
 };
}
