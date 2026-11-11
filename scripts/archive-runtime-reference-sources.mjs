import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getJsonStorage} from '../apps/web/lib/data.ts';
if(process.env.JSON_STORAGE_DRIVER!=='object')throw Error('reference_archive_requires_object_storage');
const paths=['denominator','generated'];
const root='data/catalog/knowledge-source-snapshots';
const trees=paths.map(path=>execFileSync('git',['rev-parse',`HEAD:${root}/${path}`],{encoding:'utf8'}).trim());
const version=createHash('sha256').update(trees.join('\n')).digest('hex');
const key=`archives/reference-sources/${version}.tar.gz`,receipt=`archives/reference-sources/${version}.json`;
const storage=getJsonStorage();
const saved=await storage.readJson(receipt,null);
if(saved?.verified===true&&saved.version===version&&await storage.head(key)){
 console.log('REFERENCE_ARCHIVE_REUSED',JSON.stringify({version,bytes:saved.bytes}));
}else{
 const dir=await mkdtemp(join(tmpdir(),'reference-archive-'));
 try{
  const file=join(dir,'sources.tar.gz');
  execFileSync('tar',['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-czf',file,'-C',root,...paths]);
  const bytes=await readFile(file),checksum=createHash('sha256').update(bytes).digest('hex');
  if(!await storage.head(key))await storage.putBinary(key,bytes,'application/gzip',{ifNoneMatch:'*'});
  const restored=await storage.getBinary(key);
  if(createHash('sha256').update(restored.data).digest('hex')!==checksum)throw Error('reference_archive_checksum_mismatch');
  await storage.writeJson(receipt,{version,paths,trees,bytes:bytes.length,checksum,verified:true,verifiedAt:new Date().toISOString()});
  console.log('REFERENCE_ARCHIVE_VERIFIED',JSON.stringify({version,bytes:bytes.length,checksum}));
 }finally{await rm(dir,{recursive:true,force:true});}
}
