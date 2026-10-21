import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function load(entry:string,state:any,mocks:Record<string,string>={}){
 (globalThis as any).__ab=state;process.env.AUTH_SECRET='autobot-test-only';
 mocks={'display-identity':`export const applyEncyclopediaDisplayIdentity=async x=>x;`,data:`const s=globalThis.__ab;export const readDataJson=async(k,f)=>s.files.get(k)??f;export const mutateDataJson=async(k,f,fn)=>{const n=fn(s.files.get(k)??f);s.files.set(k,n);return n;};`,...mocks};
 const b=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>{const n=a.path.split('/').at(-1)!;if(mocks[n])return {path:n,namespace:'mocks'};});b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],loader:'js'}));}}]});const m={exports:{} as any};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('key encrypted at rest, redacted on reads, hostile endpoints rejected',async()=>{
 const state={files:new Map()},c=await load('apps/web/lib/autobot/config.ts',state);
 for(const u of ['http://ai.reg.ru/chat/completions','https://reg.ru.evil.test/chat/completions','https://user:pass@ai.reg.ru/chat/completions','https://127.0.0.1/chat/completions','https://ai.reg.ru/chat/completions?token=x'])assert.throws(()=>c.validateEndpoint(u));
 await c.saveAutobotConfig({enabled:true,endpoint:'https://ai.reg.ru/v1/chat/completions',model:'test',token:'PRIVATE-KEY',inputRate:30,outputRate:90,monthlyLimit:3000});
 assert.ok(!JSON.stringify([...state.files.values()]).includes('PRIVATE-KEY'));const read=await c.readAutobotConfig();assert.equal(read.token,'PRIVATE-KEY');assert.equal(c.publicConfig(read).token,undefined);assert.equal(c.configReady(read),true);
 await assert.rejects(c.saveAutobotConfig({...read,monthlyLimit:3001}));
});
test('parallel calls reserve shared allowance; settlement counts usage, failures retain estimated charge',async()=>{
 const state={files:new Map()},b=await load('apps/web/lib/autobot/budget.ts',state);
 const tickets=await Promise.allSettled(Array.from({length:20},()=>b.reserveBudget(1,3)));assert.equal(tickets.filter(t=>t.status==='fulfilled').length,3);
 const ok=tickets.filter((t:any)=>t.status==='fulfilled') as PromiseFulfilledResult<any>[];
 await b.settleBudget(ok[0].value,.2);await b.settleBudget(ok[0].value,.2);await b.settleBudget(ok[1].value);let s=await b.budgetStatus();assert.equal(s.spent,1.2);assert.equal(s.reserved,1);assert.equal(s.calls,2);
 await b.settleBudget(ok[2].value,2);assert.equal((await b.budgetStatus()).blocked,true);await assert.rejects(b.reserveBudget(.1,3));
 assert.equal(b.budgetMonth(new Date('2026-10-31T18:00:00Z')),'2026-11');assert.throws(()=>b.reserveInLedger({spent:0,holds:{},calls:0},'x',NaN,3000));
});
test('public route rejects CSRF and large requests; no login required for read-only chat',async()=>{
 const state={files:new Map()},r=await load('apps/web/app/api/autobot/route.ts',state,{agent:`export const runPublicAutobot=async(body)=>({text:'Ответ',cards:[],sources:[]});`});
 const req=(origin:string,body:any)=>new Request('https://avtocena.com/api/autobot',{method:'POST',headers:{origin,'content-type':'application/json','x-real-ip':'test'},body:JSON.stringify(body)});
 assert.equal((await r.POST(req('https://evil.test',{text:'hi'}))).status,403);
 assert.equal((await r.POST(req('',{text:'hi'}))).status,403);
 assert.equal((await r.POST(req('https://avtocena.com',{text:'hi'}))).status,200);
 assert.equal((await r.POST(req('https://avtocena.com',{text:'a'.repeat(40001)}))).status,503);
 assert.deepEqual(await (await r.GET()).json(),{connected:false});
});
test('provider records actual tokens and rejects truncated answers; key never enters payload',async()=>{
 const state={files:new Map()},c=await load('apps/web/lib/autobot/config.ts',state);
 await c.saveAutobotConfig({enabled:true,endpoint:'https://ai.reg.ru/v1/chat/completions',model:'fixture',token:'PRIVATE-KEY',inputRate:30,outputRate:90,monthlyLimit:3});
 const p=await load('apps/web/lib/autobot/provider.ts',state),old=globalThis.fetch;
 try{globalThis.fetch=async(url,init)=>{assert.equal(init?.redirect,'error');assert.equal((init?.headers as any).Authorization,'Bearer PRIVATE-KEY');assert.ok(!String(init?.body).includes('PRIVATE-KEY'));return Response.json({usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:'Ответ'}}]});};
 assert.equal((await p.regReply([{role:'user',content:'Машины'}],AbortSignal.timeout(1000))).text,'Ответ');
 const b=await load('apps/web/lib/autobot/budget.ts',state);assert.ok(Math.abs((await b.budgetStatus()).spent-.0048)<1e-9);
 globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'Оборвано'}}]});await assert.rejects(p.regReply([{role:'user',content:'Машины'}],AbortSignal.timeout(1000)),/не завершён/);
 }finally{globalThis.fetch=old;}
});

test('research discovers the model and manufacturer sources without leaking visitor context',async()=>{
 const r=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 assert.equal(r.manufacturerLink('https://www.hyundai.com/spec','Hyundai'),true);
 for(const u of ['http://hyundai.com/spec','https://hyundai.com.evil.test/spec','https://user:secret@hyundai.com/spec','https://hyundai.com/spec?token=secret','https://127.0.0.1/'])assert.equal(r.manufacturerLink(u,'Hyundai'),false);
 const seen:string[]=[];
 const read=async(url:string)=>{seen.push(url);if(url.includes('generator=search'))return {url,html:JSON.stringify({query:{pages:{1:{pageid:1,title:'Hyundai Nexo'}}}})};if(url.includes('action=parse'))return {url,html:JSON.stringify({parse:{text:{'*':'<h2>First generation 2018–2024</h2><table><tr><td>Power</td><td>120 kW</td></tr></table>'},externallinks:['https://hyundai.com/spec','https://hyundai.com.evil.test/spec']}})};return {url,html:'<title>Nexo specifications</title><p>Hyundai Nexo 120 kW</p>'};};
 const data=await r.researchVehicle({make:'Hyundai',model:'Nexo',year:2022,market:'korea',trim:'Premium',vin:'PRIVATE-VIN'},AbortSignal.timeout(1000),read);
 assert.equal(data.status,'found');assert.equal(data.pages.length,2);assert.equal(data.pages[0].kind,'reference');assert.equal(data.pages[1].kind,'manufacturer');assert.ok(data.pages[1].text.includes('120 kW'));assert.ok(!seen.join(' ').includes('PRIVATE-VIN'));assert.ok(!seen.some(u=>u.includes('evil.test')));
 assert.equal(r.researchNeeded('Какая у этого авто мощность?',{make:'Hyundai'}),true);assert.equal(r.researchNeeded('Привет',{make:'Hyundai'}),false);
 const failed=await r.researchVehicle({make:'Hyundai',model:'Nexo'},AbortSignal.timeout(1000),async()=>{throw Error('offline')});assert.equal(failed.status,'not_found');assert.deepEqual(failed.pages,[]);
});

test('vehicle specification question receives research before the very first model answer',async()=>{
 const state:any={files:new Map(),researchCalls:0};
 const a=await load('apps/web/lib/autobot/agent.ts',state,{
 calculation:`export const normalizeCalculationArgs=x=>x;export const calculateForChat=async()=>{throw Error('calculation not requested')};export const calculationReply=()=>'';`,
 route:`export async function GET(){throw Error('catalog must not run')}`,
 storage:`export const getOffer=async()=>({id:'nexo-2022',make:'Hyundai',model:'Nexo source generation',year:2022,market:'korea',trim:'Premium'});`,
 'offer-url':`export const offerRouteId=()=> 'nexo-2022';export const offerPath=()=>'/cars/offer/nexo-2022';`,
 'live-business-pricing':`export const applyActiveBusinessPricingBatch=async x=>x;`,
 'safe-public-pricing':`export const safePublicPricing=x=>x;`,
 'vehicle-knowledge':`export const findVehicleModel=async()=>null;export const findVehicleVariant=async()=>null;`,
 'power-reference':`export const findCertifiedPowerReference=async()=>null;`,
 'display-identity':`export const applyEncyclopediaDisplayIdentity=async x=>({...x,model:'Nexo'});`,
 research:`export const researchTopic=()=> 'specifications';export const researchNeeded=(q,c)=>!!c;export const researchVehicle=async identity=>{if(identity.model!=='Nexo')throw Error('source generation leaked into search');globalThis.__ab.researchCalls++;return {pages:[{title:'Manufacturer specification',url:'https://hyundai.com/spec',kind:'manufacturer',text:'Nexo motor maximum 120 kW; not certified 30-minute power'}]}};`
 });
 const answer=await a.runPublicAutobot({text:'Какая у этого авто мощность?',path:'/cars/offer/nexo-2022'},new Request('https://avtocena.com/api/autobot'),async(input:any[])=>{assert.ok(input.some(m=>m.content.includes('motor maximum 120 kW')));assert.ok(input[0].content.includes('Ответь на исходный вопрос сейчас'));assert.equal(input[0].role,'system');assert.ok(input.slice(1).every(m=>m.role!=='system'));assert.equal(input.at(-1).role,'user');return {text:JSON.stringify({reply:'Пиковая мощность 120 кВт. 30-минутная не подтверждена.'}),sources:[]}});
 assert.equal(state.researchCalls,1);assert.equal(answer.sources[0].url,'https://hyundai.com/spec');assert.match(answer.text,/120/);assert.equal(answer.cards.length,0);
 const fallback=await a.runPublicAutobot({text:'Найди в интернете мощность',path:'/cars/offer/nexo-2022'},new Request('https://avtocena.com/api/autobot'),async()=>{throw Error('Ответ не завершён.');});
 assert.match(fallback.text,/120 kW/);assert.match(fallback.text,/не подтверждено/);assert.equal(fallback.sources[0].url,'https://hyundai.com/spec');
 const thirty=a.researchFallbackReply([{web:{pages:[{title:'Spec',url:'https://hyundai.com/spec',kind:'manufacturer',text:'Peak power 120 kW.'}]}}],'30-минутная мощность');assert.doesNotMatch(thirty,/120/);assert.match(thirty,/пиковая её не заменяет/);
 const empty=a.researchFallbackReply([{web:{pages:[],webSearch:{links:[{title:'Google',url:'https://www.google.com/search?q=Nexo'}]}}}],'Найди мощность');assert.match(empty,/получить читаемые материалы не удалось/);assert.match(empty,/google.com/);

});


test('tab session retains conversation/draft on reload; invalid state is discarded',async()=>{
 const s=await import('../apps/web/lib/autobot/session');
 const raw=s.serializeChatSession([{role:'user',text:'Мой город Омск'},{role:'assistant',text:'Учитываю Омск.'}],'Посчитай',true);
 const restored=s.parseChatSession(raw);assert.equal(restored.messages[0].text,'Мой город Омск');assert.equal(restored.draft,'Посчитай');assert.equal(restored.opened,true);
 assert.deepEqual(s.parseChatSession(null).messages,[]);assert.deepEqual(s.parseChatSession('{bad').messages,[]);
 assert.equal(s.parseChatSession(s.serializeChatSession([], '', false)).messages.length,0);
});
test('service orientation includes actual registration and contact opens a form, not a false transfer',async()=>{
 const s=await import('../apps/web/lib/autobot/service');
 for(const q of ['где я?','гдлея','гделя','что это за сервис']){
 const r=s.serviceAnswer(q);assert.ok(r,q);assert.match(r.text,/АвтоЦен/);assert.match(r.text,/\/login\?role=customer/);
 }
 const r=s.serviceAnswer('соедини меня со сотрудником');assert.deepEqual(r.actions,['contact']);assert.match(r.text,/отправьте заявку/);assert.doesNotMatch(r.text,/рабочий чат|уже соединил/);
});
test('web research reads discovered PDF and keeps 30-minute evidence distinct from peak power',async()=>{
 const r=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 const urls:string[]=[];const read=async(url:string,signal:any,redirects:any,format:string)=>{urls.push(url);if(format==='xml')return {url,html:'<rss><item><title>Type approval</title><link>https://manufacturer.example/certificate.pdf</link><description>certificate</description></item></rss>'};assert.equal(format,'document');return {url,html:'Model Fixture 2025. Peak power 120 kW. Maximum 30-minute power 45 kW. UNECE R85.'};};
 const result=await r.discoverVehicleWeb({make:'Test',model:'Fixture',year:2025,topic:'30-minute'},AbortSignal.timeout(1000),read);
 assert.equal(result.pages.length,1);assert.equal(result.pages[0].kind,'document');assert.match(result.pages[0].text,/30-minute power 45/);assert.ok(urls.some(x=>decodeURIComponent(x).includes('ОТТС')));
 assert.deepEqual(r.webResults('<item><link>http://127.0.0.1/</link></item>'),[]);
});
test('chat calculation uses the production engine and keeps missing power missing',async()=>{
 const state:any={files:new Map(),seen:null};
 const c=await load('apps/web/lib/autobot/calculation.ts',state,{
 'offer-page-data':`export const getOfferForPage=async()=>({id:'car',make:'Toyota',year:2023,deliveryCity:'Омск'});`,
 storage:`export const getOffer=async()=>null;`,
 'offer-parameter-draft':`export const offerParameterDraft=()=>({year:'2023',fuel:'petrol',engineCc:'1998',powerHp:'150'});`,
 'customer-parameters':`export const validateCustomerParameters=x=>x;`,
 'customs-pricing':`export const calculateOfferWithCustomerParametersDetailed=async(o,p)=>{globalThis.__ab.seen=p;return {ok:true,calculation:{totalRub:2345678}}};`,
 scenario:`export const autocalcScenario=()=>{throw Error('manual not requested')}`
 });
 for(const fuel of ['бензин','gasoline','petrol'])assert.equal(c.normalizeCalculationArgs({draft:{fuel}}).draft.fuel,'petrol');assert.equal(c.normalizeCalculationArgs({draft:{fuel:'газ'}}).draft.fuel,'газ');
 const r=await c.calculateForChat({id:'car',city:'Красноярск',draft:{powerHp:'160',unknown:'ignored'}});
 assert.equal(r.calculation.totalRub,2345678);assert.match(c.calculationReply(r).replace(/\s/g,''),/2345678/);assert.equal(c.calculationReply({ok:false,error:'Нужна мощность'}),'Нужна мощность');assert.equal(state.seen.deliveryCity,'Красноярск');assert.equal(state.seen.powerHp,'160');assert.equal(state.seen.unknown,undefined);assert.equal(state.seen.power30MinKw,undefined);
});

test('successful calculator result is returned without another model generation',async()=>{
 const a=await load('apps/web/lib/autobot/agent.ts',{files:new Map()},{
 route:`export const GET=async()=>{throw Error('not used')};`,
 storage:`export const getOffer=async()=>null;`,
 'offer-url':`export const offerRouteId=x=>x;export const offerPath=x=>'/cars/offer/'+x.id;`,
 'live-business-pricing':`export const applyActiveBusinessPricingBatch=async x=>x;`,
 'safe-public-pricing':`export const safePublicPricing=x=>x;`,
 'vehicle-knowledge':`export const findVehicleModel=async()=>null;export const findVehicleVariant=async()=>null;`,
 'power-reference':`export const findCertifiedPowerReference=async()=>null;`,
 research:`export const researchTopic=()=> 'specifications';export const researchNeeded=()=>false;export const researchVehicle=async()=>({pages:[]});`,
 calculation:`export const normalizeCalculationArgs=x=>x;export const calculateForChat=async()=>({ok:true,calculation:{totalRub:2413948}});export const calculationReply=r=>'Итого '+r.calculation.totalRub+' ₽';`
 });
 let calls=0;const result=await a.runPublicAutobot({text:'Посчитай по моим параметрам',path:'/autocalc'},new Request('https://avtocena.com/api/autobot'),async()=>{calls++;return {text:JSON.stringify({tool:'calculate',args:{title:'Toyota Corolla'}}),sources:[]};});
 assert.equal(calls,1);assert.match(result.text,/2413948/);
});

test('Google request parses real result links and reads pages instead of reusing an empty search',async()=>{
 const r=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 const links=r.googleResults('<a href="/url?q=https%3A%2F%2Fwww.audi.co.kr%2Fa5&amp;sa=U"><h3>Audi A5 specifications</h3></a><a href="https://www.google.com/help"><h3>Help</h3></a>');
 assert.equal(links.length,1);assert.equal(links[0].url,'https://www.audi.co.kr/a5');
 const requests:string[]=[];
 const result=await r.discoverVehicleWeb({make:'Audi',model:'A5',year:2023,trim:'45 TFSI quattro Premium Coupe',engine:'google'},AbortSignal.timeout(1000),async(url:string)=>{
  requests.push(url);return {url,html:url.includes('google.com/search')?'<a href="https://www.audi.co.kr/a5"><h3>Audi A5</h3></a>':'Audi A5 Coupe 45 TFSI quattro. Model year 2023. Maximum power 195 kW.'};
 });
 assert.ok(requests.some(url=>url.includes('google.com/search')));assert.equal(result.pages.length,1);assert.equal(result.pages[0].kind,'manufacturer');assert.match(result.pages[0].text,/195 kW/);
 assert.ok(r.researchQueries({make:'Audi',model:'A5',year:2023,trim:'45 TFSI quattro Premium Coupe'})[1].includes('"Audi A5" 2023 характеристики'));
});
test('research prioritizes technical manufacturer PDFs and rejects brand-only results',async()=>{
 const r=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 const pdf='https://uploads.audi-mediacenter.com/technical-A5-2023.pdf?download=1';
 assert.equal(r.manufacturerDocument(pdf,'Audi'),true);assert.equal(r.manufacturerDocument('https://audi.com.evil.test/A5.pdf','Audi'),false);
 assert.equal(r.mentionsModel('Audi A50','A5'),false);assert.equal(r.mentionsModel('Audi A5 F5','A5'),true);
 const formats:string[]=[];
 const read=async(url:string,_signal:any,_redirects:any,format:string)=>{
  if(format==='xml')return {url,html:'<rss><item><title>Audi homepage</title><link>https://www.audi.com/</link></item></rss>'};
  if(url.includes('action=query'))return {url,html:JSON.stringify({query:{pages:{1:{pageid:1,title:'Audi A5'}}}})};
  if(url.includes('action=parse'))return {url,html:JSON.stringify({parse:{text:{'*':'Audi A5 history'},externallinks:[pdf]}})};
  if(url===pdf){formats.push(format);return {url,html:'Audi A5 Coupe 2023. Engine power 195 kW.'};}
  return {url,html:'<p>Audi A5 available models</p><p>Welcome to Audi</p>'};
 };
 const result=await r.researchVehicle({make:'Audi',model:'A5',year:2023,trim:'Coupe'},AbortSignal.timeout(1000),read);
 assert.deepEqual(formats,['document']);assert.ok(result.pages.some((p:any)=>p.url===pdf&&p.kind==='document'));assert.ok(!result.pages.some((p:any)=>p.url==='https://www.audi.com/'));
 assert.match(r.researchQueries({make:'Audi',model:'A5',year:2023,market:'korea'})[0],/^"Audi A5" 2023 Korea/);
});
test('official model catalog reaches an archived body and its matching technical PDF within five reads',async()=>{
 const r=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 const seen:string[]=[];const root='https://www.audi.com/en/',pdf='https://uploads.audi.com/A5-Coupe-45-TFSI-quattro-2024.pdf';
 const html:Record<string,string>={
  [root+'models-4']:'<a href="/en/A5-current">A5</a>',
  [root+'previous-models-78']:'<a href="/en/A5-until-2024">A5 until 2024</a><a href="https://evil.test/A5">A5 Coupe 45 TFSI</a>',
  [root+'A5-until-2024']:'<title>Audi A5 until 2024</title><a href="/en/A5-Sportback-until-2024">A5 Sportback</a><a href="/en/A5-Coupe-until-2024">A5 Coupe</a>',
  [root+'A5-Coupe-until-2024']:'<title>Audi A5 Coupe</title><a href="https://uploads.audi.com/A5-Coupe-35-TDI.pdf">Download</a><a href="'+pdf+'">Download</a>',
  [pdf]:'Audi A5 Coupe 45 TFSI quattro. Program for Germany 2024. Max. power output 195 kW (265 PS).'
 };
 const read=async(url:string,_signal:any,_redirects:any,format:string)=>{seen.push(url);assert.ok(html[url],url);if(url===pdf)assert.equal(format,'document');return {url,html:html[url]};};
 const result=await r.discoverManufacturerCatalog({make:'Audi',model:'A5',year:2023,trim:'Coupe 45 TFSI quattro Premium'},AbortSignal.timeout(1000),read);
 assert.equal(seen.length,5);assert.equal(result.pages[0].url,pdf);assert.match(result.pages[0].text,/195 kW/);assert.ok(!seen.some(u=>u.includes('evil.test')||u.includes('35-TDI')||u.includes('Sportback')));
 const other=await r.discoverManufacturerCatalog({make:'Toyota',model:'Corolla'},AbortSignal.timeout(1000),read);assert.equal(other.pages.length,0);assert.equal(seen.length,5);
});
test('power evidence selects the requested engine row and never treats consumption as power',async()=>{
 const research=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 const text='Audi A5 Coupe until 2024\n35 TDI S tronic (120 kW) MHEV\n'+('Other text. '.repeat(300))+'\n45 TFSI quattro S tronic (195 kW) MHEV';
 const focused=research.variantEvidence(text,'Coupe 45 TFSI quattro Premium');assert.match(focused.slice(0,100),/45 TFSI.*195 kW/);
 const a=await import('../apps/web/lib/autobot/research-answer');
 const evidence=(text:string)=>[{web:{pages:[{title:'Audi A5 Coupe until 2024',url:'https://www.audi.com/en/spec',kind:'manufacturer',text}]}}];
 assert.match(a.researchPowerReply(evidence(focused),'Найди мощность 45 TFSI'),/195 кВт.*265 л.с./);
 assert.equal(a.researchPowerReply(evidence('35 TDI 120 kW'),'Мощность 45 TFSI'),null);
 const thirdParty=evidence('45 TFSI 195 kW');thirdParty[0].web.pages[0].kind='document';assert.doesNotMatch(a.researchPowerReply(thirdParty,'Мощность 45 TFSI'),/официальн/);assert.match(a.researchPowerReply(thirdParty,'Мощность 45 TFSI'),/прочитанном документе/);
 assert.equal(a.researchPowerReply(evidence('45 TFSI consumption 15.7 kWh/100 km'),'Мощность 45 TFSI'),null);
 assert.equal(a.researchPowerReply(evidence('45 TFSI 195 kW'),'30 минутная мощность 45 TFSI'),null);
 assert.equal(a.researchPowerReply(evidence('45 TFSI 195 kW'),'Рассчитай 45 TFSI, мощность 195 кВт'),null);
 assert.equal(a.researchPowerReply(evidence('45 TFSI 195 kW'),'Сравни мощность 45 TFSI и 40 TFSI'),null);
 assert.match(a.researchPowerReply(evidence(research.variantEvidence('45 TFSI\nquattro S tronic\n195 kW','45 TFSI')),'Найди мощность 45 TFSI'),/195 кВт/);
 assert.doesNotMatch(a.researchFallbackReply(evidence('35 TDI 120 kW\n45 TFSI 195 kW'),'Мощность 45 TFSI'),/120/);
});

test('native search uses shared monthly budget and validated source citations',async()=>{
 const state={files:new Map()},c=await load('apps/web/lib/autobot/config.ts',state);
 await c.saveAutobotConfig({enabled:true,endpoint:'https://ai.reg.cloud/v1/chat/completions',model:'gpt-6-luna',token:'PRIVATE-KEY',inputRate:36,outputRate:180,monthlyLimit:3000});
 const p=await load('apps/web/lib/autobot/provider.ts',state),old=globalThis.fetch;
 try{
 globalThis.fetch=async(url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.model,'sonar');assert.ok(!String(init?.body).includes('PRIVATE-KEY'));return Response.json({usage:{prompt_tokens:100,completion_tokens:20},citations:['https://www.honda.co.jp/spec/','javascript:alert(1)'],search_results:[{title:'Honda',url:'https://www.honda.co.jp/spec/'}],choices:[{finish_reason:'stop',message:{content:'Справочное значение [1].'}}]});};
 const result=await p.regSearch([{role:'user',content:'Honda specifications'}],AbortSignal.timeout(1000));
 assert.equal(result.text,'Справочное значение [1](https://www.honda.co.jp/spec/).');assert.deepEqual(result.sources,[{title:'Honda',url:'https://www.honda.co.jp/spec/'}]);
 const b=await load('apps/web/lib/autobot/budget.ts',state);assert.ok(Math.abs((await b.budgetStatus()).spent-10.0264816)<1e-7);
 await c.saveAutobotConfig({...(await c.readAutobotConfig()),monthlyLimit:3});
 await assert.rejects(p.regSearch([{role:'user',content:'Honda'}],AbortSignal.timeout(1000)));
 }finally{globalThis.fetch=old;}
});

test('native search evidence counts as found even when direct page reading fails',async()=>{
 const state:any={files:new Map(),query:''};
 const r=await load('apps/web/lib/autobot/research.ts',state,{
 source:`export async function readSource(){throw Error('offline')}`,
 provider:`export async function regSearch(input){globalThis.__ab.query=JSON.stringify(input);return {text:'Справочные характеристики Honda.',sources:[{title:'Honda',url:'https://www.honda.co.jp/spec/'}]};}`,
 });
 const result=await r.researchVehicle({make:'Honda',model:'Step Wagon',year:2015,vin:'PRIVATE-VIN'},AbortSignal.timeout(1000));
 assert.equal(result.status,'found');assert.deepEqual(result.pages,[]);assert.equal(result.searchEvidence.sources.length,1);assert.ok(!state.query.includes('PRIVATE-VIN'));
});

test('search URLs in message text are read before becoming source evidence',async()=>{
 const state:any={files:new Map()};
 const r=await load('apps/web/lib/autobot/research.ts',state,{
 source:`export async function readSource(url){if(url==='https://www.honda.co.jp/spec/')return {url,html:'<title>Honda StepWGN</title><p>Honda StepWGN 2015 150 PS petrol</p>'};throw Error('offline')}`,
 provider:`export async function regSearch(){return {text:'Honda [spec](https://www.honda.co.jp/spec/)',sources:[],linkCandidates:[{title:'Honda',url:'https://www.honda.co.jp/spec/'},{title:'Unrelated',url:'https://example.com/'}]};}`,
 });
 const result=await r.researchVehicle({make:'Honda',model:'Step Wagon',year:2015},AbortSignal.timeout(1000));
 assert.equal(result.status,'found');assert.equal(result.searchEvidence.sources.length,1);assert.equal(result.pages[0].url,'https://www.honda.co.jp/spec/');
});

test('chat form preserves known values, rubles, and edits across tab restoration',async()=>{
 const {calculationFormSeed}=await import('../apps/web/lib/autocalc/form-state');
 const {parseChatSession,serializeChatSession}=await import('../apps/web/lib/autobot/session');
 const seed=calculationFormSeed({make:'Honda',model:'Fit',market:'japan',currency:'RUB',price:1000,city:'Кемерово',draft:{year:2023,powerHp:110,secret:'private'},url:'javascript:alert(1)',token:'private'});
 assert.equal(seed.price,'1000');assert.equal(seed.currency,'RUB');assert.equal(seed.url,undefined);assert.equal(seed.draft?.secret,undefined);
 const restored=parseChatSession(serializeChatSession([{role:'assistant',text:'Форма',calculationForm:seed}],'',true));
 assert.deepEqual(restored.messages[0].calculationForm,seed);
});

test('a requested chat calculation form is structured and keeps history values',async()=>{
 const a=await load('apps/web/lib/autobot/agent.ts',{files:new Map()},{
 route:`export const GET=async()=>{throw Error('not used')};`,storage:`export const getOffer=async()=>({id:'current',make:'Volkswagen',model:'Golf',year:2025,powerHp:200,sourceCurrency:'EUR',sourcePrice:30000,market:'europe'});`,
 'offer-url':`export const offerRouteId=x=>x;export const offerPath=x=>'/cars/offer/'+x.id;`,
 'live-business-pricing':`export const applyActiveBusinessPricingBatch=async x=>x;`,'safe-public-pricing':`export const safePublicPricing=x=>x;`,
 'vehicle-knowledge':`export const findVehicleModel=async()=>null;export const findVehicleVariant=async()=>null;`,'power-reference':`export const findCertifiedPowerReference=async()=>null;`,
 research:`export const researchTopic=()=> 'specifications';export const researchNeeded=()=>false;export const researchVehicle=async()=>({pages:[]});`,
 calculation:`export const normalizeCalculationArgs=x=>x;export const calculateForChat=async()=>({ok:false});export const calculationReply=()=>'';`
 });
 const data={make:'Honda',model:'Fit',market:'japan',city:'Кемерово',currency:'RUB',price:1000,draft:{year:2023}};
 for(const tool of ['calculation_form','calculate']){
  const result=await a.runPublicAutobot({text:'Дай форму расчёта',history:[{role:'user',text:'Honda Fit 2023, Япония, 1000 рублей, Кемерово'}],path:'/cars/offer/current'},new Request('https://avtocena.com/api/autobot'),async(input:any[])=>{assert.ok(input.some(m=>m.content.includes('1000 рублей')));return {text:JSON.stringify({tool,args:data}),sources:[]};});
  assert.equal(result.calculationForm?.make,'Honda');assert.equal(result.calculationForm?.currency,'RUB');assert.equal(result.calculationForm?.price,'1000');assert.equal(result.calculationForm?.draft?.year,'2023');assert.equal(result.calculationForm?.draft?.powerHp,undefined);
 }
});

test('fuel economy and other missing parameters trigger topic-specific research',async()=>{
 const r=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 for(const question of ['Какой расход топлива у этого автомобиля?','А сколько он потребляет?','Какой клиренс?','Объём багажника','Разгон до 100?'])assert.equal(r.researchNeeded(question,{make:'Toyota',model:'Yaris'}),true,question);
 assert.equal(r.researchNeeded('Какой расход?',null),false);
 assert.equal(r.researchNeeded('Из чего складывается цена?',{make:'Toyota'}),false);
 assert.equal(r.researchTopic('Какая 30-минутная мощность?'),'30-minute');
 const queries=r.researchQueries({make:'Toyota',model:'Yaris',year:2024,market:'japan',trim:'G AWD 4WD',topic:r.researchTopic('Какой расход топлива?')});
 assert.ok(queries.every(q=>q.includes('G AWD 4WD')&&q.includes('2024')));
 assert.match(queries.join(' '),/WLTC/);
 const text='Toyota Yaris catalog\n'+'Introduction '.repeat(400)+'\nG AWD 4WD fuel consumption WLTC 19.2 km/L\nConditions vary.';
 assert.match(r.evidenceExcerpt(text).slice(0,1800),/19.2 km\/L/);
});

test('paid discovery is reserved for missing topic evidence, not every read specification',async()=>{
 const r=await load('apps/web/lib/autobot/research.ts',{files:new Map()},{source:`export async function readSource(){throw Error('not injected')}`});
 const page=(text:string,kind='manufacturer')=>[{kind,text}];
 assert.equal(r.hasUsefulReadEvidence('consumption',page('Yaris WLTC 19.2 km/L')),true);
 assert.equal(r.hasUsefulReadEvidence('consumption',page('Yaris maximum power 88 kW')),false);
 assert.equal(r.hasUsefulReadEvidence('consumption',page('Yaris WLTC 19.2 km/L','reference')),false);
 assert.equal(r.hasUsefulReadEvidence('30-minute',page('Peak power 120 kW')),false);
 assert.equal(r.hasUsefulReadEvidence('30-minute',page('30-minute power 45 kW')),true);
});

test('automatic electrified research asks only for missing source specifications',async()=>{
 const {missingElectrifiedSpecifications,automaticResearchQuestion}=await import('../apps/web/lib/autobot/missing-specifications');
 assert.deepEqual(missingElectrifiedSpecifications({fuel:'petrol'}),[]);
 assert.deepEqual(missingElectrifiedSpecifications({fuel:'electric',power30MinKw:80}),[]);
 assert.equal(missingElectrifiedSpecifications({fuel:'electric',powerKw:300}).length,1);
 assert.deepEqual(missingElectrifiedSpecifications({fuel:'electric',power30MinKwByMotor:[40,60]}),[]);
 const gaps=missingElectrifiedSpecifications({fuel:'hybrid',engineCc:1498,icePowerKw:100});
 assert.equal(gaps.length,1);assert.match(automaticResearchQuestion(gaps),/30-минутная мощность/);
});
