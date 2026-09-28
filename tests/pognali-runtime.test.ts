import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Execute the shipped engine with a small DOM/canvas double, including real
// animation steps and input/bridge events. No backend or production score writes.
function harness(){
 const html=fs.readFileSync('apps/web/public/games/pognali.html','utf8');
 const events:Record<string,Function[]>={},docEvents:Record<string,Function[]>={},elements=new Map<string,any>(),messages:any[]=[];
 let callback:Function|undefined;
 const context=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:20})},{get:(target:any,key)=>key in target?target[key]:()=>{},set:(target,key,value)=>(target[key]=value,true)});
 function element(key:string):any{if(elements.has(key))return elements.get(key);const listeners:Record<string,Function[]>={};const el:any={style:{},dataset:{},value:'',checked:false,hidden:false,clientWidth:1000,clientHeight:720,classList:{add(){},remove(){},toggle(){}},getContext:()=>context,addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn),fire:(type:string,event:any={})=>{for(const fn of listeners[type]||[])fn({preventDefault(){},stopPropagation(){},target:el,...event});el['on'+type]?.(event);},setPointerCapture(){},querySelector:(s:string)=>element(key+s),closest:()=>element('.panel'),appendChild(){},matches:()=>false,focus(){}};elements.set(key,el);return el;}
 const modeElements=['solo','circuit','battle'].map(mode=>{const el=element('[mode='+mode+']');el.dataset.mode=mode;return el;});
 const document={hidden:false,body:element('body'),querySelector:element,querySelectorAll:(selector:string)=>selector==='[data-mode]'?modeElements:[],addEventListener:(type:string,fn:Function)=>(docEvents[type]??=[]).push(fn),createElement:()=>element('new')};
 const parent={postMessage:(message:any)=>messages.push(message)};
 const window={parent,devicePixelRatio:1,addEventListener:(type:string,fn:Function)=>(events[type]??=[]).push(fn),focus(){}};
 const sandbox={document,window,parent,console,Math,Date,Path2D:class {constructor(){return context;}},setTimeout:()=>0,clearTimeout(){},requestAnimationFrame:(fn:Function)=>(callback=fn,1),cancelAnimationFrame:()=>{callback=undefined;}};
 vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1],sandbox,{timeout:2000});
 const bridge=(data:any)=>events.message.forEach(fn=>fn({source:parent,data:{game:'pognali-v1',...data}}));
 bridge({type:'user',user:{name:'<test>'}});
 return {element,messages,modeElements,bridge,events,advance(seconds:number){for(let i=0;i<seconds*60;i++){const next=callback;callback=undefined;next?.(1000+i*1000/60);}},pending:()=>Boolean(callback)};
}
for(const mode of ['solo','circuit','battle'])test(`shipped engine runs, pauses and reports ${mode}`,()=>{
 const h=harness();assert.equal(h.messages[0].type,'ready');assert.equal(h.pending(),false);
 h.modeElements.find(el=>el.dataset.mode===mode)!.fire('click');h.element('#btnStart').fire('click');assert.equal(h.messages.at(-1).type,'start');
 h.bridge({type:'started',id:'test'});h.element('#btnGas').fire('pointerdown',{pointerId:1});h.advance(3);
 h.element('#btnPause').fire('click');assert.equal(h.pending(),false);h.element('#btnResume').fire('click');assert.equal(h.pending(),true);
 h.element('#btnQuit').fire('click');h.advance(1);
 const result=h.messages.find(m=>m.type==='finish');assert.ok(result);assert.ok(result.duration>1);assert.ok(result.distance>0);assert.equal(h.pending(),false);
 h.element('#btnMenu').fire('click');assert.equal(h.pending(),false);
});
