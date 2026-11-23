import assert from 'node:assert/strict';
import {rawDigest} from './catalog-raw-provenance.mjs';

const exact=(a,b)=>rawDigest(a)===rawDigest(b);

// A timed-out conditional PUT can have committed. Read back before deciding
// whether it succeeded; never retry a write using a fresh, unrelated ETag.
async function writeOnce(store,previous,next,deadline){
  let failure;
  try {await store.cas(previous.etag,next,deadline);} catch(error){failure=error;}
  const actual=await store.read();
  if(exact(actual.state,next) && actual.etag && actual.etag!==previous.etag)return actual;
  if(failure && actual.etag===previous.etag && exact(actual.state,previous.state))throw failure;
  throw Error('China control changed during the conditional write; reconcile from storage');
}

export async function cutOwnedChina({receipt,store,preview,sourceCurrent,rollbackCurrent,accept,lease,now=Date.now}){
  const base=receipt.evidence.control;
  const fresh=()=>assert(Number.isSafeInteger(receipt.validUntil) && now()+30000<receipt.validUntil,'private generation expired');
  assert(base.state.version===1 && base.state.market==='china' && Number.isSafeInteger(base.state.revision) &&
    base.state.revision>0 && typeof base.etag==='string' && base.etag && base.activeSha256===rawDigest(base.state.active) &&
    receipt.target.generationId!==base.state.active.generationId,'China control identity');
  const next={version:1,market:'china',revision:base.state.revision+1,active:receipt.target,previous:base.state.active};
  async function sameBase(){
    const current=await store.read();
    assert(current.etag===base.etag && exact(current.state,base.state),'China control changed before activation');
    return current;
  }
  const entered=await store.read();
  if(exact(entered.state,next)){
    await sourceCurrent();const proof=await preview({alreadyActive:true});await accept(proof);
    const after=await store.read();assert(after.etag===entered.etag && exact(after.state,next),'generation changed during repeated readback');
    return {published:false,alreadyActive:true,generationId:next.active.generationId,revision:next.revision,proof};
  }
  fresh();await sameBase();await sourceCurrent();
  const proof=await preview();
  return lease(async guard=>{
    fresh();await guard();await sourceCurrent();await rollbackCurrent('before');const before=await sameBase();await guard();fresh();
    const written=await writeOnce(store,before,next,Math.min(receipt.validUntil,now()+25000));
    const owned=async()=>{
      const current=await store.read();await guard();
      assert(current.etag===written.etag&&exact(current.state,next),'China control no longer owned');
      return current;
    };
    try{
      await owned();await accept(proof);await owned();
      return {published:true,generationId:next.active.generationId,revision:next.revision,proof};
    }catch(error){
      // Only the previously accepted generation, while it is still legal. A
      // newer publisher or changed ETag always keeps its own control.
      await rollbackCurrent('after');const current=await owned();
      const restored={version:1,market:'china',revision:next.revision+1,active:base.state.active,previous:next.active};
      await writeOnce(store,current,restored,now()+25000);
      throw Error('China public verification failed; restored the previous generation',{cause:error});
    }
  });
}
