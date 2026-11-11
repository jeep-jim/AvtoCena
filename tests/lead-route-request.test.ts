import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
test('public lead route accepts framework-proxied Requests on Node 24 and preserves validation, consent and visitor identity',async()=>{
 const state:any={received:[],cookies:[],deliveries:0};(globalThis as any).__leadRouteTest=state;
 const sources:Record<string,string>={
  '@/lib/account/auth':'export async function currentAccount(){return null}',
  '@/lib/auth':'export async function getCurrentUser(){return null};export function isCrmRole(){return false}',
  '@/lib/lead-antispam':'export function leadVisitor(){return {cookie:"signed-visitor",id:"visitor"}}',
  '@/lib/lead-intake':`import {NextResponse} from 'next/server';export async function createLead(request){const body=await request.json();globalThis.__leadRouteTest.received.push({body,cookie:request.headers.get('cookie'),origin:request.headers.get('origin'),url:request.url});return NextResponse.json(body.personalDataConsent?{ok:true,leadId:'fixture'}:{ok:false,error:'personal_data_consent_required'},{status:body.personalDataConsent?200:400})}`,
  '@/lib/crm-push':'export async function flushCrmPush(){}',
  '@/lib/crm-dispatch':'export async function requestCrmDelivery(){globalThis.__leadRouteTest.deliveries++}',
  '@/lib/crm-notifications':'export async function flushCrmNotifications(){}',
  '@/lib/data':'export async function readChunkedDataJson(){return []}',
  '@/lib/crm-visibility':'export function canSeeLead(){return false}',
  'next/server':`export function after(){};export class NextResponse extends Response{cookies={set(...args){globalThis.__leadRouteTest.cookies.push(args)}};static json(body,init){return new NextResponse(JSON.stringify(body),init)}}`,
 };
 const built=await build({entryPoints:['apps/web/app/(public)/api/leads/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>sources[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:sources[a.path],loader:'ts'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 const proxied=(body:any)=>new Proxy(new Request('https://avtocena.com/api/leads',{method:'POST',headers:{'content-type':'application/json',origin:'https://avtocena.com',cookie:'other=preserved; ac_lead_visitor=old'},body:JSON.stringify(body)}),{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 try{
  // This is the exact production failure, before the handler can validate input.
  assert.throws(()=>new Request(proxied({}),{headers:new Headers()}),/private member #state/);
  const invalid=await m.exports.POST(proxied({}));assert.equal(invalid.status,400);assert.equal(state.deliveries,0);
  const body={personalDataConsent:true,operationId:'retry-stable',offerId:'fixture',phone:'+70000000000'};
  const response=await m.exports.POST(proxied(body));assert.equal(response.status,200);assert.equal((await response.json()).leadId,'fixture');
  assert.deepEqual(state.received[1].body,body);assert.match(state.received[1].cookie,/other=preserved/);assert.match(state.received[1].cookie,/ac_lead_visitor=signed-visitor/);assert.doesNotMatch(state.received[1].cookie,/visitor=old/);assert.equal(state.received[1].origin,'https://avtocena.com');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(state.deliveries,1);
 }finally{delete (globalThis as any).__leadRouteTest;}
});
