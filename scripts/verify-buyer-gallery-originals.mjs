import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
// Owner's accepted upload, not a baseline derived from the files under test.
// https://github.com/jeep-jim/AvtoCena/commit/22de2242962078427015017eff33759eb0216dde
const sourceCommit='22de2242962078427015017eff33759eb0216dde';
const files=[];
for(let n=16;n<=24;n++){
 const path=`apps/web/public/buyers/${n}.jpg`;
 const original=execFileSync('git',['show',`${sourceCommit}:${path}`],{maxBuffer:5*1024*1024});
 const actual=fs.readFileSync(path);
 assert.ok(actual.equals(original),`${n}.jpg differs from the owner's upload ${sourceCommit}`);
 assert.equal(actual.readUInt16BE(0),0xffd8,`${n}.jpg is not JPEG`);
 files.push({file:`${n}.jpg`,bytes:actual.length,sha256:crypto.createHash('sha256').update(actual).digest('hex')});
}
const home=fs.readFileSync('apps/web/components/home/HomePageClient.tsx','utf8');
assert.ok(home.includes('const buyers = Array.from({ length: 24 }, (_, index) => `/buyers/${index + 1}.jpg`);'),'gallery count is not 24');
const report={verified:true,sourceCommit,count:24,checkedOriginals:files.length,files};
fs.writeFileSync('buyer-gallery-originals-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
