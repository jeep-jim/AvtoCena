import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanImages,cleanPhotos,MAX_IMAGES,MAX_IMAGE_BYTES,MAX_REQUEST_BYTES,readAssistantBody} from '../apps/web/lib/team-assistant/media';
const image={name:'Фото',dataUrl:'data:image/jpeg;base64,/9j/2Q=='};
test('image inputs allow bounded JPEG data only, never remote URLs or executable formats',()=>{
 assert.deepEqual(cleanImages(undefined),[]);assert.equal(cleanImages([image])[0].name,'Фото');
 for(const raw of [[{...image,dataUrl:'https://host.test/photo.jpg'}],[{...image,dataUrl:'data:image/svg+xml;base64,PHN2Zz4='}],[{...image,dataUrl:'data:image/jpeg;base64,hello'}],Array(MAX_IMAGES+1).fill(image),[{...image,dataUrl:'data:image/jpeg;base64,/9j/'+ 'A'.repeat(MAX_IMAGE_BYTES*2)}]])assert.throws(()=>cleanImages(raw));
});
test('photo controls reject active URLs, credentials and protocol-relative links and deduplicate',()=>{
 const photos=cleanPhotos(['javascript:alert(1)','data:image/svg+xml,x','//evil.test/x','https://u:p@host.test/x','http://host.test/x','/api/catalog/images/one','/api/catalog/images/one','https://images.test/car.jpg'].map(url=>({url})));
 assert.deepEqual(photos.map(p=>p.url),['/api/catalog/images/one','https://images.test/car.jpg']);
});
test('request limit counts actual streamed bytes even without content-length',async()=>{
 const req=(body:BodyInit)=>new Request('https://avtocena.com/api/crm/assistant',{method:'POST',body,duplex:'half'} as RequestInit);
 assert.deepEqual(await readAssistantBody(req(JSON.stringify({images:[image]}))),{images:[image]});
 let cancelled=false;
 const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 await assert.rejects(readAssistantBody(req(stream)),/слишком большое/);assert.equal(cancelled,true);
 await assert.rejects(readAssistantBody(new Request('https://avtocena.com',{method:'POST',headers:{'content-length':String(MAX_REQUEST_BYTES+1)},body:'{}'})),/слишком большое/);
});
