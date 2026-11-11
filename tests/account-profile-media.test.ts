import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
import {customerAvatar,DEFAULT_CUSTOMER_AVATAR,CUSTOMER_AVATARS} from '../apps/web/lib/account/avatars';
import {videoReview,videoReviews,withoutVideoLinks} from '../apps/web/lib/dealers/video-review';
import {withAccountMediaDefaults,normalizeAccountAppearance} from '../apps/web/lib/account-appearance';
import {isAccountVideo,videoContainer} from '../apps/web/lib/account/video';
const require=createRequire(import.meta.url);
test('avatar defaults are neutral, four groups have six items and old selections remain',()=>{assert.equal(customerAvatar('new-account'),DEFAULT_CUSTOMER_AVATAR);assert.equal(customerAvatar('old','character-19'),'/avatars/customers/character-19.svg');for(const group of ['women','men','city-cars','offroad-cars'])assert.equal(CUSTOMER_AVATARS.filter(a=>a.group===group).length,6);});
test('video reviews extract only supported HTTPS links without executing or embedding arbitrary pages',()=>{const max='https://max.ru/c/-70911744281303/AZzc3-40KH4';assert.deepEqual(videoReview('Видео обзор ссылка на MAX: '+max),{url:max,source:'MAX'});assert.equal(videoReview('https://max.ru.evil.test/c/a/b'),null);assert.equal(videoReview('javascript:alert(1)'),null);assert.equal(videoReview('https://u:p@max.ru/c/a/b'),null);assert.equal(videoReviews(max,max).length,1);assert.equal(withoutVideoLinks('Видео обзор ссылка на MAX: '+max),'');assert.match(videoReview('https://youtu.be/abcdefghijk')!.embed!,/^https:\/\/www.youtube-nocookie.com\/embed\//);});
test('loading demo can be removed and custom galleries are preserved',()=>{const defaults=withAccountMediaDefaults();assert.equal(defaults.customer?.media?.length,1);assert.deepEqual(normalizeAccountAppearance(defaults),defaults);const cleared={customer:{banner:'',icon:'',media:[],mediaDefaultsApplied:true}};assert.deepEqual(withAccountMediaDefaults(cleared),cleared);});
test('MOV is recognized without trusting filename alone; other byte formats fail',()=>{assert.equal(isAccountVideo({type:'video/quicktime',name:'iPhone.MOV'}),true);assert.equal(isAccountVideo({type:'',name:'iPhone.MOV'}),true);assert.throws(()=>videoContainer(Buffer.from('not a video')));const bytes=Buffer.alloc(32);bytes.writeUInt32BE(24);bytes.write('ftypqt  ',4);assert.equal(videoContainer(bytes),'mov');bytes.writeUInt32BE(999);assert.throws(()=>videoContainer(bytes));});
test('customer push isolates accounts, expires old sessions and keeps sensitive content out of payloads',async()=>{
 const id='a'.repeat(64),other='b'.repeat(64);const state:any={records:new Map(),account:{id,sessionVersion:0},sent:[],linked:true};(globalThis as any).__accountPush=state;
 const mocks:Record<string,string>={
 'web-push':'export default {sendNotification:async(s,p)=>globalThis.__accountPush.sent.push({s,p:JSON.parse(p)})};',
 '../data':`export const readDataJson=async(p,f)=>p.startsWith('accounts/users/')?globalThis.__accountPush.account:globalThis.__accountPush.records.get(p)||f;export const mutateDataJson=async(p,f,update)=>{const v=update(globalThis.__accountPush.records.get(p)||f);globalThis.__accountPush.records.set(p,v);return v;};`,
 '../crm-push':'export const pushKeys=async()=>({publicKey:"public",privateKey:"private"});',
 './auth':'export const accountPath=id=>"accounts/users/"+id;',
 './portal':'export const portalData=async()=>globalThis.__accountPush.linked?[{messages:[{text:"secret"}]}]:[];'
 };
 const bundle=await build({entryPoints:['apps/web/lib/account/push.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'push-test',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}]});const module={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);const api=module.exports;
 const subscription={endpoint:'https://fcm.googleapis.com/test',keys:{auth:Buffer.alloc(16).toString('base64url'),p256dh:Buffer.alloc(65).toString('base64url')}};
 try{
 await assert.rejects(()=>api.registerCustomerPush(state.account,{...subscription,endpoint:'http://127.0.0.1/private'}));
 await api.registerCustomerPush(state.account,subscription);await api.removeCustomerPush(other,subscription.endpoint);assert.equal(state.records.get('accounts/push-subscriptions.json').length,1);
 await api.sendCustomerPush(id,'/account?tab=chat');assert.equal(state.sent.length,1);assert.equal(state.sent[0].p.accountId,id);assert.ok(!JSON.stringify(state.sent).includes('secret'));
 state.linked=false;await api.sendCustomerPush(id,'/account');assert.equal(state.sent.length,1);
 state.linked=true;state.account.sessionVersion=1;await api.sendCustomerPush(id,'/account');assert.equal(state.sent.length,1);assert.equal(state.records.get('accounts/push-subscriptions.json').length,0);
 }finally{delete (globalThis as any).__accountPush;}
});
test('customer worker suppresses pushes after account switch or logout',async()=>{const handlers:any={},shown:any[]=[];let account:any={id:'current'};const scope:any={location:{origin:'https://avtocena.com'},addEventListener:(n:string,f:any)=>handlers[n]=f,registration:{showNotification:async(...args:any[])=>shown.push(args)}};vm.runInNewContext(readFileSync('apps/web/public/account-notifications-sw.js','utf8'),{self:scope,URL,fetch:async(url:string)=>Response.json(url.endsWith('/auth')?{account}:{items:[{id:'message'}]})});async function push(id:string){let work;handlers.push({data:{json:()=>({accountId:id,href:'/account?tab=chat'})},waitUntil:(p:any)=>work=p});await work;}await push('other');assert.equal(shown.length,0);await push('current');assert.equal(shown.length,1);account=null;await push('current');assert.equal(shown.length,1);});
test('legacy default avatar URL redirects to the bundled key on the public origin',async()=>{
 const {GET}=await import('../apps/web/app/api/account/default-avatar/route');
 const response=GET();assert.equal(response.status,307);assert.equal(response.headers.get('location'),'/key-logo.png');
 assert.equal(customerAvatar('new-account'),'/key-logo.png');
});
