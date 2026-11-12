import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {cleanBlogPost,blogUrl} from '../apps/web/lib/blog/schema';
import {saveBlogPost,readBlogPost,readBlogArticle,blogIndex,BlogConflict} from '../apps/web/lib/blog/records';
import {resetJsonStorageForTests,getJsonStorage} from '../apps/web/lib/data';
import seed from '../apps/web/content/blog/posts.json';
const input={slug:'test-article',title:'Проверенная статья',description:'Проверенное описание новости',body:'Текст статьи с подтверждёнными фактами. '.repeat(10),cover:'https://example.org/photo.jpg',coverCredit:'Автор тестового фото; разрешение на публикацию',sources:[{title:'Источник',url:'https://example.org/news'}],related:[{title:'Toyota',url:'/cars?make=Toyota'}],status:'draft'};
test('article and related cards share one index read; unpublish and edits are immediately visible',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,temp=fs.mkdtempSync(path.join(os.tmpdir(),'blog-read-'));
 fs.mkdirSync(path.join(temp,'data'));process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 const storage=getJsonStorage(),original=storage.readJson.bind(storage);let indexReads=0;
 try{
  const saved=await saveBlogPost({...input,status:'published'});
  storage.readJson=async function<T>(key:string,fallback:T){if(key==='content/blog/v1/index.json')indexReads++;return original(key,fallback);};
  const article=await readBlogArticle(input.slug);
  assert.equal(indexReads,1);assert.equal(article?.post.revision,saved.revision);
  assert.ok(article!.related.length<=3);assert.ok(article!.related.every(p=>p.status==='published'&&p.slug!==input.slug));
  const edited=await saveBlogPost({...input,status:'published',title:'Изменённая статья',revision:saved.revision});
  assert.equal((await readBlogArticle(input.slug))?.post.title,'Изменённая статья');
  await saveBlogPost({...input,revision:edited.revision});assert.equal(await readBlogArticle(input.slug),null);
 }finally{storage.readJson=original;process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}
});
test('article links and published source requirements are validated',()=>{assert.equal(blogUrl('javascript:alert(1)'), '');assert.equal(blogUrl('//evil.test',true),'');assert.equal(blogUrl('/cars/../../api/private',true),'');assert.throws(()=>cleanBlogPost({...input,status:'published',sources:[]}));assert.throws(()=>cleanBlogPost({...input,cover:'https://example.org/photo.jpg',coverCredit:''}));assert.equal(cleanBlogPost(input).status,'draft');const seen=new Set();for(const post of seed as any[]){cleanBlogPost(post);assert.ok(!seen.has(post.slug));seen.add(post.slug);assert.ok(Number.isFinite(Date.parse(post.publishedAt)));}});
test('drafts stay private and optimistic revisions prevent overwriting an owner article',async()=>{const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,temp=fs.mkdtempSync(path.join(os.tmpdir(),'blog-'));fs.mkdirSync(path.join(temp,'data'));process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();try{const draft=await saveBlogPost(input);assert.equal(draft.publishedAt,'');assert.equal(await readBlogPost(input.slug),null);assert.equal((await blogIndex()).length,seed.length);const published=await saveBlogPost({...input,status:'published',revision:draft.revision});assert.equal((await readBlogPost(input.slug))?.revision,published.revision);assert.ok(published.publishedAt);await assert.rejects(saveBlogPost({...input,revision:draft.revision}),BlogConflict);assert.equal((await readBlogPost(input.slug))?.status,'published');await saveBlogPost({...input,revision:published.revision});assert.equal(await readBlogPost(input.slug),null);}finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}});
