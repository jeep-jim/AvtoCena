/** Small atomic manifest batches; immutable records are verified before exposure. */
export async function publishReferencePlans({plans,manifest,storage,mutateManifest,root,summarize,checksum,onBatch=async()=>{}}){
 const expected=new Map(manifest.models.map(s=>[s.id,s.revision]));
 const parallel=async(items,run)=>{let cursor=0;await Promise.all(Array.from({length:Math.min(6,items.length)},async()=>{for(;;){const i=cursor++;if(i>=items.length)return;await run(items[i]);}}));};
 for(let offset=0;offset<plans.length;offset+=16){
  const batch=plans.slice(offset,offset+16).map(p=>({...p,record:{...p.record,previousKey:p.summary.key},key:`${root}/revisions/${p.record.id}/${p.record.revision}.json`}));
  await parallel(batch,async p=>{
   await storage.writeJson(p.key,p.record,{ifNoneMatch:'*'});
   if(checksum(await storage.readJson(p.key,null))!==checksum(p.record))throw Error('reference_revision_readback_failed');
  });
  const replacements=new Map(batch.map(p=>[p.record.id,summarize(p.record,p.key)]));
  await mutateManifest(m=>{
   if(!m||m.models.length!==expected.size||m.models.some(s=>expected.get(s.id)!==s.revision))throw Error('concurrent_encyclopedia_edit');
   return {...m,updatedAt:batch[0].record.updatedAt,models:m.models.map(s=>replacements.get(s.id)||s)};
  });
  const current=await storage.readJson(`${root}/manifest.json`,null);
  for(const p of batch){
   if(current?.models.find(s=>s.id===p.record.id)?.revision!==p.record.revision)throw Error('reference_publication_readback_failed');
   expected.set(p.record.id,p.record.revision);
  }
  await onBatch(batch);
 }
}
