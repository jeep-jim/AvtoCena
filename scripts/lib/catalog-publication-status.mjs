// Metadata only: never download listing payloads or modify production objects.
export async function catalogPublicationStatus(storage, now=Date.now()) {
 const [manifest,lock,generationObjects,internalObjects]=await Promise.all([
  storage.readJson('catalog/manifest.json',null),storage.readJson('catalog/import-lock.json',null),
  storage.listObjects('catalog/generations'),storage.listObjects('catalog/internal/offers'),
 ]);
 const generations=new Map();
 for(const object of [...generationObjects,...internalObjects]){
  const match=String(object.key||'').match(/(?:^|\/)(gen_(\d+)_[a-f0-9]{8})(?:\/|-)/);
  if(!match)continue;
  const id=match[1],row=generations.get(id)||{generationId:id,createdAt:new Date(Number(match[2])).toISOString(),objects:0,bytes:0,lastWriteAt:null,groups:{}};
  const group=object.key.startsWith('catalog/internal/')?'internal':object.key.slice(object.key.indexOf(id)+id.length+1).split('/').slice(0,2).join('/').replace(/\/[^/]+\.json$/,'');
  row.objects++;row.bytes+=Math.max(0,Number(object.size)||0);row.groups[group]=(row.groups[group]||0)+1;
  if(Number.isFinite(Date.parse(object.lastModified))&&(!row.lastWriteAt||Date.parse(object.lastModified)>Date.parse(row.lastWriteAt)))row.lastWriteAt=object.lastModified;
  generations.set(id,row);
 }
 return {checkedAt:new Date(now).toISOString(),activeGeneration:manifest?.generationId||null,
  activeCounts:Object.fromEntries(Object.entries(manifest?.markets||{}).map(([market,value])=>[market,value.count])),
  writer:{active:Date.parse(lock?.lockedUntil||'')>now,operationType:lock?.operationType||null,
   startedAt:lock?.startedAt||null,heartbeatAt:lock?.heartbeatAt||null,lockedUntil:lock?.lockedUntil||null},
  recentGenerations:[...generations.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,3)};
}
