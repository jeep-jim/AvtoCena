/** Minimal exact one-generation per-make sidecar contract, no IO or auth bypass.
 * Selectors/delivery/formatting remain installed native functions.
 * A production adapter must supply separately authorised immutable scope. */
import {createHash} from 'node:crypto';
const SHA=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{24}$/,GEN=/^gen_\d{13}_china[1-9][0-9]{0,19}$/;
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const need=(b,k)=>{if(!b)throw Error('china_make_index:'+k)};
const text=x=>typeof x==='string'&&x.length>0&&x.length<=80&&!/[,|\u0000-\u001f]/.test(x)&&x.trim()===x;
const queryKeys=new Set(['market','make','model','city','yearFrom','yearTo','sort','page','pageSize']);
const sealIds=()=>createHash('sha256').update('prepared-ordered-admitted-ids-v1\n');
const DEPTH=8192;
const policyDay=t=>new Date(t+7*3600000).toISOString().slice(0,10);
export function brandOnlyScope(query){
 if(query?.market!=='china'||!text(query.make)||!(query.city===undefined||query.city===''||text(query.city))||
    !(query.sort===undefined||query.sort===''||query.sort==='updatedAt'||query.sort==='totalRub'||query.sort==='totalRubDesc'||query.sort==='year'||query.sort==='yearAsc')||
    ![query.yearFrom,query.yearTo].every(y=>y===undefined||Number.isInteger(y)&&y>=1900&&y<=2100)||
    (query.yearFrom!==undefined&&query.yearTo!==undefined&&query.yearFrom>query.yearTo)||
    !(query.model===undefined||query.model===''||text(query.model))||
    Object.entries(query).some(([k,v])=>!queryKeys.has(k)&&v!==undefined&&v!==null&&v!==''))
  return null;
 const page=query.page??1,pageSize=query.pageSize??24;
 if(!Number.isSafeInteger(page)||page<1||pageSize!==24||page*24>DEPTH)return null;
 return Object.freeze({make:query.make,model:query.model||'',city:query.city||'',yearFrom:query.yearFrom??null,yearTo:query.yearTo??null,sort:query.sort||'updatedAt',page,pageSize});
}
function authority(x){
 const keys=['directorySha256','sameCutAdmittedOrderSha256','editorialSha256','runtimeSourceSha256','pricingReceiptSha256','tariffVersionSha256'];
 need(GEN.test(x?.generationId??'')&&keys.every(k=>SHA.test(x?.[k]??''))&&Number.isSafeInteger(x.admittedRows)&&
  x.admittedRows>=1&&x.admittedRows<=400000&&/^\d{4}-\d{2}-\d{2}$/.test(x.policyDay??'')&&
  Number.isSafeInteger(x.validUntil),'exact_current_material');
 return {generationId:x.generationId,admittedRows:x.admittedRows,policyDay:x.policyDay,validUntil:x.validUntil,...Object.fromEntries(keys.map(k=>[k,x[k]]))};
}
const scopeKey=(a,q)=>digest(['china-native-brand-default-v1',a,q.make,q.model,q.city,q.yearFrom,q.yearTo,q.sort]);
const pos=p=>p&&ID.test(p.id)&&Number.isSafeInteger(p.chunk)&&p.chunk>=0&&Number.isSafeInteger(p.part)&&p.part>=0&&
 Number.isSafeInteger(p.offset)&&p.offset>=0&&Number.isSafeInteger(p.baseRub)&&p.baseRub>0;
export async function buildMakeIndex({active,query,installedSelector,installedMembership,verifiedRows,assertCurrent,clock=Date.now}){
 return (await buildExactFilterBatch({active,queries:[query],installedSelector,installedMembership,verifiedRows,assertCurrent,clock}))[0];
}
export async function buildExactFilterBatch({active,queries,verifyFirstSix=false,installedSelector,installedMembership,verifiedRows,assertCurrent,clock=Date.now}){
 const a=authority(active);
 need(Array.isArray(queries)&&queries.length>=1&&queries.length<=8&&
  typeof assertCurrent==='function'&&typeof installedMembership==='function'&&typeof installedSelector==='function','supported_exact_query');
 requireFunction(verifiedRows);const fresh=()=>need(policyDay(clock())===a.policyDay&&clock()<a.validUntil,'native_admission_window');
 fresh();await assertCurrent();
 const slots=[];const keys=new Set();
 for(const query of queries){
  const q=brandOnlyScope(query);need(q,'supported_exact_query');
  const key=scopeKey(a,q);need(!keys.has(key),'duplicate_exact_query');keys.add(key);
  const native={market:'china',make:q.make,model:q.model||undefined,city:q.city||undefined,
   yearFrom:q.yearFrom??undefined,yearTo:q.yearTo??undefined,sort:q.sort};
  slots.push({key,predicate:await installedMembership(native),ranking:installedSelector(native,DEPTH),rail:verifyFirstSix?installedSelector(native,6):null,matched:0});
 }
 const h=sealIds(),positions=new Map();let scanned=0;
 for await(const rec of verifiedRows()){
  const {row,position}=rec??{};
  need(pos(position)&&row?.id===position.id&&row.market==='china'&&row.totalRub===position.baseRub&&
   !positions.has(row.id)&&++scanned<=a.admittedRows,'verified_ordered_projection');
  positions.set(row.id,position);h.update(JSON.stringify(row.id)+'\n');
  for(const slot of slots)if(slot.predicate(row)){slot.matched++;slot.ranking.add(row);slot.rail?.add(row);}
 }
 need(scanned===a.admittedRows&&h.digest('hex')===a.sameCutAdmittedOrderSha256,'full_ready_coverage');
 const out=slots.map(slot=>{
  const ranked=slot.ranking.finish().map(row=>positions.get(row.id));
  need(ranked.length===Math.min(slot.matched,DEPTH)&&ranked.every(pos)&&new Set(ranked.map(x=>x.id)).size===ranked.length,'native_rank_prefix');
  if(slot.rail){const rail=slot.rail.finish().map(row=>row.id);need(
   JSON.stringify(rail)===JSON.stringify(ranked.slice(0,6).map(p=>p.id)),'first_six_native_parity');}
  return Object.freeze({version:1,kind:'china-native-exact-filter-index',authority:a,key:slot.key,
   total:slot.matched,ranked,rankedSha256:digest(ranked)});
 });
 await assertCurrent();fresh();return Object.freeze(out);
}
function requireFunction(fn){need(typeof fn==='function','verified_native_row_reader');}
export async function takeExactMakeIndex({active,query,index,expectedObjectSha256,readPosition,applyNativeCityAndPageOrder,assertCurrent,countOnly=false,clock=Date.now}){
 const q=brandOnlyScope(query);if(!q||!index)return null;
 const a=authority(active);
 // Wrong generation, wrong filter, missing index, forged/incomplete sidecar:
 // caller must use normal compatibility/ranking, never publish an empty count.
 if(policyDay(clock())!==a.policyDay||clock()>=a.validUntil||!SHA.test(expectedObjectSha256??'')||expectedObjectSha256!==digest(index)||index.kind!=='china-native-exact-filter-index'||
    index.version!==1||index.key!==scopeKey(a,q)||digest(index.authority)!==digest(a)||!Number.isSafeInteger(index.total)||
    index.total<0||index.total>a.admittedRows||!Array.isArray(index.ranked)||index.ranked.length!==Math.min(index.total,DEPTH)||
    index.rankedSha256!==digest(index.ranked))return null;
 if(countOnly){await assertCurrent();return {generationId:a.generationId,total:index.total,items:[],marketCountInfo:{}};}
 const start=(q.page-1)*q.pageSize, selected=index.ranked.slice(start,start+q.pageSize);
 const rows=[];
 requireFunction(readPosition);requireFunction(applyNativeCityAndPageOrder);requireFunction(assertCurrent);
 await assertCurrent();
 for(const p of selected){
  need(pos(p),'indexed_native_position');
  const row=await readPosition(p); // scope/checksum and locator from authenticated current snapshot
  need(row?.id===p.id&&row.market==='china'&&row.totalRub===p.baseRub,'current_native_row_binding');
  rows.push(row);
 }
 const items=await applyNativeCityAndPageOrder(rows,q); // same existing project→balance semantics
 need(Array.isArray(items)&&items.length===rows.length&&new Set(items.map(x=>x.id)).size===rows.length&&
   items.every(x=>rows.some(r=>r.id===x.id)),'display_order_membership');
 await assertCurrent();
 if(policyDay(clock())!==a.policyDay||clock()>=a.validUntil)return null;
 return {generationId:a.generationId,page:q.page,pageSize:q.pageSize,total:index.total,items};
}
