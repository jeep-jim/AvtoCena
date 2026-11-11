// Read only the existing bounded query cache. No provider requests or writes.
const moduleValue=async path=>{const m=await import(path);return {...m.default,...m};};
const {getJsonStorage}=await moduleValue('../../apps/web/lib/data.ts');
const {findSavedAjesSearch}=await moduleValue('../../apps/web/lib/catalog/ajes-saved-search.ts');
const {enrichJapanDrive}=await moduleValue('../../apps/web/lib/catalog/japan-drive.ts');
const storage=getJsonStorage();
const release='5bfcbb97f5c6f44468689e810238a53c48908bb4';
const binding=await storage.readJson('knowledge/encyclopedia/calculation-releases/'+release+'.json',null);
if(!binding||!/^knowledge\/encyclopedia\/calculation-indexes\/[a-f0-9]{64}\.json$/.test(binding.key))throw Error('binding_missing');
const index=await storage.readJson(binding.key,null);
if(index?.digest!==binding.digest)throw Error('index_mismatch');
const snapshots={};
for(let start=0;start<128;start+=8){
 const slots=await Promise.all(Array.from({length:8},(_,i)=>storage.readJson(`catalog/partner-cache/ajes/queries/${start+i}.json`,null)));
 for(const slot of slots)for(const lot of slot?.value?.items||[]){
  if(lot.table!=='stats')continue;
  const key=lot.table+':'+lot.id,at=slot.value.observedAt;
  if(!snapshots[key]||Date.parse(snapshots[key].observedAt)<Date.parse(at))snapshots[key]={items:[lot],observedAt:at};
 }
}
const now=Date.now(),counts={saved:0,known:0,awd:0,fwd:0,rwd:0},porsche=[];
for(const s of Object.values(snapshots)){
 const lot=s.items[0],age=now-Date.parse(s.observedAt);
 if(age<0||age>=7*86400000)continue;
 counts.saved++;
 const resolved=enrichJapanDrive({market:'japan',make:lot.make,model:lot.model,year:lot.year,trim:lot.trim,chassisCode:lot.chassisCode,operational:{raw:{sourceDrive:lot.sourceDrive}}},index).drive;
 if(resolved){counts.known++;counts[resolved]++;}
 if(String(lot.make).toUpperCase()==='PORSCHE')porsche.push({model:lot.model,year:lot.year,chassisCode:lot.chassisCode,drive:resolved||null});
}
console.log('SAVED_JAPAN_DRIVE_COUNTS',JSON.stringify(counts));
console.log('SAVED_PORSCHE_CHASSIS',JSON.stringify([...new Map(porsche.map(r=>[JSON.stringify(r),r])).values()]));
for(const make of [undefined,'Porsche','Honda','Toyota','Subaru'])for(const drive of ['awd','fwd','rwd']){
 const query={table:'stats',drive,pageSize:48,...(make?{make}:{})};
 const result=findSavedAjesSearch(query,snapshots,now,index);
 if(result&&(!result.partial||!result.stale||'total' in result))throw Error('partial_result_contract');
 console.log('SAVED_DRIVE_PAGE',JSON.stringify({make:make||'all',drive,returned:result?.items.length||0,partial:Boolean(result),fullInventoryCount:false}));
}
