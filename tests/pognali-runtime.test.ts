import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Execute the shipped engine with a small DOM/canvas double, including real
// animation steps and input/bridge events. No backend or production score writes.
function harness(){
 const html=fs.readFileSync('apps/web/public/games/pognali.html','utf8');
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 const events:Record<string,Function[]>={},docEvents:Record<string,Function[]>={},elements=new Map<string,any>(),messages:any[]=[];
 let callback:Function|undefined;
 const context=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:20})},{get:(target:any,key)=>key in target?target[key]:()=>{},set:(target,key,value)=>(target[key]=value,true)});
 function element(key:string):any{if(/^#[\w-]+$/.test(key)&&!ids.has(key.slice(1)))return null;if(elements.has(key))return elements.get(key);const classes=new Set<string>();if(key.startsWith('#')){const tag=html.match(new RegExp('<[^>]*id="'+key.slice(1)+'"[^>]*>'))?.[0]||'';for(const c of tag.match(/class="([^"]*)"/)?.[1]?.split(' ')||[])classes.add(c);}const listeners:Record<string,Function[]>={};const el:any={style:{},dataset:{},value:'',checked:false,hidden:false,clientWidth:1000,clientHeight:720,classList:{add:(c:string)=>classes.add(c),remove:(c:string)=>classes.delete(c),contains:(c:string)=>classes.has(c),toggle:(c:string,on:boolean)=>on?classes.add(c):classes.delete(c)},getContext:()=>context,addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn),fire:(type:string,event:any={})=>{for(const fn of listeners[type]||[])fn({preventDefault(){},stopPropagation(){},target:el,...event});el['on'+type]?.(event);},setPointerCapture(){},querySelector:(s:string)=>element(key+' '+s),closest:()=>element('.panel'),appendChild(){},matches:()=>false,focus(){}};elements.set(key,el);return el;}
 const modeElements=['solo','battle'].map(mode=>{const el=element('[mode='+mode+']');el.dataset.mode=mode;return el;});
 const document={hidden:false,body:element('body'),querySelector:element,querySelectorAll:(selector:string)=>selector==='[data-mode]'?modeElements:[],addEventListener:(type:string,fn:Function)=>(docEvents[type]??=[]).push(fn),createElement:()=>element('new')};
 const parent={postMessage:(message:any)=>messages.push(message)};
 const window={parent,devicePixelRatio:1,addEventListener:(type:string,fn:Function)=>(events[type]??=[]).push(fn),focus(){}};
 const sandbox={document,window,parent,console,Math,Date,Path2D:class {constructor(){return context;}},setTimeout:()=>0,clearTimeout(){},requestAnimationFrame:(fn:Function)=>(callback=fn,1),cancelAnimationFrame:()=>{callback=undefined;}};
 vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1].replace('/* ---------- INIT ---------- */','window.testEngine={state,terrainY,stepCarPhysics,step,tryJump,CARS,damageCar,stepFlying,reviveCar,generateTrackFeatures};'),sandbox,{timeout:2000});
 const bridge=(data:any)=>events.message.forEach(fn=>fn({source:parent,data:{game:'pognali-v1',...data}}));
 bridge({type:'user',user:{name:'<test>'}});
 return {element,messages,modeElements,bridge,events,engine:(window as any).testEngine,advance(seconds:number){for(let i=0;i<seconds*60;i++){const next=callback;callback=undefined;next?.(1000+i*1000/60);}},pending:()=>Boolean(callback)};
}
for(const mode of ['solo','battle'])test(`shipped engine runs, pauses and reports ${mode}`,()=>{
 const h=harness();assert.equal(h.messages[0].type,'ready');assert.equal(h.pending(),false);
 h.modeElements.find(el=>el.dataset.mode===mode)!.fire('click');h.element('#btnStart').fire('click');assert.equal(h.messages.at(-1).type,'start');
 h.bridge({type:'started',id:'test'});h.element('#btnGas').fire('pointerdown',{pointerId:1});h.advance(3);
 h.element('#btnPause').fire('click');assert.equal(h.pending(),false);h.element('#btnResume').fire('click');assert.equal(h.pending(),true);
 h.element('#btnQuit').fire('click');h.advance(1);
 const result=h.messages.find(m=>m.type==='finish');assert.ok(result);assert.ok(result.duration>1);assert.ok(result.distance>0);assert.equal(h.pending(),false);
 assert.equal(h.element('#scrResult').classList.contains('hidden'),false);
 assert.ok(h.element('#rTime').textContent);
 assert.equal(h.element('#btnAgain').disabled,true);h.bridge({type:'saved',score:100});assert.equal(h.element('#btnAgain').disabled,false);
 h.element('#btnAgain').fire('click');assert.equal(h.messages.at(-1).type,'start');h.bridge({type:'started',id:'restart'});assert.equal(h.element('#scrResult').classList.contains('hidden'),true);
 h.element('#btnQuit').fire('click');h.element('#btnExit').fire('click');assert.equal(h.messages.at(-1).type,'exit');
 h.element('#btnMenu').fire('click');assert.equal(h.pending(),false);
});

for (let car=0;car<5;car++) test(`car ${car}: roof contact survives and a jump rights it without an aerial double jump`,()=>{
 const h=harness();h.element('#btnStart').fire('click');h.bridge({type:'started',id:'flip-run'});
 const {state,terrainY,stepCarPhysics,tryJump}=h.engine,p=state.player;
 Object.assign(p,{cfg:h.engine.CARS[car],angle:Math.PI,x:200,y:terrainY(200),vx:0,vy:0,angularVelocity:0,hp:120,jumpCd:0});
 for(let i=0;i<240;i++)stepCarPhysics(p,false,false,1/120);
 assert.equal(p.alive,true);assert.equal(p.chassisGrounded,true);
 assert.equal(tryJump(p),true);assert.ok(p.vy<0);assert.ok(p.angularVelocity<0);
 assert.equal(tryJump(p),false);
 let upright=false;
 for(let i=0;i<240;i++){
  stepCarPhysics(p,false,false,1/120);
  if(Math.abs(Math.atan2(Math.sin(p.angle),Math.cos(p.angle)))<0.6&&p.onGround)upright=true;
 }
 assert.equal(upright,true);assert.equal(p.alive,true);
 assert.equal(h.messages.filter(m=>m.type==='finish').length,0);
});
test('holding a pedal remains active when a thumb drifts outside until released',()=>{
 const h=harness(),gas=h.element('#btnGas');gas.fire('pointerdown',{pointerId:1});
 gas.fire('pointerleave',{pointerId:1});assert.equal(h.engine.state.keys.gas,true);
 gas.fire('pointerup',{pointerId:1});assert.equal(h.engine.state.keys.gas,false);
 gas.fire('pointerdown',{pointerId:2});gas.fire('pointercancel',{pointerId:2});assert.equal(h.engine.state.keys.gas,false);
});

test('every race mode generates a track without spikes',()=>{
 for(const mode of ['solo','battle']){
  const h=harness();h.modeElements.find(el=>el.dataset.mode===mode)!.fire('click');h.element('#btnStart').fire('click');h.bridge({type:'started',id:mode});
  if(mode==='solo')assert.ok(h.engine.state.obstacles.length>0);
  assert.ok(h.engine.state.obstacles.every((o:any)=>['rock','pit','crate'].includes(o.type)));
 }
});

test('decorative birds, UFO beams and rocks never consume lives; fuel can be collected',()=>{
 const h=harness();h.element('#btnStart').fire('click');h.bridge({type:'started',id:'hazards'});
 const {state,step,terrainY}=h.engine,p=state.player;
 p.x=200;p.y=terrainY(200)-30;p.fuel=30;
 state.flying=[{type:'bird',alive:true,x:p.x,y:p.y,baseY:p.y,vx:0,ph:0},{type:'ufo',alive:true,x:p.x,y:p.y-200,baseY:p.y-200,vx:0,ph:0,beam:true,beamTimer:5}];
 state.obstacles=[{type:'rock',x:p.x,w:50,taken:false}];state.fuel=[{x:p.x,y:p.y,taken:false}];
 step(1/120);assert.equal(p.lives,3);assert.equal(p.hp,p.maxHp);assert.equal(p.slowTimer,0);assert.ok(p.fuel>80);
 p.fuel=0;p.vx=0;state.time=3;step(1/120);assert.equal(state.screen,'result');
});
test('battle has nearby rivals, hit explodes, revives in place, final life ends the run',()=>{
 const h=harness();h.modeElements.find(e=>e.dataset.mode==='battle')!.fire('click');h.element('#btnStart').fire('click');h.bridge({type:'started',id:'battle'});
 const {state,damageCar,step}=h.engine,p=state.player;assert.equal(state.bots.length,4);assert.ok(state.bots.some((b:any)=>Math.abs(b.x-p.x)<300));assert.notEqual(p.weapon,'none');
 state.coins=[];state.fuel=[];state.obstacles=[];p.x=1234;p.maxX=1234;p.coins=8;p.fuel=70;const before=p.x;
 damageCar(p,1,'bot',false);assert.equal(p.alive,false);assert.equal(p.lives,2);assert.ok(state.particles.length>0);
 for(let i=0;i<125;i++)step(1/120);assert.equal(p.alive,true);assert.ok(Math.abs(p.x-before)<2);assert.equal(p.coins,8);assert.ok(p.invuln>0);
 damageCar(p,999,'bot',false);assert.equal(p.lives,2);
 p.invuln=0;damageCar(p,1,'bot',false);for(let i=0;i<125;i++)step(1/120);assert.equal(p.lives,1);
 p.invuln=0;damageCar(p,1,'bot',false);for(let i=0;i<125;i++)step(1/120);assert.equal(state.screen,'result');
 h.bridge({type:'saved',score:100});h.element('#btnAgain').fire('click');h.bridge({type:'started',id:'fresh'});assert.equal(state.player.x,200);assert.equal(state.player.coins,0);assert.equal(state.player.lives,3);
});
test('track contains progressive hills, ramps and depressions and ring mode is removed',()=>{
 const h=harness(),features=h.engine.generateTrackFeatures();assert.deepEqual([...new Set(features.map((f:any)=>f.type))],['hill','dip','ramp']);assert.ok(features.at(-1).h>features[0].h);
 const html=fs.readFileSync('apps/web/public/games/pognali.html','utf8');assert.ok(!html.includes('data-mode="circuit"'));assert.ok(!html.includes('function stepRing'));
});
test('a released car levels its body promptly while airborne',()=>{
 const h=harness();h.element('#btnStart').fire('click');h.bridge({type:'started',id:'air'});
 const {state,terrainY,stepCarPhysics}=h.engine,p=state.player;Object.assign(p,{x:200,y:terrainY(200)-250,vy:-120,angle:1.2,angularVelocity:0,chassisGrounded:false});
 for(let i=0;i<60;i++)stepCarPhysics(p,false,false,1/120);
 assert.ok(Math.abs(p.angle)<.3,`angle=${p.angle}`);assert.equal(p.alive,true);
});

for(let car=0;car<5;car++)test(`car ${car}: continuous throttle drives forward without overturning`,()=>{
 const h=harness();h.element('#btnStart').fire('click');h.bridge({type:'started',id:'drive'});
 const {state,stepCarPhysics,CARS,terrainY}=h.engine,p=state.player;
 Object.assign(p,{cfg:CARS[car],x:200,y:terrainY(200)-CARS[car].wheelY-CARS[car].wheelR-2});
 let maxTilt=0;
 for(let i=0;i<120*15;i++){stepCarPhysics(p,true,false,1/120);maxTilt=Math.max(maxTilt,Math.abs(Math.atan2(Math.sin(p.angle),Math.cos(p.angle))));}
 assert.ok(p.x>3200,`forward distance ${p.x-200}`);assert.ok(maxTilt<1.4,`tilt ${maxTilt}`);assert.equal(p.alive,true);
});
test('finish completes stage once and next run starts the next stage',()=>{
 const h=harness();h.element('#btnStart').fire('click');h.bridge({type:'started',id:'stage1'});
 const {state,step}=h.engine;state.time=30;state.player.maxX=8201;state.player.x=8201;step(1/120);
 assert.equal(state.screen,'result');assert.match(h.element('#rTitle').textContent,/Этап 1 пройден/);
 assert.equal(h.messages.filter(m=>m.type==='finish').length,1);h.bridge({type:'saved',score:800});h.element('#btnAgain').fire('click');h.bridge({type:'started',id:'stage2'});
 state.time=30;state.player.maxX=8201;state.player.x=8201;step(1/120);assert.equal(state.screen,'play');
 state.player.maxX=10201;state.player.x=10201;step(1/120);assert.match(h.element('#rTitle').textContent,/Этап 2 пройден/);
});
