import assert from 'node:assert/strict';
const freeze=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;};
/** Only a successful final local verification + fresh remote HEAD fence can
 * promote private preliminary rows. A failed/repeated finalization is terminal. */
export function createPriceLifecycle(){
 let state='running',active=0;const rows=[];
 const running=()=>assert.equal(state,'running','price_snapshot_not_running');
 return Object.freeze({state:()=>state,assertRunning:running,
  beginProbe(){running();active++;let ended=false;return {complete(row){try{running();assert.ok(!ended,'price_probe_already_ended');const value=freeze({...structuredClone(row),fullPriceAccepted:false});rows.push(value);return value;}finally{if(!ended){ended=true;active--;}}},fail(){if(!ended){ended=true;active--;}state='failed';}};},
  beginFinalize(){if(state!=='running'||active!==0){state='failed';throw Error('price_snapshot_finalization_state');}state='finalizing';},
  finishFinalize(){assert.equal(state,'finalizing','price_snapshot_finalization_state');state='finalized';},
  fail(){state='failed';},
  acceptedResults(){assert.equal(state,'finalized','price_snapshot_not_finalized');return freeze(rows.map(row=>({...structuredClone(row),fullPriceAccepted:row.fixture!==true&&row.priceChecksPassed===true})));}
 });
}
