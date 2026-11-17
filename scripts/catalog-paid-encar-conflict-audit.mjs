import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function summarize(raw, page, row) {
  const id=String(raw?.inner_id||'');
  assert.match(id,/^\d{6,10}$/); assert.equal(String(raw?.data?.inner_id),id);
  const fields=Object.fromEntries(['history','inspection','diagnosis'].map(k=>[k,raw.data[k]??null]));
  return {id,page,row,digest:hash(fields),canonicalDigest:hash(canonical(fields)),fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{type:v===null?'null':Array.isArray(v)?'array':typeof v,digest:hash(v),canonicalDigest:hash(canonical(v))}]))};
}
export async function auditSavedSnapshot({storage,root,concurrency=4,onProgress=()=>{}}) {
  assert.match(root,/^catalog\/intake-staging\/encar\/\d+\/[1-9]\d*$/);
  assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4);
  const snapshot=await storage.readJson(root+'/complete.json',null);
  assert.ok(Number.isSafeInteger(snapshot?.pages)&&snapshot.pages>0&&snapshot.pages<=100000);
  assert.ok(Number.isSafeInteger(snapshot?.count)&&snapshot.count>0);
  const identity=hash(snapshot), seen=new Map(),conflicts=[];let cursor=1,count=0,read=0,duplicates=0;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(cursor<=snapshot.pages){
      const page=cursor++,rows=await storage.readJson(root+'/pages/'+page+'.json',null);
      assert.ok(Array.isArray(rows)&&(rows.length||page===snapshot.pages),'saved_page_missing:'+page);
      for(let i=0;i<rows.length;i++){
        const next=summarize(rows[i],page,i+1),prior=seen.get(next.id);count++;
        if(!prior){seen.set(next.id,next);continue;} duplicates++;
        if(prior.digest!==next.digest){
          assert.ok(conflicts.length<1000,'conflict_audit_limit');
          conflicts.push({sourceOfferId:next.id,previous:prior,incoming:next,canonicalEqual:prior.canonicalDigest===next.canonicalDigest,changedFields:Object.keys(next.fields).filter(k=>prior.fields[k].digest!==next.fields[k].digest)});
        }
      }
      read++;if(read%250===0)onProgress({pagesRead:read,totalPages:snapshot.pages,count,unique:seen.size,conflicts:conflicts.length});
    }
  }));
  assert.equal(count,snapshot.count,'snapshot_count_mismatch');
  assert.equal(hash(await storage.readJson(root+'/complete.json',null)),identity,'snapshot_changed');
  return {version:1,root,snapshotSha256:identity,pages:read,count,unique:seen.size,duplicates,conflicts,storageWrites:0,providerRequests:0};
}
