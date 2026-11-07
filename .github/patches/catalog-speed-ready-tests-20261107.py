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
# This test still exercises stale queue-recovery, not the newly independent
# fresh metadata hit. Keep every original output/source-switch assertion.
before="let calls=0;const saved={items:[],models:[{make:'HYUNDAI',model:'TUCSON',total:7}],page:1,pageSize:500,received:1,observedAt:new Date().toISOString()};"
assert s.count(before)==1
s=s.replace(before,before.replace('new Date().toISOString()','new Date(Date.now()-3600000).toISOString()'))
p.write_text(s)
print('Existing model recovery semantics preserved; only the intended supplier admission is rejected by the fixture.')
