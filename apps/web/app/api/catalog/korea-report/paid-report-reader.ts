import {createHash} from 'node:crypto';
import {catalogOfferFreshness} from '../../../../lib/catalog/refresh-policy';
import type {VehicleOffer} from '../../../../lib/catalog/types';
import {normalizePaidKoreaReport} from '../../../../components/catalog/paid-korea-report-contract';

type Kind = 'history' | 'inspection';
type Input = {offerId:string;lot:string;kind:Kind};
type ObjectValue = Record<string,unknown>;
type Descriptor = {count:number;sha256:string};
type Complete = {version:1;provider:'auto_api_encar';observedAt:string;observedAtMs:number;
  sourceRunId:string;sourceRunAttempt:string;bucketPrefixLength:2|3;rowCount:number;
  history:Record<string,Descriptor>;inspection:Record<string,Descriptor>};
type Dependencies = {
  readJson:(key:string,fallback:null)=>Promise<unknown>;
  readOffer:(id:string)=>Promise<unknown>;
  readGeneration:()=>Promise<string>;
  readControls:()=>Promise<unknown>;
};
export class PaidKoreaReportUnavailable extends Error {
  constructor(public reason:'input'|'not_found'|'disabled'|'snapshot_missing'|'snapshot_invalid'|'changed') {
    super(`paid_korea_report_${reason}`);
  }
}
const fail=(reason:PaidKoreaReportUnavailable['reason']):never=>{throw new PaidKoreaReportUnavailable(reason);};
const object=(value:unknown):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const positiveText=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d*$/.test(value);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const recordId=(lot:string)=>digest(`encar_direct:${lot}`).slice(0,24);
const MAX_BUCKET_BYTES=4*1024*1024;

function enabled(controls:unknown) {
  if(!object(controls)||!object(controls.markets)||!object(controls.sources))return false;
  const market=controls.markets.korea,source=controls.sources.encar_feed;
  return object(market)&&market.enabled===true&&object(source)&&source.enabled===true;
}
function generation(manifest:unknown) {
  if(!object(manifest)||typeof manifest.generationId!=='string'||!manifest.generationId
    ||!object(manifest.markets)||!object(manifest.markets.korea))return fail('changed');
  const korea=manifest.markets.korea;
  if(korea.provider!=='auto_api_encar'||!integer(korea.count)||korea.count<1)return fail('changed');
  return manifest.generationId;
}
function complete(value:unknown,observedAt:string,observedAtMs:number):Complete {
  if(!object(value)||value.version!==1||value.provider!=='auto_api_encar'
    ||value.observedAt!==observedAt||value.observedAtMs!==observedAtMs
    ||!positiveText(value.sourceRunId)||!positiveText(value.sourceRunAttempt)
    ||![2,3].includes(Number(value.bucketPrefixLength))||typeof value.bucketPrefixLength!=='number'
    ||!integer(value.rowCount)||value.rowCount<1)return fail('snapshot_invalid');
  const depth=value.bucketPrefixLength as 2|3;
  for(const kind of ['history','inspection'] as const){
    const descriptors=value[kind];
    if(!object(descriptors)||Object.keys(descriptors).length>16**depth)return fail('snapshot_invalid');
    let count=0;
    for(const [prefix,descriptor] of Object.entries(descriptors)){
      if(!new RegExp(`^[a-f0-9]{${depth}}$`).test(prefix)||!object(descriptor)
        ||!integer(descriptor.count)||descriptor.count<1||descriptor.count>2048
        ||typeof descriptor.sha256!=='string'||!/^[a-f0-9]{64}$/.test(descriptor.sha256))return fail('snapshot_invalid');
      count+=descriptor.count;
    }
    if(count!==value.rowCount)return fail('snapshot_invalid');
  }
  return value as Complete;
}

/** Read only immutable saved reports for the exact observation of a current paid card. */
export function createPaidKoreaReportReader(deps:Dependencies) {
  return async (input:Input)=>{
    if(!/^[a-f0-9]{24}$/.test(input.offerId)||!/^\d{6,10}$/.test(input.lot)
      ||!['history','inspection'].includes(input.kind))return fail('input');
    if(!enabled(await deps.readControls()))return fail('disabled');
    const [published,cachedGeneration]=await Promise.all([
      deps.readJson('catalog/manifest.json',null),deps.readGeneration(),
    ]);
    const currentGeneration=generation(published);
    // The existing offer reader may briefly retain the previous generation.
    // Do not combine that card with a new publication's report identity.
    if(cachedGeneration!==currentGeneration)return fail('changed');
    const stored=await deps.readOffer(input.offerId);
    if(!stored)return fail('not_found');
    if(!object(stored)||stored.id!==input.offerId||stored.market!=='korea'
      ||stored.sourceId!=='encar_direct'||!object(stored.operational)
      ||stored.operational.provider!=='auto_api_encar'||stored.sourceOfferId!==input.lot
      ||recordId(input.lot)!==input.offerId)return fail('not_found');
    const observedAtMs=catalogOfferFreshness(stored as Partial<VehicleOffer>);
    if(!Number.isSafeInteger(observedAtMs)||observedAtMs<=0)return fail('snapshot_missing');
    const observedAt=new Date(observedAtMs).toISOString();
    const root=`catalog/paid-encar-reports/v1/${observedAtMs}`;
    const manifest=await deps.readJson(`${root}/complete.json`,null);
    if(manifest===null)return fail('snapshot_missing');
    const ready=complete(manifest,observedAt,observedAtMs);
    const explicit=stored.operational.paidEncarReportSnapshot;
    if(explicit!==undefined&&(!object(explicit)||explicit.run!==ready.sourceRunId
      ||explicit.attempt!==ready.sourceRunAttempt||typeof explicit.observedAt!=='string'
      ||Date.parse(explicit.observedAt)!==observedAtMs))return fail('snapshot_invalid');
    const prefix=input.offerId.slice(0,ready.bucketPrefixLength),descriptor=ready[input.kind][prefix];
    if(!descriptor)return fail('snapshot_missing');
    const bucket=await deps.readJson(`${root}/${input.kind}/${prefix}.json`,null);
    if(!object(bucket)||bucket.version!==1||bucket.provider!=='auto_api_encar'
      ||bucket.observedAt!==observedAt||bucket.observedAtMs!==observedAtMs
      ||bucket.kind!==input.kind||bucket.prefix!==prefix||!Array.isArray(bucket.rows)
      ||bucket.rows.length!==descriptor.count||Buffer.byteLength(JSON.stringify(bucket),'utf8')>MAX_BUCKET_BYTES
      ||digest(JSON.stringify(bucket.rows))!==descriptor.sha256)return fail('snapshot_invalid');
    let previous='';let row:ObjectValue|undefined;
    for(const item of bucket.rows){
      if(!object(item)||typeof item.offerId!=='string'||!/^[a-f0-9]{24}$/.test(item.offerId)
        ||!item.offerId.startsWith(prefix)||item.offerId<=previous||typeof item.sourceOfferId!=='string'
        ||!/^\d{6,10}$/.test(item.sourceOfferId)||recordId(item.sourceOfferId)!==item.offerId)return fail('snapshot_invalid');
      if(!Object.hasOwn(item,input.kind)||item[input.kind]!==null&&!object(item[input.kind]))return fail('snapshot_invalid');
      if(input.kind==='inspection'&&(!Object.hasOwn(item,'diagnosis')||item.diagnosis!==null&&!object(item.diagnosis)))return fail('snapshot_invalid');
      previous=item.offerId;
      if(item.offerId===input.offerId)row=item;
    }
    if(!row||row.sourceOfferId!==input.lot)return fail('snapshot_missing');
    const report=normalizePaidKoreaReport(row,{...input,observedAt});
    if(!enabled(await deps.readControls()))return fail('disabled');
    const [after,afterCached]=await Promise.all([
      deps.readJson('catalog/manifest.json',null),deps.readGeneration(),
    ]);
    if(generation(after)!==currentGeneration||afterCached!==currentGeneration)return fail('changed');
    return report;
  };
}
