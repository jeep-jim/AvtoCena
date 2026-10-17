import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {maintainIdeas,IDEA_RETENTION_MS,ideaExpiresAt} from '../apps/web/lib/team-ideas-retention';
import type {TeamIdea} from '../apps/web/lib/team-ideas';
test('retention grants legacy ideas 30 days, removes only expired completed ideas with media cleanup',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'idea-retention-'));
 process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';
 try{
  const now=Date.parse('2026-10-08T05:00:00Z');
  const base:TeamIdea={id:'base',number:1,title:'Title',description:'Private description',authorId:'manager',authorName:'Name',createdAt:'2026-07-01',updatedAt:'2026-07-01',progress:100,votes:[],screenshots:[]};
  const expired={...base,id:'expired',number:2,completedAt:new Date(now-IDEA_RETENTION_MS).toISOString(),screenshots:['expired/image.webp'],comments:[{id:'comment',authorId:'manager',authorName:'Name',text:'Private comment',createdAt:'2026-07-02',screenshots:['expired/comment.webp']}]};
  const active={...base,id:'active',number:3,progress:50,completedAt:expired.completedAt};
  const boundary={...base,id:'boundary',number:4,completedAt:new Date(now-IDEA_RETENTION_MS+1).toISOString()};
  fs.mkdirSync('data/crm/team-ideas/media/expired',{recursive:true});
  for(const file of ['image.webp','comment.webp'])fs.writeFileSync('data/crm/team-ideas/media/expired/'+file,'image');
  fs.writeFileSync('data/crm/team-ideas/items.json',JSON.stringify([base,expired,active,boundary]));
  assert.deepEqual(await maintainIdeas(now),{purged:1,failed:0});
  let rows=JSON.parse(fs.readFileSync('data/crm/team-ideas/items.json','utf8'));
  assert.equal(rows[0].completedAt,new Date(now).toISOString());
  assert.equal(ideaExpiresAt(rows[0]),new Date(now+IDEA_RETENTION_MS).toISOString());
  assert.ok(rows[1].deletedAt);assert.equal(rows[1].description,'');assert.equal(rows[1].comments,undefined);assert.equal(rows[1].number,2);
  assert.equal(rows[2].deletedAt,undefined);assert.equal(ideaExpiresAt(rows[2]),undefined);
  assert.equal(rows[3].deletedAt,undefined);
  assert.equal(fs.existsSync('data/crm/team-ideas/media/expired/image.webp'),false);
  assert.equal(fs.existsSync('data/crm/team-ideas/media/expired/comment.webp'),false);
  assert.deepEqual(await maintainIdeas(now+1),{purged:1,failed:0});
  assert.deepEqual(await maintainIdeas(now+1),{purged:0,failed:0});
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;fs.rmSync(tmp,{recursive:true,force:true});}
});
