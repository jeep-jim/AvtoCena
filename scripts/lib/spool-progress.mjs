import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
export function spoolProgressWriter(file,bindingSha){assert.ok(path.isAbsolute(file));assert.match(bindingSha,/^[a-f0-9]{64}$/);return async event=>{
 assert.ok(['spool_chunk_committed','spool_chunk_resumed','spool_complete_verified'].includes(event.stage));
 const value={version:1,bindingSha,stage:event.stage};for(const key of ['chunks','pages','rows','bytes']){assert.ok(Number.isSafeInteger(event[key])&&event[key]>=0);value[key]=event[key];}
 const body=JSON.stringify(value);assert.ok(Buffer.byteLength(body)<2048);await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.partial';const h=await fs.open(tmp,'w',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}await fs.rename(tmp,file);console.log(body);
};}
