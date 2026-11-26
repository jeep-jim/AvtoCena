import {catalogGrossVehicleWeightKg,catalogHeavyVehicleExcluded} from './inventory-admission';
import {motorcycleExcluded} from './motorcycle-policy';
import {catalogBodyType} from './pickup-body';

/** Explicit Japan catalog exclusions requested by the owner on 22.10.2026.
 * Independent of logo availability: do not remove passenger makes for a missing asset.
 */
const excluded=['FRUEHAUF','GM','HINO','HITACHI','KOMATSU','OTHERS','SUMITOMO','TADANO','TCM','TRAILER'];
export const japanExcludedMake=(make:unknown)=>excluded.includes(String(make||'').normalize('NFKC').trim().toUpperCase());
export const japanMakeSqlExclusion=()=>`marka_name not in (${excluded.map(v=>"'"+v+"'").join(',')})`;

const text=(value:unknown)=>String(value||'').normalize('NFKC').trim().toUpperCase();
const token=(value:string)=>`(^|[^A-Z0-9])(${value})([^A-Z0-9]|$)`;
const busIdentityPattern=token('BUS|MINI[ -]?BUS|MICRO[ -]?BUS')+'|АВТОБУС|巴士|バス';
const coachPattern=token('COACH');
const specialPattern=token('DUMP|DUMPER|CRANE|FORK[ -]?LIFT|EXCAVATOR|BULL[ -]?DOZER|TRACTOR|MACHINERY|AMBULANCE|FIRE[ -]?(ENGINE|TRUCK)|CONCRETE[ -]?MIXER|TANKER')
 +'|ПОГРУЗЧИК|ЭКСКАВАТОР|БУЛЬДОЗЕР|ТРАКТОР|АВТОКРАН|САМОСВАЛ|СПЕЦТЕХНИК|工程机械|ダンプ|クレーン|フォークリフト|ブルドーザー|トラクター|高所作業車|消防車|救急車';
const busIdentity=new RegExp(busIdentityPattern,'u'),coach=new RegExp(coachPattern,'u'),special=new RegExp(specialPattern,'u');

function boundSpecifications(offer:any){
 const snapshot=offer.operational?.sourceSpecifications;
 return typeof offer.sourceId==='string'&&Boolean(offer.sourceId)&&typeof offer.sourceOfferId==='string'&&Boolean(offer.sourceOfferId)
  &&snapshot?.sourceId===offer.sourceId&&snapshot.sourceOfferId===offer.sourceOfferId?snapshot:undefined;
}

/** One Japan admission decision for fresh lots, old saved rows and full details.
 * A VAN label or N1 category alone never turns a light/passenger van into a truck.
 * Only an explicit permitted gross mass is used; curb mass and payload are not substitutes.
 */
export function japanVehicleExcluded(offer:any):boolean {
 if(!offer||offer.market&&offer.market!=='japan')return false;
 if(japanExcludedMake(offer.make))return true;
 const snapshot=boundSpecifications(offer);
 const boundBody=(Array.isArray(snapshot?.groups)?snapshot.groups:[]).flatMap((group:any)=>(Array.isArray(group?.items)?group.items:[])
  .filter((item:any)=>/^(?:级别|车身结构|车辆类型|тип кузова|класс автомобиля|body type|vehicle type)$/i.test(String(item.name||'').trim()))
  .map((item:any)=>text(item.value))).join(' ');
 const model=text(offer.model),trim=text(offer.trim),body=text(offer.bodyType)+' '+boundBody;
 if(/^M[23]G?$/.test(text(offer.vehicleCategory))||busIdentity.test(model+' '+trim+' '+body)||coach.test(model+' '+body))return true;
 // Equipment and free-form INFO may describe accessories or other vehicles.
 // Keep the exclusion tied to the listing's identity or explicit body/class.
 if(special.test(model+' '+trim+' '+body))return true;
 const policyOffer={...offer,market:'japan',bodyType:catalogBodyType(offer),
  ...(offer.operational?.sourceSpecifications&&!snapshot?{operational:{...offer.operational,sourceSpecifications:undefined}}:{})};
 if(motorcycleExcluded(policyOffer)||catalogHeavyVehicleExcluded(policyOffer))return true;
 return Number(catalogGrossVehicleWeightKg(policyOffer))>3500;
}

/** Safe source pruning over existing AJ identity columns, shared by lists and
 * aggregates. Keep a compact ASCII subset inside the supplier GET budget;
 * the full Unicode/class/mass guard remains mandatory after normalization and
 * enrichment. Source COUNT is therefore only an upper bound on admitted rows.
 * Truck families retain their existing predicate.
 * COACH in a grade can name a passenger-car edition, so it is model/body only.
 */
export function japanVehicleSqlExclusion():string {
 const sourcePattern=token('BUS|MINIBUS|MICROBUS|DUMP(ER)?|CRANE|FORKLIFT|TRACTOR|AMBULANCE|TANKER');
 return `(concat_ws(' ',model_name,grade) not regexp '${sourcePattern}' and model_name not regexp '${coachPattern}')`;
}
