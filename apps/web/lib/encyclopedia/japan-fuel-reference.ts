import {namedElectrifiedPowertrainKind} from '../catalog/powertrain-safety';
// Reviewed fuel-only factory identities. They do not assert model years, trim,
// horsepower, displacement or certified power; all original fields are retained.
const references=[
 {make:'RENAULT',models:['TWINGO'],codes:['AHH4B'],cc:[890,900],fuel:'petrol',url:'https://dcms.renault.jp/car_lineup/twingo/gps_pdf/TWINGO_webspec.pdf'},
 {make:'RENAULT',models:['MEGANE'],codes:['BBH5H','KBH5H'],cc:[1300,1400],fuel:'petrol',url:'https://dcms.renault.jp/car_lineup/megane/gps_pdf/MEGANE_webspec.pdf'},
 {make:'HONDA',models:['NBOX','NBOXCUSTOM'],codes:['JF3','JF4'],cc:[650,660],fuel:'petrol',url:'https://www.honda.co.jp/factbook/auto/nbox/201708/P26.pdf'},
 {make:'NISSAN',models:['CLIPPERVAN','NV100CLIPPER'],codes:['DR17V'],cc:[650,660],fuel:'petrol',url:'https://history.nissan.co.jp/ARCHIVES/PDF/NV100CLIPPER/VZA1/20201201/nv100clipper_specsheet.pdf'},
 {make:'CITROEN',models:['BERLINGO'],codes:['K9CYH01','K9CYH01L'],cc:[1490,1500],fuel:'diesel',url:'https://web.citroen.jp/brochure/webcatalog/pdf/berlingo_spec_230403.pdf'},
];
const token=(s:unknown)=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function applyJapanFactoryFuel<T extends Record<string,any>>(offer:T):T{
 if(offer.market!=='japan'||offer.sourceId!=='ajes_japan_feed'||offer.fuel&&offer.fuel!=='unknown'||offer.powertrainKind&&offer.powertrainKind!=='unknown'&&offer.powertrainKind!=='combustion'||namedElectrifiedPowertrainKind(offer))return offer;
 const evidence=offer.operational?.semanticEvidence||{};
 if(['fuel','powertrainKind'].some(f=>['conflict','ambiguous'].includes(evidence[f]?.status)))return offer;
 // A nonempty unknown supplier fuel code is not permission to override it.
 if(String(offer.operational?.raw?.sourceFuel||'').trim())return offer;
 const chassis=String(offer.operational?.chassisCode||offer.chassisCode||'').toUpperCase().replace(/^(?:DBA|ABA|HBD|EBD|[357]BA|[35]BD|3DA)-/,'');
 const ref=references.find(r=>token(offer.make)===r.make&&r.models.includes(token(offer.model))&&r.codes.includes(chassis)&&Number(offer.engineCc)>=r.cc[0]&&Number(offer.engineCc)<=r.cc[1]);
 if(!ref)return offer;
 const source=`manufacturer_chassis_fuel:${ref.url}`;
 return {...offer,fuel:ref.fuel,powertrainKind:'combustion',operational:{...offer.operational,semanticEvidence:{...evidence,fuel:{status:'exact',value:ref.fuel,source},powertrainKind:{status:'exact',value:'combustion',source}},factoryFuelReference:{chassisCode:chassis,url:ref.url,checkedAt:'2026-10-24',fields:['fuel','powertrainKind']}}};
}
