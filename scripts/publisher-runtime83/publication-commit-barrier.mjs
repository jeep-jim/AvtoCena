import assert from 'node:assert/strict';
/** Readiness is a capability, not a caller's boolean. No deferred pointer can
 * be reached until the actual verifier succeeds; every write rechecks it. */
export function createPublicationCommitBarrier() {
 let state='preparing', verifier=null;const writes=[],names=new Set();
 const fail=error=>{state='failed';throw error;};
 const verify=async()=>{assert.ok(['ready','committing','committed'].includes(state),'publication_barrier_not_ready');try{await verifier();}catch(error){fail(error);}};
 return {
  defer(name,commit){assert.equal(state,'preparing','publication_barrier_closed');assert.ok(typeof commit==='function'&&!names.has(name),'publication_barrier_duplicate');names.add(name);writes.push({name,commit});},
  async ready(check){assert.equal(state,'preparing','publication_barrier_closed');assert.equal(typeof check,'function','publication_barrier_verifier_required');state='checking';try{await check();verifier=check;state='ready';}catch(error){fail(error);}},
  async commitDeferred(){assert.equal(state,'ready','publication_barrier_not_ready');state='committing';try{for(const {commit}of writes){await verify();await commit();}state='committed';}catch(error){fail(error);}},
  verify,
  state:()=>state,
 };
}
