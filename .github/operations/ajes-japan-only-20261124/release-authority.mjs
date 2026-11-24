import {PROFILE,need,sha256} from './release-contract.mjs';
import {CONTROLS_KEY,JAPAN_ACCESS_KEY} from './retire-controls.mjs';

const LEASE='catalog/import-lock.json',MANIFEST='catalog/manifest.json';
const TTL=100*60_000;
const headSame=(a,b)=>a?.found===b?.found&&(!a.found||a.etag===b.etag);
const condition=meta=>{need(!meta.found||typeof meta.etag==='string'&&meta.etag.length>0,'lease_etag');return meta.found?{ifMatch:meta.etag}:{ifNoneMatch:'*'};};

/** Only this operation's conditional publication lease may be written. Catalog,
 * pricing, supplier configuration and encyclopedia records are read-only. */
export async function acquireAuthority({storage,nonce,readLiveIdentity,now=Date.now,heartbeat=true}){
  need(storage.driver==='object'&&/^[a-f0-9]{32}$/.test(nonce),'authority_context');
  const operationId='aj-system-japan-only-'+nonce;
  const initial=await storage.readJsonWithMeta(LEASE,{lockedUntil:''});
  need(!initial.value?.lockedUntil||Number.isFinite(Date.parse(initial.value.lockedUntil))
    &&Date.parse(initial.value.lockedUntil)<=now(),'publisher_busy');
  const lease={operationId,operationType:'aj_system_japan_only_release',startedAt:new Date(now()).toISOString(),lockedUntil:new Date(now()+TTL).toISOString()};
  try{await storage.writeJson(LEASE,lease,condition(initial));}catch{throw Error('aj_release_lease_conflict');}
  let closed=false,timer,failure,pending=Promise.resolve(),expected='retained',controls;
  const owned=meta=>need(meta.found&&meta.value?.operationId===operationId&&Date.parse(meta.value.lockedUntil)>now(),'lease_lost');
  async function release(){
    if(closed)return;closed=true;clearInterval(timer);await pending.catch(()=>{});
    const current=await storage.readJsonWithMeta(LEASE,null);need(current.value?.operationId===operationId,'foreign_lease_release');
    await storage.writeJson(LEASE,{...current.value,lockedUntil:'',finishedAt:new Date(now()).toISOString()},condition(current));
    const after=await storage.readJsonWithMeta(LEASE,null);need(after.value?.operationId===operationId&&after.value.lockedUntil==='','lease_release_readback');
  }
  let manifest,protectedHeads;
  try{
    owned(await storage.readJsonWithMeta(LEASE,null));
    manifest=await storage.readJsonWithMeta(MANIFEST,null);
    need(manifest.found&&manifest.etag&&manifest.value?.version===2&&/^gen_\d+_[a-z0-9]+$/.test(manifest.value.generationId||''),'manifest');
    protectedHeads=new Map(await Promise.all([JAPAN_ACCESS_KEY,'markets/markets.json','fees/exchange-rates.json']
      .map(async key=>[key,await storage.readObjectMetadata(key)])));
    for(const value of protectedHeads.values())need(typeof value.found==='boolean'&&(!value.found||value.etag),'protected_head');
    const live=await readLiveIdentity();need(live.release===PROFILE.retainedSource&&live.calculationVersion===PROFILE.servingCalculationVersion,'retained_runtime');
  }catch(error){await release().catch(()=>{});throw error;}
  const generationId=manifest.value.generationId,fingerprint=sha256(JSON.stringify({calculationVersion:PROFILE.servingCalculationVersion,
    privateIndexDigest:PROFILE.privateIndexDigest,manifest:manifest.value}));
  async function guard(){
    need(!closed&&!failure,'authority_closed');
    const [current,observed,live]=await Promise.all([storage.readJsonWithMeta(LEASE,null),storage.readJsonWithMeta(MANIFEST,null),readLiveIdentity()]);
    owned(current);need(observed.found&&observed.etag===manifest.etag&&JSON.stringify(observed.value)===JSON.stringify(manifest.value),'manifest_changed');
    need(live.release===(expected==='candidate'?PROFILE.source:PROFILE.retainedSource)&&live.calculationVersion===PROFILE.servingCalculationVersion,'runtime_changed');
    for(const [key,value]of protectedHeads)need(headSame(value,await storage.readObjectMetadata(key)),'protected_object_changed');
    if(controls)need(headSame(controls,await storage.readObjectMetadata(CONTROLS_KEY)),'controls_changed');
    return {operationId,generationId,acceptedReadModelFingerprint:fingerprint,lockedUntil:current.value.lockedUntil};
  }
  async function renew(){
    const current=await storage.readJsonWithMeta(LEASE,null);owned(current);
    await storage.writeJson(LEASE,{...current.value,lockedUntil:new Date(now()+TTL).toISOString(),heartbeatAt:new Date(now()).toISOString()},condition(current));
    owned(await storage.readJsonWithMeta(LEASE,null));
  }
  if(heartbeat){timer=setInterval(()=>{pending=pending.then(renew).catch(error=>{failure=error;});},5*60_000);timer.unref?.();}
  return {generationId,acceptedReadModelFingerprint:fingerprint,guard,release,
    async retainControls(){controls=await storage.readObjectMetadata(CONTROLS_KEY);need(controls.found&&controls.etag,'controls_head');await guard();},
    setIngress(value){need(['retained','candidate'].includes(value),'ingress_phase');expected=value;},
    async stopHeartbeat(){clearInterval(timer);await pending.catch(()=>{});}};
}
