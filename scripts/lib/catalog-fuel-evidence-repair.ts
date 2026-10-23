import {createHash} from 'node:crypto';
import {compactFuelPowertrainEvidence,classifySpecificationEvidence} from '../../apps/web/lib/catalog/specification-evidence-audit';
import {hasFuelPowertrainEvidence} from '../../apps/web/lib/catalog/fuel-powertrain-evidence';

export const fuelRepairDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Evidence only: no source parameters, prices, identity or manual fields move. */
export function repairFuelEvidence(row:any,source:any){
 if(!row || !source || !/^[a-f0-9]{24}$/.test(row.id) || row.id!==source.id)throw Error('fuel_repair_identity');
 const proof=compactFuelPowertrainEvidence(source);
 if(!proof || classifySpecificationEvidence(source,'fuelPowertrain').state!=='exact')throw Error('fuel_repair_source_unconfirmed');
 if(!hasFuelPowertrainEvidence({...row,fuelPowertrainEvidence:proof}))throw Error('fuel_repair_values_changed');
 if(row.fuelPowertrainEvidence){
  if(fuelRepairDigest(row.fuelPowertrainEvidence)!==fuelRepairDigest(proof))throw Error('fuel_repair_existing_evidence_conflict');
  return row;
 }
 const next={...row,fuelPowertrainEvidence:proof};
 if(classifySpecificationEvidence(next,'fuelPowertrain').state!=='exact')throw Error('fuel_repair_projection_conflict');
 return next;
}

export function repairFuelRows(items:any[],sources:Map<string,any>){
 if(!Array.isArray(items))throw Error('fuel_repair_items');
 const changed:string[]=[],found:string[]=[],seen=new Set<string>();
 const rows=items.map(row=>{
  if(!sources.has(row?.id))return row;
  if(seen.has(row.id))throw Error('fuel_repair_duplicate');
  seen.add(row.id);found.push(row.id);
  const next=repairFuelEvidence(row,sources.get(row.id));
  if(next!==row)changed.push(row.id);
  return next;
 });
 return {items:rows,found,changed};
}
