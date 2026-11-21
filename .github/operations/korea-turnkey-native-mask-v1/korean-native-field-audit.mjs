// Pure count-only evaluator; never publishes, guesses omitted status/units or exports raw fields.
const bump=(o,k)=>o[k]=(o[k]??0)+1;
const id=x=>typeof x==='string'&&/^[1-9][0-9]{1,17}$/.test(x);
const field=(v,opts)=>v===null?'null':v===undefined?'missing':opts.has(v)?opts.get(v):'other';
const enums={
 advertisement_type:new Map([['Sale','sale_en'],['Продажа','sale_ru'],['Rent','rent_en'],['Lease','lease_en']]),
 sales_status:new Map([['Available','available_en'],['Доступно','available_ru'],['Sold','sold_en'],['Продано','sold_ru'],['Contract','contract_en']]),
 is_duplicate:new Map([[true,'true'],[false,'false']])
};
const number=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const year=n=>Number.isInteger(n)&&n>=1900&&n<=2100;
const ym=s=>typeof s==='string'&&/^(?:19|20)\d{2}-(0[1-9]|1[0-2])$/.test(s);
const dmy=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))
 &&new Date(Date.parse(s)).toISOString().slice(0,10)===s;
const combustion=new Set(['Gasoline','Diesel','LPG','CNG','Бензин','Дизель','Пропан','Газ','Бензин / Газ']);
const electric=new Set(['Electric','Electricity','Электро','Электричество']);
const hybrid=new Set(['Hybrid','Гибрид','Gasoline + Electric','Бензин + Электричество']);
const noncash=re=>/(?:^|_)(?:RENT|LEASE)(?:_|$)|SUCCESSION/i.test(String(re??''));
function positiveCommercialMarker(v){
 if(!v||typeof v!=='object')return false;
 return v.lease!=null&&v.lease!==false||noncash(v.advertisement_type)||noncash(v.advertisementType)
   ||noncash(v.contractType)||noncash(v.leaseRentType);
}
export function inspectKoreaNative(rows,counts={},observedAt){
 const observed=typeof observedAt==='string'?Date.parse(observedAt):NaN;
 for(const r of rows){
  bump(counts,'rows');
  if(!id(r?.inner_id)||!r.data||typeof r.data!=='object'||Array.isArray(r.data)){bump(counts,'envelope_missing');continue;}
  const d=r.data;
  if(!id(d.inner_id)||d.inner_id!==r.inner_id){bump(counts,'inner_identity_unverified');continue;}
  bump(counts,'identity_ok');
  const state=Object.fromEntries(Object.entries(enums).map(([k,v])=>[k,field(d[k],v)]));
  for(const [k,v] of Object.entries(state))bump(counts,k+'_'+v);
  const outerConflict=[...Object.keys(enums),'year','model_year'].some(k=>Object.hasOwn(r,k)&&Object.hasOwn(d,k)&&r[k]!==d[k]);
  if(outerConflict)bump(counts,'outer_nested_contract_conflict');
  const y0=d.year,y1=d.model_year;
  const yearState=y0==null&&y1==null?'missing'
    :y0!=null&&!year(y0)||y1!=null&&!year(y1)?'malformed'
    :y0!=null&&y1!=null&&y0!==y1?'conflict'
    :(y1??y0)<2022?'pre_2022':'2022_plus';
  bump(counts,'model_year_'+yearState);
  if(y0==null&&y1!=null)bump(counts,'model_year_only_needs_normalizer_field_mapping');
  if(ym(d.year_month)){bump(counts,'manufacture_month');
   if(year(y1??y0)&&Number(d.year_month.slice(0,4))!==(y1??y0))bump(counts,'manufacture_year_differs_from_model_year');
   if(Number.isFinite(observed)){
    const safe=Date.parse(d.year_month+'-01T00:00:00Z')<=observed;
    bump(counts,safe?'native_manufacture_month_not_after_archive_observation':'native_manufacture_month_future_at_archive_observation');
    if(safe&&yearState==='2022_plus'&&Number(d.year_month.slice(0,4))<2022)bump(counts,'production_pre_2022_but_model_2022_plus');
   }
  }else bump(counts,'manufacture_month_unverified');
  if(dmy(d.first_registration_date))bump(counts,'registration_date_distinct');
  if(positiveCommercialMarker(d))bump(counts,'observed_non_cash_or_lease_marker');
  const cashEn=state.advertisement_type==='sale_en'&&state.sales_status==='available_en';
  const cashRu=state.advertisement_type==='sale_ru'&&state.sales_status==='available_ru';
  const safeCommon=!outerConflict&&yearState==='2022_plus'&&!positiveCommercialMarker(d)&&d.is_duplicate===false;
  if(safeCommon&&cashEn)bump(counts,'english_predicate_pass');
  if(safeCommon&&cashRu)bump(counts,'russian_exact_predicate_pass');
  // Compare with the historical flag check, without assuming unknown duplicate is safe to serve.
  if(!outerConflict&&cashRu&&d.is_duplicate!==true&&!positiveCommercialMarker(d))
   bump(counts,'legacy_russian_flags_before_year_gate');
  if(safeCommon&&(cashEn||cashRu)&&number(d.price)&&d.currency==='KRW')bump(counts,'sample_native_cash_price_fields_present');
  if(!number(d.price)||d.currency!=='KRW')bump(counts,'price_or_currency_unverified');
  const kind=combustion.has(d.engine_type)?'combustion':electric.has(d.engine_type)?'electric':hybrid.has(d.engine_type)?'hybrid':'unknown';
  bump(counts,'native_engine_label_'+kind);
  if(Number.isSafeInteger(d.displacement_cc)&&d.displacement_cc>0)bump(counts,'native_cc');else if(number(d.displacement))bump(counts,'litres_not_exact_cc');
  if(Number.isSafeInteger(d.displacement_cc)&&d.displacement_cc>=300&&d.displacement_cc<=10000)bump(counts,'mapper_exact_cc_bounds');
  if(number(d.power)&&d.power>=20&&d.power<=2500)bump(counts,'mapper_total_hp_bounds');
  if(number(d.power))bump(counts,'native_total_hp');
  if(number(d.power_ice_hp))bump(counts,'native_ice_hp');
  if(number(d.power_electro_kw))bump(counts,'native_electric_kw_not_certified30m');
  if((kind==='electric'||kind==='hybrid'))bump(counts,'electrified_no_v3_certified30m_authority');
  if(kind==='combustion'&&number(d.power)&&number(d.power_ice_hp)&&Math.abs(d.power-d.power_ice_hp)>1)bump(counts,'combustion_total_ice_conflict');
  bump(counts,'no_automatic_customs_category_weight_or_route_authority_from_v3');
 }
 return counts;
}
