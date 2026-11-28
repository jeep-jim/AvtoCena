import {ajesOffer} from './ajes-offer';
import {enrichJapanDrive} from './japan-drive';
import {applyJapanFactoryFuel} from '../encyclopedia/japan-fuel-reference';
import {applyEncyclopediaCalculation,type CalculationIndex} from '../encyclopedia/calculation-index';
import {applyCatalogEditorial,editorialHidden,type CatalogEditorialIndex} from './editorial';
import {applyJapanOwnerSpecifications} from './japan-owner-specifications';
import {catalogInventoryAgeDecision,catalogVehicleExcluded} from './inventory-admission';
import type {CurrencyRateSnapshot} from './rates';
import type {ajesLot} from './ajes-query';

export type AjesAdmissionSnapshot={editorial:CatalogEditorialIndex;calculationIndex:CalculationIndex|null};
/** Shared pure admission for ordinary LIST records and internal counter
 * representatives. Counter representatives never leave the counter evaluator. */
export function applyAjesLotAdmission(lot:NonNullable<ReturnType<typeof ajesLot>>,rate:CurrencyRateSnapshot,observedAt:string,snapshot:AjesAdmissionSnapshot,editorial=true){
 let offer=ajesOffer(lot,rate,observedAt);
 offer=applyJapanFactoryFuel(applyEncyclopediaCalculation(enrichJapanDrive(offer,snapshot.calculationIndex),snapshot.calculationIndex));
 if(editorial&&editorialHidden(offer,snapshot.editorial))return null;
 offer=applyJapanOwnerSpecifications(editorial?applyCatalogEditorial(offer,snapshot.editorial):offer);
 return catalogInventoryAgeDecision(offer).eligible&&!catalogVehicleExcluded(offer)?offer:null;
}
