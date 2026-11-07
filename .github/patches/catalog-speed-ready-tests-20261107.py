from pathlib import Path
p=Path('tests/ajes-model-recovery.test.ts');s=p.read_text()
anchor="test('model directory queue failures recover exact saved names without contacting the supplier',async t=>{"
helper="""function rejectSupplierQueue(t:any,message:string){
 const original=DetailReadCache.prototype.get;
 t.mock.method(DetailReadCache.prototype,'get',function(this:DetailReadCache<any>,...args:Parameters<typeof original>){
  return args[3]==='prepared'?original.apply(this,args):Promise.reject(Error(message));
 });
}

"""
assert s.count(anchor)==1
s=s.replace(anchor,helper+anchor)
for reason in ['detail_cache_queue_full','detail_cache_queue_timeout']:
 before="t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(Error('"+reason+"')));"
 assert s.count(before)==1
 s=s.replace(before,"rejectSupplierQueue(t,'"+reason+"');")
# Preserve every recovery assertion; the independently ready fresh path is
# tested separately, while this existing scenario must still exercise stale.
before="let calls=0;const saved={items:[],models:[{make:'HYUNDAI',model:'TUCSON',total:7}],page:1,pageSize:500,received:1,observedAt:new Date().toISOString()};"
assert s.count(before)==1
s=s.replace(before,before.replace('new Date().toISOString()','new Date(Date.now()-3600000).toISOString()'))
p.write_text(s)
# inspectPrepared now excludes only detail, so TypeScript correctly identifies
# the old non-detail ternary arm as unreachable. No runtime path is removed.
p=Path('apps/web/lib/catalog/ajes-client.ts');s=p.read_text()
before="if(!inspectPrepared)try {saved=query.kind==='detail'?await deps.readDetail?.(query.table,query.id!):await deps.readQuery?.(query.sql);}catch{}"
assert s.count(before)==1
s=s.replace(before,"if(!inspectPrepared)try {saved=await deps.readDetail?.(query.table,query.id!);}catch{}")
p.write_text(s)
print('Supplier-only recovery fixtures retained; unreachable detail ternary removed without changing runtime behavior.')
