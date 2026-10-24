/** Confirmed medium/heavy truck and large bus families, not guessed listing mass.
 * Hino: https://www.hino-global.com/corp/about_us/milestones.html
 * Hino Selega: Securities_Report_for_the_Fiscal_Year_Ended_March_31_2009.pdf
 * Isuzu: https://www.isuzu.co.jp/world/company/history.html and report_2010.pdf
 * SEREGA is the supplier's spelling of SELEGA, observed in the owner's lot.
 * Owner update 19.10.2026 excludes light trucks too (Elf, Canter, Dutro); never blanket makes.
 */
const fusoModels=['CANTER','FIGHTER','SUPER GREAT','SUPERGREAT','AERO QUEEN','AERO ACE','ROSA'] as const;
// Fuso: mitsubishi-fuso.com/en/product/fighter/ and fuso.com.au/range/bus/standard/25-seat/
// UD: udtrucks.com/china/about-us/innovation/product-history/1975
export const heavyVehicleFamilies = [
  // Toyota official Coaster bus/Big Van specification: GVW exceeds 3500 kg.
  // https://toyota.jp/pages/contents/coaster/004_b_022/pdf/spec/coaster_bigvan_spec_201608.pdf
  {make:'TOYOTA',models:['COASTER','DYNA','TOYOACE']},
  {make:'HINO',models:['DUTRO','RANGER','PROFIA','SELEGA','SEREGA']},
  {make:'ISUZU',models:['ELF','FORWARD','GIGA','GALA','ERGA']},
  {make:'MITSUBISHI',models:fusoModels},
  {make:'MITSUBISHI FUSO',models:fusoModels},
  {make:'FUSO',models:fusoModels},
  {make:'UD',models:['CONDOR','QUON']},
  {make:'UD TRUCKS',models:['CONDOR','QUON']},
  {make:'NISSAN DIESEL',models:['CONDOR','QUON']},
] as const;
export function knownHeavyVehicleFamily(make:unknown,model:unknown){
 const brand=String(make||'').normalize('NFKC').trim().toUpperCase();
 const name=String(model||'').normalize('NFKC').trim().toUpperCase();
 return heavyVehicleFamilies.some(group=>group.make===brand&&group.models.some(family=>
  name===family||[' ','-','/'].some(separator=>name.startsWith(family+separator))));
}
/** Fixed identifiers only; same family boundary as the local guard. */
export function heavyVehicleSqlExclusion(legacyCache=false,beforeLightTrucks=false){
 const light=new Set<string>(beforeLightTrucks?['ELF','CANTER','DUTRO']:[]);
 return heavyVehicleFamilies.filter(group=>!legacyCache||group.make!=='TOYOTA').map(group=>`not (marka_name='${group.make}' and (${group.models.filter(model=>!light.has(model)).flatMap(model=>[
  `model_name='${model}'`,...[' ','-','/'].map(separator=>`model_name like '${model}${separator}%'`),
 ]).join(' or ')}))`).join(' and ');
}
