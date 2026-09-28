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
 const modeElements=['solo','circuit','battle'].map(mode=>{const el=element('[mode='+mode+']');el.dataset.mode=mode;return el;});
 const document={hidden:false,body:element('body'),querySelector:element,querySelectorAll:(selector:string)=>selector==='[data-mode]'?modeElements:[],addEventListener:(type:string,fn:Function)=>(docEvents[type]??=[]).push(fn),createElement:()=>element('new')};
 const parent={postMessage:(message:any)=>messages.push(message)};
 const window={parent,devicePixelRatio:1,addEventListener:(type:string,fn:Function)=>(events[type]??=[]).push(fn),focus(){}};
 const sandbox={document,window,parent,console,Math,Date,Path2D:class {constructor(){return context;}},setTimeout:()=>0,clearTimeout(){},requestAnimationFrame:(fn:Function)=>(callback=fn,1),cancelAnimationFrame:()=>{callback=undefined;}};
 vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1].replace('/* ---------- INIT ---------- */','window.testEngine={state,terrainY,stepCarPhysics,step};'),sandbox,{timeout:2000});
 const bridge=(data:any)=>events.message.forEach(fn=>fn({source:parent,data:{game:'pognali-v1',...data}}));
 bridge({type:'user',user:{name:'<test>'}});
 return {element,messages,modeElements,bridge,events,engine:(window as any).testEngine,advance(seconds:number){for(let i=0;i<seconds*60;i++){const next=callback;callback=undefined;next?.(1000+i*1000/60);}},pending:()=>Boolean(callback)};
}
for(const mode of ['solo','circuit','battle'])test(`shipped engine runs, pauses and reports ${mode}`,()=>{
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

test('overturned car on the ground ends visibly; a midair flip can recover',()=>{
 const h=harness();h.element('#btnStart').fire('click');h.bridge({type:'started',id:'flip-run'});h.advance(2);
 const {state,terrainY,stepCarPhysics,step}=h.engine,p=state.player;
 Object.assign(p,{angle:Math.PI,x:200,y:terrainY(200)-200,vx:0,vy:0,angularVelocity:0,flipTimer:0,hp:120});
 stepCarPhysics(p,false,false,0);assert.equal(p.alive,true);
 Object.assign(p,{y:terrainY(200),flipTimer:1.21});stepCarPhysics(p,false,false,0);step(1/120);
 assert.equal(p.deathReason,'flip');assert.equal(h.element('#rTitle').textContent,'Машина перевернулась');assert.equal(h.element('#scrResult').classList.contains('hidden'),false);
 assert.equal(h.messages.filter(m=>m.type==='finish').length,1);
});
