import {createHash} from 'node:crypto';
export const keys=Object.freeze({rates:'fees/exchange-rates.json',commercial:'markets/markets.json',technical:'knowledge/encyclopedia/calculation-v1.json'});
const terms=['securityDepositRub','topAvtoCommissionRub','logisticsRub','brokerRub','svhRub','laboratoryRub','sbktsRub','eptsRub','rfDeliveryRub','otherFixedExpensesRub'];
const finite=x=>(typeof x==='number'||(typeof x==='string'&&x.trim()!==''))&&Number.isFinite(Number(x));
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString().slice(0,10)===v.slice(0,10)?v.slice(0,10):null;
const hash=raw=>createHash('sha256').update(JSON.stringify(raw)).digest('hex');

function rate(raw, currency, now) {
  const candidates=Array.isArray(raw?.rates)?raw.rates.filter(r=>r?.currency===currency):[raw?.[currency]].filter(Boolean);
  if(candidates.length!==1) return {status:candidates.length?'ambiguous':'missing'};
  const item=candidates[0];
  const d=iso(item.rateDate??item.date), source=item.rateSource;
  if(!['cbr','cbr_live'].includes(source)||!d||!finite(item.nominal)||Number(item.nominal)<=0||!finite(item.cbrRate??item.value)||Number(item.cbrRate??item.value)<=0)
    return {status:'unverified_explicit_provenance'};
  const age=Date.parse(now.toISOString().slice(0,10))-Date.parse(d);
  return {status:age<0?'future':age>4*86400000?'stale':'available_snapshot',rateDate:d,provenance:source};
}
function commercial(raw, now) {
  const markets=Array.isArray(raw)?raw.filter(x=>x?.id==='uae'):[];
  const versions=markets.length===1&&Array.isArray(markets[0].versions)?markets[0].versions:null;
  if(!versions) return {status:'missing_or_ambiguous',explicitTermCount:0};
  // Mirror the installed selector's effective ordering, including malformed dates
  // sorting as epoch; never accept that selected record as evidence.
  const start=v=>Date.parse(v?.effectiveFrom)||0;
  const current=versions.filter(v=>v&&v.active!==false&&!['draft','archived'].includes(v.status)&&start(v)<=+now)
    .sort((a,b)=>start(b)-start(a)||Number(b.version||0)-Number(a.version||0))[0];
  if(!current)return {status:'no_effective_version',explicitTermCount:0};
  const effectiveDate=iso(current.effectiveFrom);
  const explicitTermCount=terms.filter(k=>finite(current[k])&&Number(current[k])>=0).length;
  const complete=effectiveDate&&['active','scheduled'].includes(current.status)&&current.provisional!==true&&
      current.currency==='AED'&&typeof current.id==='string'&&current.id.length>0&&explicitTermCount===terms.length;
  return {status:complete?'explicit_nonprovisional_base_profile':'incomplete_or_provisional',effectiveDate,explicitTermCount,expectedTermCount:terms.length,
    routeApprovalVerified:false, runtimeUsdLogisticsRequired:true};
}
function technical(index) {
  const available=index?.version===1&&typeof index.models==='object'&&index.models!==null&&!Array.isArray(index.models)
    &&typeof index.digest==='string'&&index.digest===hash(index.models);
  return {status:available?'valid_object_mirror':'missing_or_invalid_object_mirror',modelGroupCount:available?Object.keys(index.models).length:0,
    createdDate:available?iso(index.createdAt):null,installedLocalIndexVerified:false,uaeListingMatchVerified:false};
}
export async function preflight({read,now=new Date()}) {
  const rates=await read(keys.rates);
  const profile=commercial(await read(keys.commercial),now);
  const spec=technical(await read(keys.technical));
  const fx={AED:rate(rates,'AED',now),EUR:rate(rates,'EUR',now)};
  // The pinned release uses USD logistics for UAE delivered-price runtime.
  // Only evaluate this additional currency for a selected explicit UAE profile.
  if(profile.status==='explicit_nonprovisional_base_profile') fx.USD=rate(rates,'USD',now);
  return {market:'uae',referenceRelease:'22867cbcfaee27b2e8917b6bf880e44827f67b60',utcDate:now.toISOString().slice(0,10),
    status:'approved_store_availability_only',fx,commercial:profile,technical:spec,
    sellerLocalFixtureInputAvailable:fx.AED.status==='available_snapshot',approvedRouteVerified:false,deliveredQuoteAuthorized:false,publicationAllowed:false,
    sourceRequests:0,storageWrites:0};
}
