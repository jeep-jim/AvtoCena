import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const chartSelector='svg[aria-label^="Изменение курса "]';
const segmentSelector='[data-ac-rate-segment]';

/** Execute the real component effects with explicit DOM mutation deliveries.
 * The harness counts document searches separately from added-subtree searches.
 */
function fixture(component:'CurrencyChartEnhancer'|'PublicUiEnhancer'){
 const scans:string[]=[],frames=new Map<number,()=>void>(),intervals=new Map<number,()=>void>(),cleanups:Array<()=>void>=[];
 let sequence=0,scheduled=0;
 class Element {
  parentElement:Element|null=null;children:Element[]=[];attributes=new Map<string,string>();dataset:Record<string,string>={};
  className='';id='';textContent='';style={overflow:''};root=false;
  constructor(public tagName='div'){}
  get isConnected():boolean{return this.root||Boolean(this.parentElement?.isConnected);}
  classList={add:(name:string)=>{if(!this.className.split(' ').includes(name))this.className=(this.className+' '+name).trim();}};
  getAttribute(name:string){return this.attributes.get(name)??null;}
  setAttribute(name:string,value:string){this.attributes.set(name,value);}
  matches(selector:string){
   if(selector===segmentSelector)return this.attributes.has('data-ac-rate-segment');
   if(selector===chartSelector)return this.tagName==='svg'&&(this.getAttribute('aria-label')||'').startsWith('Изменение курса ');
   return selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1));
  }
  closest(selector:string):Element|null{return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
  descendants():Element[]{return this.children.flatMap(child=>[child,...child.descendants()]);}
  querySelectorAll(selector:string){return this.descendants().filter(node=>node.matches(selector));}
  querySelector(selector:string){return selector.startsWith(':scope > ')?this.children.find(node=>node.matches(selector.slice(9)))??null:this.querySelectorAll(selector)[0]??null;}
  appendChild(node:Element){node.remove();node.parentElement=this;this.children.push(node);return node;}
  replaceChildren(...nodes:Element[]){for(const child of [...this.children])child.remove();for(const node of nodes)this.appendChild(node);}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
 }
 class SVGSVGElement extends Element {constructor(){super('svg');}}
 const head=new Element('head'),body=new Element('body');head.root=true;body.root=true;
 const listeners=new Map<string,Set<Function>>();
 const document={head,body,visibilityState:'visible',createElement:(tag:string)=>new Element(tag),
  getElementById:(id:string)=>[...head.descendants(),...body.descendants()].find(node=>node.id===id)??null,
  querySelectorAll:(selector:string)=>{scans.push(selector);return [...head.querySelectorAll(selector),...body.querySelectorAll(selector)];},
  addEventListener:(name:string,fn:Function)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},
  removeEventListener:(name:string,fn:Function)=>listeners.get(name)?.delete(fn),
 };
 const observers:Array<{callback:Function;active:boolean}>=[];
 class MutationObserver {
  state:{callback:Function;active:boolean};constructor(callback:Function){this.state={callback,active:true};observers.push(this.state);}
  observe(){}disconnect(){this.state.active=false;}
 }
 let rates=[{currency:'USD',effectiveRate:91,previousEffectiveRate:90,rateDate:'2026-11-11',previousRateDate:'2026-11-10'},
  {currency:'JPY',effectiveRate:0.6,previousEffectiveRate:0.5,rateDate:'2026-11-11',previousRateDate:'2026-11-10'},
  {currency:'KRW',effectiveRate:0.07,previousEffectiveRate:0.06,rateDate:'2026-11-11',previousRateDate:'2026-11-10'}];
 const componentPath=`apps/web/components/layout/${component}.tsx`;
 const source=process.env.CURRENCY_OBSERVER_BASE_REF?execFileSync('git',['show',`${process.env.CURRENCY_OBSERVER_BASE_REF}:${componentPath}`],{encoding:'utf8'}):fs.readFileSync(componentPath,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports:Record<string,()=>unknown>={};
 const context={exports,Element,SVGSVGElement,MutationObserver,document,
  window:{requestAnimationFrame:(fn:()=>void)=>{scheduled++;frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:(id:number)=>frames.delete(id),
   setInterval:(fn:()=>void)=>{intervals.set(++sequence,fn);return sequence;},clearInterval:(id:number)=>intervals.delete(id),addEventListener(){},removeEventListener(){}},
  require:(name:string)=>name==='react'?{useState:()=>[null,()=>{}],useEffect:(fn:()=>void|(()=>void))=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);}}:
   name.includes('public-rates-client')?{loadPublicRates:async()=>rates}: {},
 };
 vm.runInNewContext(compiled,context);
 const element=(tag='div')=>tag==='svg'?new SVGSVGElement():new Element(tag);
 const chart=(currency:string)=>{const host=element(),svg=element('svg');svg.setAttribute('aria-label','Изменение курса '+currency);host.appendChild(svg);return {host,svg};};
 const deliver=(records:unknown[])=>{for(const observer of observers)if(observer.active)observer.callback(records);};
 const flush=async()=>{for(let tick=0;tick<8;tick++)await Promise.resolve();let count=0;while(frames.size){assert.ok(++count<20,'effects must settle');const tasks=[...frames.values()];frames.clear();for(const task of tasks)task();}};
 return {document,element,chart,deliver,flush,scans,frames,intervals,listeners,observers,mount:()=>exports[component](),
  scheduled:()=>scheduled,refresh:()=>{for(const callback of intervals.values())callback();},setRates:(value:typeof rates)=>{rates=value;},
  unmount:()=>{for(const cleanup of cleanups.reverse())cleanup();},
 };
}

test('rate-segment cleanup inspects added CMS subtrees without rescanning unrelated cards',async()=>{
 const f=fixture('CurrencyChartEnhancer');
 const existing=f.element();existing.setAttribute('data-ac-rate-segment','');f.document.body.appendChild(existing);
 f.mount();await f.flush();assert.equal(existing.isConnected,false);
 assert.deepEqual(f.scans,[segmentSelector]);const scheduled=f.scheduled();
 for(let i=0;i<25;i++){
  const card=f.element();card.className='catalog-card';card.appendChild(f.element('img'));f.document.body.appendChild(card);
  f.deliver([{type:'childList',target:f.document.body,addedNodes:[card],removedNodes:[]}]);await f.flush();
 }
 assert.deepEqual(f.scans,[segmentSelector]);assert.equal(f.scheduled(),scheduled,'unrelated cards schedule no cleanup frame');
 const wrapper=f.element(),late=f.element();late.setAttribute('data-ac-rate-segment','');wrapper.appendChild(late);f.document.body.appendChild(wrapper);
 const direct=f.element();direct.setAttribute('data-ac-rate-segment','');f.document.body.appendChild(direct);
 f.deliver([{type:'childList',target:f.document.body,addedNodes:[wrapper,direct],removedNodes:[]}]);await f.flush();
 assert.equal(late.isConnected,false);assert.equal(direct.isConnected,false);assert.equal(wrapper.isConnected,true);
 assert.deepEqual(f.scans,[segmentSelector]);
 const pending=f.element();pending.setAttribute('data-ac-rate-segment','');f.document.body.appendChild(pending);
 f.deliver([{type:'childList',target:f.document.body,addedNodes:[pending],removedNodes:[]}]);
 f.unmount();assert.equal(f.frames.size,0);assert.ok(f.observers.every(observer=>!observer.active));
 assert.equal(f.document.head.children.length,0);assert.equal(pending.isConnected,true,'unmount cancels deferred work');
});

test('currency annotations update initial and late charts, labels and rate snapshots without global card rescans',async()=>{
 const f=fixture('PublicUiEnhancer');
 const initial=f.chart('USD');f.document.body.appendChild(initial.host);
 f.mount();await f.flush();
 const annotation=()=>initial.host.querySelector(':scope > .ac-rate-point-deltas');
 assert.equal(annotation()?.children.length,5);assert.equal(annotation()?.children[4].textContent,'+1');
 assert.deepEqual(f.scans,[chartSelector]);const scheduled=f.scheduled(),original=annotation();
 for(let i=0;i<25;i++){
  const card=f.element();card.className='catalog-card';card.appendChild(f.element('img'));f.document.body.appendChild(card);
  f.deliver([{type:'childList',target:f.document.body,addedNodes:[card],removedNodes:[]}]);await f.flush();
 }
 assert.deepEqual(f.scans,[chartSelector]);assert.equal(f.scheduled(),scheduled);assert.equal(annotation(),original);
 const wrapper=f.element(),late=f.chart('JPY');wrapper.appendChild(late.host);f.document.body.appendChild(wrapper);
 f.deliver([{type:'childList',target:f.document.body,addedNodes:[wrapper],removedNodes:[]}]);await f.flush();
 assert.equal(late.host.querySelector(':scope > .ac-rate-point-deltas')?.children[4].textContent,'+10');
 initial.svg.setAttribute('aria-label','Изменение курса KRW');
 f.deliver([{type:'attributes',target:initial.svg,attributeName:'aria-label'}]);await f.flush();
 assert.equal(annotation()?.children[4].textContent,'+10');
 const removed=annotation()!;removed.remove();
 f.deliver([{type:'childList',target:initial.host,addedNodes:[],removedNodes:[removed]}]);await f.flush();
 assert.notEqual(annotation(),removed);assert.equal(annotation()?.children.length,5,'a dynamic redraw restores its annotation');
 assert.deepEqual(f.scans,[chartSelector]);
 f.setRates([{currency:'KRW',effectiveRate:0.08,previousEffectiveRate:0.06,rateDate:'2026-11-11',previousRateDate:'2026-11-10'}]);
 f.refresh();await f.flush();assert.equal(annotation()?.children[4].textContent,'+20');
 assert.deepEqual(f.scans,[chartSelector,chartSelector],'only a new rate snapshot reinspects all charts');
 assert.ok(f.document.head.children.some(style=>style.textContent.includes('html[data-theme="light"]')),'theme CSS remains mounted');
 f.unmount();assert.equal(f.frames.size,0);assert.equal(f.intervals.size,0);assert.ok(f.observers.every(observer=>!observer.active));
 assert.ok([...f.listeners.values()].every(set=>set.size===0));assert.equal(f.document.head.children.length,0);
});

test('empty rates ignore transient charts and recovery annotates only the currently connected charts',async()=>{
 const f=fixture('PublicUiEnhancer');f.setRates([]);f.mount();await f.flush();
 const removed=f.chart('USD');f.document.body.appendChild(removed.host);
 f.deliver([{type:'childList',target:f.document.body,addedNodes:[removed.host],removedNodes:[]}]);
 removed.host.remove();f.deliver([{type:'childList',target:f.document.body,addedNodes:[],removedNodes:[removed.host]}]);
 const active=f.chart('USD');f.document.body.appendChild(active.host);
 f.deliver([{type:'childList',target:f.document.body,addedNodes:[active.host],removedNodes:[]}]);await f.flush();
 assert.deepEqual(f.scans,[]);assert.equal(f.scheduled(),0,'unavailable rates do not enqueue detached charts');
 f.setRates([{currency:'USD',effectiveRate:92,previousEffectiveRate:90,rateDate:'2026-11-11',previousRateDate:'2026-11-10'}]);
 f.refresh();await f.flush();
 assert.equal(active.host.querySelector(':scope > .ac-rate-point-deltas')?.children[4].textContent,'+2');
 assert.equal(removed.host.querySelector(':scope > .ac-rate-point-deltas'),null);
 assert.deepEqual(f.scans,[chartSelector]);
 // An empty later snapshot must again suspend annotation work safely.
 f.setRates([]);f.refresh();await f.flush();const before=f.scheduled();
 const next=f.chart('JPY');f.document.body.appendChild(next.host);
 f.deliver([{type:'childList',target:f.document.body,addedNodes:[next.host],removedNodes:[]}]);await f.flush();
 assert.equal(f.scheduled(),before);assert.deepEqual(f.scans,[chartSelector]);
 f.unmount();assert.equal(f.frames.size,0);assert.equal(f.intervals.size,0);
});
