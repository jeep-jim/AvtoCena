import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

const source=fs.readFileSync('apps/web/components/layout/OverlayBackHistory.tsx','utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',target:'es2022'}).code;

/** Execute the real component effect. Only browser scheduling/DOM are controlled.
 * WHATWG update-document-for-history-step-application fires popstate before
 * restore-persisted-state, which restores scrolling only for an auto entry:
 * https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-document-for-history-step-application
 * https://html.spec.whatwg.org/multipage/browsing-the-web.html#restore-persisted-state
 */
function fixture(originalRestoration:'auto'|'manual'='auto'){
 let y=900,frameId=0,token=0,index=0;
 let cleanup:()=>void=()=>{},observer:(records:any[])=>void=()=>{};
 const frames=new Map<number,()=>void>(),microtasks:Array<()=>void>=[],traversals:number[]=[];
 const listeners=new Map<string,Set<(event:any)=>void>>();
 const scrolls:number[]=[],nativeRestores:number[]=[],layers:Layer[]=[];
 const body={style:{position:'',top:''}},location=new URL('https://avtocena.test/dealers/example?make=Audi#catalog');
 type Entry={url:string;state:any;mode:'auto'|'manual';y:number};
 const entries:Entry[]=[{url:location.href,state:{},mode:originalRestoration,y}];
 const setUrl=(url?:string|URL|null)=>{if(url!=null)location.href=new URL(url,location).href;};
 const history={
  get state(){return entries[index].state;},
  get scrollRestoration(){return entries[index].mode;},
  set scrollRestoration(mode:'auto'|'manual'){entries[index].mode=mode;},
  pushState(state:any,_unused:string,url?:string|URL|null){
   const previous=entries[index];previous.y=y;setUrl(url);
   entries.splice(index+1);entries.push({state,url:location.href,mode:previous.mode,y});index++;
  },
  replaceState(state:any,_unused:string,url?:string|URL|null){setUrl(url);Object.assign(entries[index],{state,url:location.href});},
  go(delta:number){traversals.push(delta);},
  back(){traversals.push(-1);},
 };
 const notify=(layer:Layer,removed=false)=>observer([{type:'childList',addedNodes:removed?[]:[layer],removedNodes:removed?[layer]:[]}]);
 class Layer{
  visible=true;
  constructor(readonly catalog:boolean,readonly restoredY:number){}
  matches(selector:string){return selector==='.ac-mobile-filter-sheet'?this.catalog:true;}
  getClientRects(){return this.visible?[{}]:[];}
  querySelector(){return {click:()=>close(this)};}
  querySelectorAll(){return [];}
  closest(){return null;}
  contains(node:unknown){return node===this;}
 }
 function close(layer:Layer){
  layer.visible=false;body.style.position='';body.style.top='';
  // Model the sheet's own unlock/anchor adjustment, not a fixed old offset.
  y=layer.restoredY;
  microtasks.push(()=>notify(layer,true));
 }
 const window={
  get scrollY(){return y;},
  addEventListener(name:string,fn:(event:any)=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},
  removeEventListener(name:string,fn:(event:any)=>void){listeners.get(name)?.delete(fn);},
  scrollTo({top}:{top:number}){scrolls.push(top);y=top;},
 };
 const document={body,querySelectorAll:()=>layers.filter(layer=>layer.visible),dispatchEvent(){}};
 const module={exports:{} as {OverlayBackHistory:()=>null}};
 const context=vm.createContext({module,exports:module.exports,
  require:(name:string)=>{assert.equal(name,'react');return {useEffect:(effect:()=>()=>void)=>{cleanup=effect();}};},
  window,document,history,location,URL,crypto:{randomUUID:()=>`overlay-${++token}`},
  Element:Layer,HTMLDialogElement:class{},Event:class{},KeyboardEvent:class{},
  getComputedStyle:()=>({visibility:'visible'}),
  MutationObserver:class{constructor(fn:(records:any[])=>void){observer=fn;}observe(){}disconnect(){observer=()=>{};}},
  requestAnimationFrame:(fn:()=>void)=>{frames.set(++frameId,fn);return frameId;},
  cancelAnimationFrame:(id:number)=>frames.delete(id),queueMicrotask:(fn:()=>void)=>microtasks.push(fn),
 });
 vm.runInContext(compiled,context);module.exports.OverlayBackHistory();
 const flushMicrotasks=()=>{while(microtasks.length)microtasks.shift()!();};
 return {
  get y(){return y;},set y(value:number){y=value;},history,scrolls,nativeRestores,
  get pendingFrames(){return frames.size;},
  open(catalog=true,restoredY=500){
   const layer=new Layer(catalog,restoredY);layers.push(layer);
   // The underlying entry can contain an old offset when layout changes.
   notify(layer);body.style.position='fixed';body.style.top=`-${y}px`;y=0;
   return layer;
  },
  closeButton(layer:Layer){close(layer);flushMicrotasks();},
  back(){history.back();},
  forward(){history.go(1);},
  traverse(){
   assert.equal(traversals.length,1);entries[index].y=y;index+=traversals.shift()!;location.href=entries[index].url;
   for(const fn of listeners.get('popstate')||[])fn({state:history.state});
   // The native continuation follows synchronous popstate handlers, before RAF.
   if(history.scrollRestoration==='auto'){y=entries[index].y;nativeRestores.push(y);}
   flushMicrotasks();
  },
  frame(){const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();flushMicrotasks();},
  cleanup:()=>cleanup(),
 };
}

for(const method of ['button','back'] as const)test(`catalog ${method} close retains its anchor through native history restoration`,()=>{
 const f=fixture(),sheet=f.open(true,500);
 if(method==='button')f.closeButton(sheet);else f.back();
 f.traverse();
 assert.equal(f.y,500,'native persisted 900px must not overwrite the sheet-adjusted 500px');
 assert.deepEqual(f.nativeRestores,[]);assert.equal(f.history.scrollRestoration,'manual');
 f.frame();assert.equal(f.history.scrollRestoration,'manual');
 // A later response may legitimately adjust the anchor again before completion.
 f.y=575;f.frame();
 assert.equal(f.y,575);assert.deepEqual(f.scrolls,[],'catalog owns its anchor; never replay the opening offset');
 assert.equal(f.history.scrollRestoration,'auto');f.cleanup();
});

for(const elapsedFrames of [0,1])test(`route push after ${elapsedFrames} frames preserves the closed catalog entry for Back and Forward`,()=>{
 const f=fixture(),sheet=f.open(true,500);f.closeButton(sheet);f.traverse();
 for(let i=0;i<elapsedFrames;i++)f.frame();
 f.history.pushState({route:'cars'},'', '/cars');
 assert.equal(f.history.scrollRestoration,'auto');assert.equal(f.pendingFrames,0);
 f.y=100;f.frame();f.frame();assert.equal(f.y,100);
 f.back();f.traverse();assert.equal(f.y,500);assert.equal(f.history.scrollRestoration,'auto');
 f.forward();f.traverse();assert.equal(f.y,100);assert.equal(f.history.scrollRestoration,'auto');
 assert.deepEqual(f.scrolls,[]);f.cleanup();
});

test('native Back during deferred completion restores the departed entry on Forward',()=>{
 const f=fixture();f.history.pushState({route:'catalog'},'', '/cars/china');
 const sheet=f.open(true,500);f.closeButton(sheet);f.traverse();
 f.back();f.traverse();assert.equal(f.history.scrollRestoration,'auto');
 f.y=100;f.frame();f.frame();assert.equal(f.y,100,'completion must not act on a different entry');
 f.forward();f.traverse();assert.equal(f.y,500);assert.equal(f.history.scrollRestoration,'auto');
 assert.deepEqual(f.scrolls,[]);f.cleanup();
});

test('opening another sheet before completion retains manual restoration',()=>{
 const f=fixture(),first=f.open();f.closeButton(first);f.traverse();
 f.frame();const second=f.open(true,450);f.frame();
 assert.equal(f.history.scrollRestoration,'manual');
 f.closeButton(second);f.traverse();f.frame();f.frame();
 assert.equal(f.y,450);assert.deepEqual(f.nativeRestores,[]);assert.deepEqual(f.scrolls,[]);
 assert.equal(f.history.scrollRestoration,'auto');f.cleanup();
});

test('unmount cancels completion and restores the original restoration mode',()=>{
 const f=fixture(),sheet=f.open();f.closeButton(sheet);f.traverse();f.frame();
 assert.equal(f.pendingFrames,1);f.cleanup();assert.equal(f.pendingFrames,0);
 assert.equal(f.history.scrollRestoration,'auto');f.y=600;f.frame();
 assert.equal(f.y,600);assert.deepEqual(f.scrolls,[]);
});

test('an originally manual page remains manual after catalog close',()=>{
 const f=fixture('manual'),sheet=f.open();f.closeButton(sheet);f.traverse();f.frame();f.frame();
 assert.equal(f.history.scrollRestoration,'manual');assert.equal(f.y,500);assert.deepEqual(f.scrolls,[]);f.cleanup();
});

test('non-catalog overlays retain their existing absolute restoration',()=>{
 const f=fixture(),dialog=f.open(false,500);f.closeButton(dialog);f.traverse();f.frame();
 assert.equal(f.y,500);assert.equal(f.history.scrollRestoration,'manual');f.frame();
 assert.equal(f.y,900);assert.deepEqual(f.scrolls,[900]);assert.equal(f.history.scrollRestoration,'auto');f.cleanup();
});
