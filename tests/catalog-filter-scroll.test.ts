import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberFilterScroll,restoreFilterScroll} from '../apps/web/lib/catalog/filter-scroll';
test('filter restoration is synchronous, waits for body unlock, and tracks the catalog when dealer hero disappears',()=>{
 const saved=Object.fromEntries(['window','document','location'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let y=1400,top=1000;const calls:number[]=[];
 const location={origin:'https://avtocena.com',href:'https://avtocena.com/dealers/test'};
 const body={style:{position:'',top:''}};
 Object.assign(globalThis,{location,document:{body,querySelector:()=>({getBoundingClientRect:()=>({top:top-y})})},window:{get scrollY(){return y;},setTimeout,clearTimeout,addEventListener(){},removeEventListener(){},dispatchEvent(){},scrollTo({top}:any){calls.push(top);y=top;}}});
 try{
  rememberFilterScroll('/dealers/test?market=china');location.href+='?market=china';top=100;
  body.style.position='fixed';body.style.top='-1400px';restoreFilterScroll();assert.equal(calls.length,0);
  body.style.position='';restoreFilterScroll();assert.deepEqual(calls,[500]);
  restoreFilterScroll();assert.equal(calls.length,1);
  rememberFilterScroll('/dealers/test?market=china&make=Kia');location.href+='&make=Kia';restoreFilterScroll();assert.deepEqual(calls,[500,500]);
 }finally{for(const [k,v] of Object.entries(saved))if(v)Object.defineProperty(globalThis,k,v);else delete (globalThis as any)[k];}
});

test('delayed response after closing a fixed-body sheet uses the original document anchor',async()=>{
 const {lockFilterScrollAnchor}=await import('../apps/web/lib/catalog/filter-scroll');
 const saved=Object.fromEntries(['window','document','location'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let y=900;const calls:number[]=[];const location={origin:'https://avtocena.com',href:'https://avtocena.com/dealers/test'};
 const body={style:{position:'',top:''}};
 Object.assign(globalThis,{location,document:{body,querySelector:()=>({getBoundingClientRect:()=>({top:body.style.position==='fixed'?-400:1100-y})})},window:{get scrollY(){return y;},setTimeout,clearTimeout,addEventListener(){},removeEventListener(){},dispatchEvent(){},scrollTo({top}:any){calls.push(top);y=top;}}});
 try{
  const unlock=lockFilterScrollAnchor();body.style.position='fixed';body.style.top='-900px';y=0;
  rememberFilterScroll('/dealers/test?budget=3100000');
  body.style.position='';body.style.top='';y=900;unlock();
  location.href+='?budget=3100000';y=0;restoreFilterScroll();
  assert.deepEqual(calls,[900],'temporary fixed-body geometry must not add a false 600px displacement');
 }finally{for(const [k,v] of Object.entries(saved))if(v)Object.defineProperty(globalThis,k,v);else delete (globalThis as any)[k];}
});
