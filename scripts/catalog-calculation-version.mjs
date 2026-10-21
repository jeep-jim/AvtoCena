import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Conservative source/data closure: all server libraries, packages, committed
// data and dependency/build configuration. UI, documentation and tests do not
// change the calculator. Blob IDs include additions/deletions and file contents.
export function calculationVersion(root=process.cwd()) {
 const tree=execFileSync('git',['ls-tree','-rz','--full-tree','HEAD'],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
 const records=tree.split('\0').filter(Boolean).filter(record=>{
  const name=record.slice(record.indexOf('\t')+1);
  return /^(?:apps\/web\/lib\/|packages\/|data\/|scripts\/)/.test(name)
   || /^(?:package(?:-lock)?\.json|Dockerfile|tsconfig[^/]*\.json|apps\/web\/(?:package\.json|tsconfig[^/]*\.json|next\.config\.[^/]+)|\.github\/workflows\/deploy-yandex\.yml)$/.test(name);
 });
 if(!records.some(r=>r.endsWith('\tapps/web/lib/catalog/shared-budget-prices.ts')))throw Error('calculation_source_tree_missing');
 return createHash('sha256').update('avtocena-calculator-v1\0'+records.join('\0')).digest('hex');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(calculationVersion(process.argv[2]));
