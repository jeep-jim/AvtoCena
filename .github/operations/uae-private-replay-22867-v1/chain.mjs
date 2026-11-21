import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectPage,ROOT,SEAL_KEY,SOURCE_SEAL,START,OBSERVED} from './accepted-collector.mjs';
export const FRESH=Object.freeze({
 seal:'7b9a244bc6492fb962c7b4401d5ec3993dfc26c28568fc8e6cdcdc3a03a4edc8',
 chain:'46d1a5955f2ae2a9b7d809ab65f2bdea395d014169f7f2c53882053bb59b95d7',
 authorization:'879bc66e4feb1663e0a18899bee6024945c62cac37c4ed0084057e0ebaa5d684',
 run:44861891514, job:136717032543, cursor:327359, pages:120,
 observations:'2026-11-21T03:45:04.942Z',
 events:2370, kinds:{added:1037,changed:672,removed:661}, needs:{added:0,changed:5}
});
const ZERO={added:0,changed:0,removed:0}, Z={added:0,changed:0};
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const hash=v=>sha(Buffer.from(JSON.stringify(v)));
const req=(x,c)=>assert.ok(x,c), body=async(read,key,cap)=>{
 const b=await read(key,cap);req(Buffer.isBuffer(b)&&b.length>0&&b.length<=cap,'uae_replay_read_bound');return b;
};
const add=(a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+b[k]]));
const knownAck=(expected,x)=>x.initialCursor===START&&x.workingCursor===expected.cursor&&x.observedThrough===expected.observations&&x.paidAttempts===expected.pages
 &&x.events===expected.events&&hash(x.eventKinds)===hash(expected.kinds)&&hash(x.sourcePayloadNeedsQualification)===hash(expected.needs)
 &&x.chainSha256===expected.chain&&x.authority===expected.authorization;
export function verifyChainRows(pages,expected){
 let cursor=START,previous=null,heldOwner=null,count=0,kinds=ZERO,needs=Z,obs=OBSERVED, terminal=false;
 let result=[];
 for(const saved of pages){
  req(previous!==expected.chain&&!terminal&&saved?.version===1,'uae_replay_page_after_terminal');
  const at=saved.attempt;
  req(at?.version===1&&at.market==='uae'&&at.seal===SOURCE_SEAL&&at.permit===expected.authorization
    &&at.cursor===cursor&&at.previous===previous&&/^[0-9a-f]{64}$/.test(at.owner)
    &&(!heldOwner||at.owner===heldOwner)&&Date.parse(at.observedAt)>=Date.parse(obs)
    &&Date.parse(saved.observedAt)>=Date.parse(at.observedAt)&&Date.parse(saved.observedAt)<=Date.parse(expected.observations),'uae_replay_page_owner_or_chain');
  heldOwner=at.owner;
  const checked=inspectPage(saved.body,cursor,saved.observedAt);
  req(hash(checked)===hash(saved.check),'uae_replay_page_disposition');
  previous=hash(saved);obs=saved.observedAt;
  count+=checked.events;kinds=add(kinds,checked.types);needs=add(needs,checked.unqualified);
  result.push(...saved.body.result);
  if(checked.next===null) terminal=true;else cursor=checked.next;
 }
 req(terminal&&pages.length===expected.pages&&knownAck(expected,{initialCursor:START,workingCursor:cursor,
  observedThrough:obs,paidAttempts:pages.length,events:count,eventKinds:kinds,sourcePayloadNeedsQualification:needs,chainSha256:previous,
  authority:expected.authorization}),'uae_replay_terminal_drift');
 return result;
}
export async function readVerifiedDelta(read,expected=FRESH,{baseSeal=SOURCE_SEAL}={}){
 const baseWire=await body(read,SEAL_KEY,1024*1024),endWire=await body(read,ROOT+'sealed-delta.json',1024*1024);
 req(sha(baseWire)===baseSeal&&sha(endWire)===expected.seal,'uae_replay_source_seal');
 const base=JSON.parse(baseWire.toString()), end=JSON.parse(endWire.toString());
 req(base.market==='uae'&&base.kind==='private-uae-source-stage-v1'&&base.scope==='paid_dubicars_only'&&base.sourceRows===27581
   &&base.cursorObserved===START&&base.sourceObservedThrough===OBSERVED&&base.servable===false&&base.publicationAllowed===false,
  'uae_replay_source_baseline');
 req(end.version===1&&end.market==='uae'&&end.provider==='auto_api_dubicars'&&end.scope==='uae_private_dubicars_v2_delta'
   &&end.state==='source_terminal'&&end.priorSeal===SOURCE_SEAL&&end.detailRequests===0&&end.publicPointerWrites===0
   &&end.cursorAdvanced===false&&end.published===false&&end.prepared===false&&knownAck(expected,end),'uae_replay_delta_seal');
 const pages=[]; let cursor=START;
 for(let i=0;i<expected.pages;i++){
   req(Number.isSafeInteger(cursor)&&cursor>=START&&cursor<=expected.cursor,'uae_replay_read_cursor_bound');
   const saved=JSON.parse((await body(read,ROOT+'page-'+cursor+'.json',4*1024*1024)).toString());
   const next=inspectPage(saved?.body,cursor,saved?.observedAt).next;
   req(i===expected.pages-1 ? next===null : Number.isSafeInteger(next),'uae_replay_page_terminal_wrong');
   pages.push(saved);cursor=next;
 }
 req(sha(await body(read,ROOT+'sealed-delta.json',1024*1024))===expected.seal,'uae_replay_delta_changed');
 return {base,end,events:verifyChainRows(pages,expected)};
}
